"use client";

/**
 * The editor's draft state, and the queue that gets it to the server.
 *
 * WHAT THIS REPLACES. Every control in the site editor used to be wired the same
 * way: call the action, hold a `useTransition` pending flag, disable the whole
 * page until it returned. On a phone that is a second of frozen UI per tap, and
 * on a bad connection it is a page that appears broken — the tap did nothing,
 * so it gets tapped again, and now there are two.
 *
 * THE MODEL. There is one source of truth with two halves:
 *
 *     draft = serverSnapshot + everything still in the queue
 *
 * A tap appends a mutation to the queue, so the draft changes in the same frame.
 * A background loop sends the queue to the server one entry at a time, in order.
 * When the server accepts one it is marked settled, and it is dropped only once
 * a fresh snapshot arrives — which is what stops the block flickering out of
 * existence in the gap between "saved" and "the new page HTML got here".
 *
 * WHY A QUEUE AND NOT `useOptimistic`. React's hook is scoped to a transition:
 * when the action settles, the optimistic value is dropped and the server's
 * answer takes over. That is exactly right for a form and exactly wrong here,
 * because the case this has to survive is the action NEVER settling. An edit
 * made in a lift has to still be on screen when the doors open, and be sent
 * then — which means it has to outlive its own transition and, since a phone
 * will happily discard the tab, outlive the page too. Hence localStorage.
 *
 * ONE AT A TIME, IN ORDER, ALWAYS. Later mutations routinely depend on earlier
 * ones — style a block that is still being inserted, delete a section that has
 * not been created — so sending them concurrently would mean the server seeing
 * a block styled before it exists. (Next dispatches Server Actions serially per
 * client anyway; this does not rely on that, because the ordering has to hold
 * across a reload as well, and nothing in the framework spans that.)
 *
 * DELIVERY IS AT-LEAST-ONCE, NEVER AT-MOST-ONCE. A request that times out may
 * have been applied; the response is what went missing. There is no way to tell
 * from here, so the queue resends and every action it can send is idempotent —
 * see the header of actions.ts for how, and `moveSection` for the one that had
 * to be given a way.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { toast } from "sonner";

import {
  addBlock,
  addSection,
  deleteBlock,
  deleteSection,
  moveBlock,
  moveSection,
  saveBlockContent,
  setBlockStyle,
  setBlockVisibility,
  setPublished,
  setSectionLayout,
  setSplitRatio,
  setTheme,
  type SiteActionResult,
} from "./actions";
import {
  applyAll,
  applyMutation,
  coalesceKey,
  isSiteMutation,
  newId,
  type SiteMutation,
} from "./mutations";
import type { OwnerSite } from "./owner";

/** One queued edit. Everything here is JSON, because all of it is persisted. */
type Entry = {
  key: string;
  mutation: SiteMutation;
  /** Accepted by the server. Kept applied until a snapshot proves it landed. */
  settled: boolean;
  /** When it was made, for the staleness cap on reload. */
  at: number;
};

type State = {
  entries: Entry[];
  /**
   * Cleared by a transport failure, restored by a success, the browser's
   * `online` event, or the backoff timer.
   *
   * NOT `navigator.onLine`, which answers "is there a network interface",
   * not "can I reach the server" — it is `true` on a hotel wifi that has not
   * been paid for and on a train with two bars and no throughput. A failed
   * request is the only honest signal, so it is the one that sets this.
   */
  reachable: boolean;
  /** Consecutive transport failures. The backoff exponent. */
  failures: number;
  /** localStorage has been read. Nothing is sent before it has — see below. */
  hydrated: boolean;
};

type Action =
  | { type: "hydrate"; entries: Entry[] }
  /** `sending` is the entry currently on the wire, which must not be rewritten. */
  | { type: "enqueue"; entry: Entry; sending: string | null }
  | { type: "settled"; key: string }
  | { type: "dropped"; key: string }
  | { type: "stalled" }
  | { type: "resume" }
  | { type: "commit" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      // Restored entries go BEFORE anything typed since the page loaded, which
      // is the order they were made in and therefore the order their
      // dependencies need.
      return { ...state, hydrated: true, entries: [...action.entries, ...state.entries] };

    /**
     * Append, or replace the entry this one supersedes.
     *
     * Superseding keeps the ORIGINAL position rather than moving the entry to
     * the back. Position is dependency order — a style edit sits after the
     * `addBlock` that created its target — and re-ordering on every keystroke of
     * a colour drag would eventually float it in front of that insert.
     *
     * An entry already on the wire is never rewritten: the request carrying it
     * has left, so changing it here would send the old value and then mark the
     * new one delivered.
     */
    case "enqueue": {
      const key = coalesceKey(action.entry.mutation);
      const index = key
        ? state.entries.findIndex(
            (entry) =>
              !entry.settled &&
              entry.key !== action.sending &&
              coalesceKey(entry.mutation) === key,
          )
        : -1;

      if (index === -1) return { ...state, entries: [...state.entries, action.entry] };

      const entries = [...state.entries];
      entries[index] = { ...entries[index], mutation: action.entry.mutation, at: action.entry.at };
      return { ...state, entries };
    }

    case "settled":
      return {
        ...state,
        reachable: true,
        failures: 0,
        entries: state.entries.map((entry) =>
          entry.key === action.key ? { ...entry, settled: true } : entry,
        ),
      };

    // Refused on its merits rather than undelivered. Dropping it takes the
    // change back off the screen, which is the honest thing to show: the reason
    // was just put in front of the user, and leaving the edit visible would
    // claim it was saved.
    case "dropped":
      return {
        ...state,
        reachable: true,
        failures: 0,
        entries: state.entries.filter((entry) => entry.key !== action.key),
      };

    case "stalled":
      return { ...state, reachable: false, failures: state.failures + 1 };

    case "resume":
      return state.reachable ? state : { ...state, reachable: true };

    // A fresh server snapshot arrived, so it already contains everything the
    // server has accepted. Anything still unsettled stays on top of it.
    case "commit": {
      const entries = state.entries.filter((entry) => !entry.settled);
      return entries.length === state.entries.length ? state : { ...state, entries };
    }
  }
}

const INITIAL: State = { entries: [], reachable: true, failures: 0, hydrated: false };

// ── The wire ───────────────────────────────────────────────────────────────

/**
 * The only place a mutation becomes a request.
 *
 * Exhaustive over the union with no default, so a new mutation kind is a
 * compile error here rather than an edit that queues, applies locally, appears
 * to save, and is silently never sent.
 */
function send(mutation: SiteMutation): Promise<SiteActionResult> {
  switch (mutation.kind) {
    case "setPublished":
      return setPublished(mutation.published);
    case "setTheme":
      return setTheme(mutation.theme);
    case "addSection":
      return addSection(mutation.layout, mutation.sectionId);
    case "deleteSection":
      return deleteSection(mutation.sectionId);
    case "moveSection":
      return moveSection(mutation.sectionId, mutation.direction, mutation.fromIndex);
    case "setSectionLayout":
      return setSectionLayout(mutation.sectionId, mutation.layout);
    case "addBlock":
      return addBlock(mutation.sectionId, mutation.type, mutation.blockId, mutation.splitFrom);
    case "deleteBlock":
      return deleteBlock(mutation.blockId);
    case "moveBlock":
      return moveBlock(mutation.blockId, mutation.direction, mutation.fromIndex);
    case "setBlockVisibility":
      return setBlockVisibility(mutation.blockId, mutation.visibility);
    case "setBlockStyle":
      return setBlockStyle(mutation.blockId, mutation.style);
    case "saveBlockContent":
      return saveBlockContent(mutation.blockId, mutation.content);
    case "setSplitRatio":
      return setSplitRatio(mutation.sectionId, mutation.path, mutation.ratio);
  }
}

// ── Persistence ────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "skan.site-queue.v1.";

/**
 * How long an unsent edit is worth keeping.
 *
 * Not forever, and the reason is other devices. A queue that survives a week
 * would replay Tuesday's layout over Friday's — edits made on a laptop in the
 * meantime, on a page whose owner has long since forgotten the phone had
 * anything pending. A day is long enough to cover a flight, a dead battery and a
 * night with no signal, which is the whole set of cases this is for.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Per profile: a shared device must not replay one account's edits into another's. */
const storageKey = (profileId: string) => `${STORAGE_PREFIX}${profileId}`;

function loadQueue(profileId: string): Entry[] {
  try {
    const raw = window.localStorage.getItem(storageKey(profileId));
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.flatMap((value): Entry[] => {
      if (typeof value !== "object" || value === null) return [];
      const entry = value as Partial<Entry>;
      if (typeof entry.key !== "string" || typeof entry.at !== "number") return [];
      if (entry.at < cutoff) return [];
      if (!isSiteMutation(entry.mutation)) return [];
      return [{ key: entry.key, mutation: entry.mutation, at: entry.at, settled: false }];
    });
  } catch {
    // Unreadable, unparseable, or storage denied (Safari private browsing throws
    // on access, not just on write). An empty queue is the safe answer: the
    // editor still works, it just has nothing held over.
    return [];
  }
}

function saveQueue(profileId: string, entries: Entry[]): void {
  try {
    // Settled entries are on the server already; persisting them would replay
    // writes that have happened on the next load.
    const unsent = entries.filter((entry) => !entry.settled);
    if (unsent.length === 0) window.localStorage.removeItem(storageKey(profileId));
    else window.localStorage.setItem(storageKey(profileId), JSON.stringify(unsent));
  } catch {
    // Out of quota, or storage denied. The in-memory queue is unaffected and
    // will still be sent; only surviving a reload is lost, and there is nothing
    // useful to say about it to someone in the middle of an edit.
  }
}

// ── Context ────────────────────────────────────────────────────────────────

export type SiteSync = {
  /** Edits made but not yet accepted by the server. */
  pending: number;
  /** The last attempt failed to reach the server, and we are backing off. */
  offline: boolean;
  /** Retry now rather than waiting out the backoff. */
  retry: () => void;
};

type SiteStore = {
  /** The server snapshot with the queue folded in — what the editor renders. */
  site: OwnerSite;
  mutate: (mutation: SiteMutation) => void;
  sync: SiteSync;
};

const Context = createContext<SiteStore | null>(null);

export function useSiteStore(): SiteStore {
  const store = useContext(Context);
  if (!store) throw new Error("useSiteStore must be used inside <SiteStoreProvider>");
  return store;
}

/** Backoff: 2s, 4s, 8s, 16s, then every 30s. */
function backoffMs(failures: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.min(failures - 1, 4));
}

const OFFLINE_TOAST = "site-sync";

export function SiteStoreProvider({
  serverSite,
  profileId,
  children,
}: {
  serverSite: OwnerSite;
  profileId: string;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const site = useMemo(
    () => applyAll(serverSite, state.entries.map((entry) => entry.mutation)),
    [serverSite, state.entries],
  );

  const unsent = state.entries.filter((entry) => !entry.settled);
  const pending = unsent.length;
  const hasUnsent = pending > 0;
  const hasSettled = state.entries.length > pending;

  /**
   * Hydrate from storage once, in an effect rather than in `useState`.
   *
   * Reading localStorage during the first render would make the client's tree
   * differ from the server's and hydration would blow up — and the failure mode
   * is not a warning, it is the whole editor re-rendering from scratch.
   *
   * The ref is not belt-and-braces. Under StrictMode React deliberately runs
   * mount effects twice WITHOUT resetting state between them, so a second run
   * would prepend the stored queue to a queue that already contains it — every
   * held-over edit sent twice, and announced twice. Keying it by profile keeps
   * it correct if the identity under it ever changes.
   */
  const hydratedFor = useRef<string | null>(null);

  useEffect(() => {
    if (hydratedFor.current === profileId) return;
    hydratedFor.current = profileId;

    const restored = loadQueue(profileId);
    dispatch({ type: "hydrate", entries: restored });
    if (restored.length > 0) {
      toast.info(
        restored.length === 1
          ? "Sending a change you made while offline."
          : `Sending ${restored.length} changes you made while offline.`,
        { id: OFFLINE_TOAST },
      );
    }
  }, [profileId]);

  useEffect(() => {
    if (!state.hydrated) return;
    saveQueue(profileId, state.entries);
  }, [profileId, state.entries, state.hydrated]);

  /** The entry on the wire right now — see the `enqueue` case in the reducer. */
  const sending = useRef<string | null>(null);
  /** Only for deciding whether a success is worth announcing. */
  const wasReachable = useRef(true);

  /**
   * The sender. One entry per effect run, rather than a loop inside one.
   *
   * The loop version has to read the queue from a ref to see edits made while
   * it is awaiting, and then every dispatch is a race against its own next
   * iteration. Sending one and letting the resulting state change re-run the
   * effect gets the same serialisation out of React's own scheduling, and each
   * run reads a queue that is by construction current.
   */
  useEffect(() => {
    if (!state.hydrated || !state.reachable || sending.current !== null) return;

    const next = state.entries.find((entry) => !entry.settled);
    if (!next) return;

    sending.current = next.key;
    void (async () => {
      try {
        const result = await send(next.mutation);
        if (result.ok) {
          // Only worth saying when there was something to recover FROM. The
          // duration is restated because this is replacing a toast that was
          // pinned open, and an id reuse inherits what it replaces.
          if (!wasReachable.current) {
            toast.success("Back online. Your changes are saved.", {
              id: OFFLINE_TOAST,
              description: undefined,
              duration: 4000,
            });
          }
          dispatch({ type: "settled", key: next.key });
        } else {
          // A refusal means the server was reached, so whatever the connection
          // notice is still claiming is out of date.
          toast.dismiss(OFFLINE_TOAST);
          toast.error(result.message);
          dispatch({ type: "dropped", key: next.key });
        }
      } catch {
        // A thrown action is a transport failure — the request never got an
        // answer. A rejection ON THE MERITS comes back as `ok: false` above and
        // is handled there, so nothing that reaches here is worth giving up on.
        toast.warning("No connection.", {
          id: OFFLINE_TOAST,
          description:
            "Your changes are saved on this device and will be sent when you're back online.",
          duration: Infinity,
        });
        dispatch({ type: "stalled" });
      } finally {
        sending.current = null;
      }
    })();
  }, [state]);

  useEffect(() => {
    wasReachable.current = state.reachable;
  }, [state.reachable]);

  /** Back off, then let the sender try again. */
  useEffect(() => {
    if (state.reachable || !hasUnsent) return;
    const timer = setTimeout(() => dispatch({ type: "resume" }), backoffMs(state.failures));
    return () => clearTimeout(timer);
  }, [state.reachable, state.failures, hasUnsent]);

  /**
   * The browser's own signals, as a shortcut past the backoff.
   *
   * `online` firing is good evidence there is a point in trying again NOW
   * rather than in twenty more seconds. `offline` firing is good evidence there
   * is no point in trying at all — which is worth honouring even though its
   * opposite is not trusted, because a browser that says it has no interface is
   * reliably right, while one that says it has an interface tells you nothing
   * about what is on the other end.
   */
  useEffect(() => {
    const online = () => dispatch({ type: "resume" });
    const offline = () => dispatch({ type: "stalled" });

    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    if (!navigator.onLine) dispatch({ type: "stalled" });

    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  /**
   * A new server snapshot contains everything the server has accepted, so the
   * settled entries sitting on top of it are now duplicates of it.
   */
  useEffect(() => {
    dispatch({ type: "commit" });
  }, [serverSite]);

  /**
   * The backstop for the line above.
   *
   * Every action revalidates, so a new snapshot should always follow a settled
   * write — but "should" is doing work there, and a settled entry that is never
   * committed is applied to every render forever. Every mutation is idempotent
   * so that is harmless, and it is still unbounded growth. Ten seconds is long
   * after any revalidation that was going to arrive.
   */
  useEffect(() => {
    if (!hasSettled) return;
    const timer = setTimeout(() => dispatch({ type: "commit" }), 10_000);
    return () => clearTimeout(timer);
  }, [hasSettled]);

  /**
   * Say something before the tab closes on unsent work.
   *
   * The queue survives a reload, so this is not about losing the edits — it is
   * about someone closing the laptop believing their page is live when the
   * publish is still sitting in a queue on a machine that is about to sleep.
   */
  useEffect(() => {
    if (!hasUnsent) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsent]);

  /**
   * The draft as of the last commit, for `mutate` to test against.
   *
   * A ref rather than the value straight out of the closure because `mutate` is
   * handed to controls that keep it across renders; without this, a component
   * that did not re-render for its own reasons would validate the new edit
   * against a stale draft.
   */
  const draft = useRef(site);
  useEffect(() => {
    draft.current = site;
  }, [site]);

  const mutate = useCallback((mutation: SiteMutation) => {
    // Applied here purely to find out whether it CAN be — the result is thrown
    // away and recomputed by the fold above. An edit that cannot be applied is
    // refused now, with its reason, rather than queued to fail later: offline,
    // "later" could be tomorrow, and by then the reason means nothing.
    const result = applyMutation(draft.current, mutation);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    dispatch({
      type: "enqueue",
      entry: { key: newId(), mutation, settled: false, at: Date.now() },
      sending: sending.current,
    });
  }, []);

  const retry = useCallback(() => dispatch({ type: "resume" }), []);

  const value = useMemo<SiteStore>(
    () => ({
      site,
      mutate,
      sync: { pending, offline: !state.reachable && hasUnsent, retry },
    }),
    [site, mutate, pending, state.reachable, hasUnsent, retry],
  );

  return <Context value={value}>{children}</Context>;
}
