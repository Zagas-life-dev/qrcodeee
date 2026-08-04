/**
 * Database types for the Skan QR schema.
 *
 * HAND-WRITTEN PLACEHOLDER — mirrors supabase/migrations/*.sql exactly, but is
 * meant to be replaced by generated output as soon as the migrations are applied:
 *
 *   npx supabase gen types typescript --project-id kandpaghwwhvmppkkgfy \
 *     > src/lib/supabase/database.types.ts
 *
 * Columns that RLS or column-grants make unwritable by clients (profile_version,
 * qr_token, deleted_at, connections.*, notifications.* other than read_at) are
 * still present on Row — you can read them — but are omitted from Insert/Update
 * where the client genuinely cannot write them, so the type system agrees with
 * the database instead of quietly disagreeing.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** §3: shape stored in profiles.qr_style. Not enforced by the DB beyond a size cap. */
export type QrStyle = {
  dotColor?: string;
  backgroundColor?: string;
  dotStyle?: "square" | "dots" | "rounded" | "extra-rounded" | "classy" | "classy-rounded";
  cornerStyle?: "square" | "dot" | "extra-rounded";
  logoUrl?: string;
};

export type NotificationType =
  | "major_change"
  | "accumulated_changes"
  | "new_connection";

/**
 * The profile payload connect_via_scan returns (§5.1). Contact details are
 * present because the connection now exists; custom_fields contains only the
 * public ones — the function filters them by hand, since SECURITY DEFINER means
 * RLS isn't doing it.
 */
/**
 * A minted QR token and the moment it stops resolving (§6).
 *
 * `expires_at` is returned rather than a duration so the client schedules its
 * refresh against the server's clock, not its own — a device with a skewed
 * clock would otherwise refresh early forever or, worse, display a dead code.
 */
export type MintedQrToken = { token: string; expires_at: string };

/**
 * Everything the analytics page renders, in one round trip.
 *
 * Note what is NOT here: any count of who saved the CALLER's card.
 * contact_saves is owner-only under a policy that calls the inverse "a
 * surveillance signal nobody consented to at scan time", and an aggregate is
 * that same signal at lower resolution — with two connections, "1 person saved
 * your card" names them. `saved` is what the caller saved, never the reverse.
 */
export type NetworkingStats = {
  active: number;
  new_30d: number;
  new_prev_30d: number;
  scans_30d: number;
  scans_total: number;
  saved: number;
  unsaved: number;
  /** Connections whose profile changed after the caller last downloaded it. */
  stale: number;
  first_connection_at: string | null;
  weeks: { week_start: string; connections: number; scans: number }[];
};

export type ScannedProfile = {
  id: string;
  name: string;
  /**
   * Where a scan is sent afterwards — the person's public page.
   *
   * Resolved from the TOKEN inside `connect_via_scan`, never from the handle in
   * the URL the scanner arrived on, so a hand-crafted code naming someone else
   * still lands on whoever the token belongs to.
   */
  handle: string;
  photo_url: string | null;
  bio: string | null;
  phone: string | null;
  email: string | null;
  custom_fields: { label: string; value: string | null }[];
};

/** §S4. `bento` uses the Cell tree; the other three order blocks by sort_order. */
export type SectionLayout = "bento" | "row-scroll" | "stack-scroll" | "single";

/** §S5. `private` is a draft state — visible to the owner in the editor only. */
export type BlockVisibility = "public" | "connections" | "private";

/** The publicly-readable half of a profile — what /u/{handle} renders to anyone. */
export type PublicProfile = {
  id: string;
  name: string;
  photo_url: string | null;
  bio: string | null;
};

/**
 * What `resolve_handle` returns (site-spec S3).
 *
 * `moved` carries the CURRENT handle rather than the profile, so a parked handle
 * redirects instead of quietly continuing to serve the content under its old
 * address — otherwise the old URL never falls out of circulation.
 *
 * Deliberately viewer-independent: this is the read that gets cached and shared
 * across every visitor to a handle, so blocking is applied by the route, per
 * viewer, outside the cached region.
 */
export type HandleResolution =
  | { status: "found"; profile: PublicProfile }
  /** §8: the row survives so connection history resolves, but it was scrubbed. */
  | { status: "deleted" }
  | { status: "moved"; handle: string }
  | { status: "not_found" };

/** What `set_handle` returns. `reserved` is kept distinct from `taken` on purpose. */
export type SetHandleResult =
  | { status: "ok"; handle: string }
  | { status: "taken" }
  | { status: "reserved" }
  | { status: "invalid" }
  | { status: "rate_limited" }
  | { status: "unauthenticated" }
  | { status: "not_found" };

/**
 * Structured status rather than succeed/fail, so the UI can respond precisely
 * instead of showing one generic error toast (§5.1).
 *
 * Note `blocked` is only ever returned to the person who PLACED the block. The
 * blocked party gets `invalid_token`, because a distinct response would confirm
 * that one specific person blocked them — the exact fact the blocks RLS policy
 * refuses to disclose. §5.5 therefore has no "you have been blocked" toast.
 */
export type ScanResult =
  | { status: "new_connection"; connection_epoch: number; profile: ScannedProfile }
  | { status: "already_connected"; connection_epoch: number; profile: ScannedProfile }
  /** Carries just enough to send someone who scanned their own code home. */
  | { status: "self_scan"; profile: { id: string; handle: string } }
  | { status: "invalid_token" }
  | { status: "blocked" }
  | { status: "unauthenticated" }
  /** §7. Scans/minute, failed scans/hour, or new connections/hour. */
  | { status: "rate_limited" };

export type ReportCategory =
  | "spam"
  | "harassment"
  | "impersonation"
  | "inappropriate"
  | "scam"
  | "other";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          handle: string;
          photo_url: string | null;
          bio: string | null;
          qr_style: Json;
          profile_version: number;
          /** S13. Shaped now, enforced by nothing — limits live in tier_limits. */
          tier: string;
          /** S13. Per-user exception to the tier's limits: comps, grandfathering. */
          limit_overrides: Json | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // No insert policy on profiles — rows come from handle_new_user().
        Insert: never;
        // Column grants (§4) allow exactly these four. `handle` is absent on
        // purpose: it is writable only through set_handle(), which is where the
        // reservation list, the parking of the old handle and the rate limit
        // live. Adding it here would not grant it — the DB grant is the real
        // enforcement — but it would make the type system lie about it.
        Update: {
          name?: string;
          photo_url?: string | null;
          bio?: string | null;
          qr_style?: Json;
        };
        Relationships: [];
      };
      /**
       * S8. One row per profile, created at signup. `published` gates the
       * ORDINARY sections only: the pinned identity section is exempt in RLS, so
       * /u/{handle} still says whose page it is either way and blocks stay
       * strictly additive to a page that already works.
       */
      sites: {
        Row: {
          profile_id: string;
          published: boolean;
          template_id: string | null;
          theme: Json;
          seo: Json;
          created_at: string;
          updated_at: string;
        };
        // Created by handle_new_user(), like profiles and contact_details.
        Insert: never;
        Update: {
          published?: boolean;
          template_id?: string | null;
          theme?: Json;
          seo?: Json;
        };
        Relationships: [];
      };
      site_sections: {
        Row: {
          id: string;
          site_id: string;
          layout_type: SectionLayout;
          /** The Cell tree (S4), or null for the non-bento layouts. Validate with parseCell. */
          root_cell: Json | null;
          sort_order: number;
          /**
           * The permanent identity section — one per site, sorted first, and
           * the only section the owner's DELETE policy refuses. Created by
           * `private.create_identity_section`, never by the client.
           */
          pinned: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          layout_type?: SectionLayout;
          root_cell?: Json | null;
          sort_order?: number;
          /** Not writable in practice: the INSERT policy requires `not pinned`. */
          pinned?: boolean;
        };
        Update: {
          layout_type?: SectionLayout;
          root_cell?: Json | null;
          sort_order?: number;
        };
        Relationships: [];
      };
      site_blocks: {
        Row: {
          id: string;
          section_id: string;
          /** Text, not an enum, so an unknown type degrades to nothing on rollback. */
          type: string;
          content: Json;
          /** Alignment, tone and text scale. See lib/site/block-style.ts. */
          style: Json;
          sort_order: number;
          visibility: BlockVisibility;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          section_id: string;
          type: string;
          content?: Json;
          style?: Json;
          sort_order?: number;
          visibility?: BlockVisibility;
        };
        Update: {
          type?: string;
          content?: Json;
          style?: Json;
          sort_order?: number;
          visibility?: BlockVisibility;
        };
        Relationships: [];
      };
      site_media: {
        Row: {
          id: string;
          profile_id: string;
          public_id: string;
          /** Cloudinary asset version — required to build a delivery URL. */
          version: number;
          width: number | null;
          height: number | null;
          bytes: number | null;
          created_at: string;
        };
        Insert: {
          profile_id: string;
          public_id: string;
          version?: number;
          width?: number | null;
          height?: number | null;
          bytes?: number | null;
        };
        Update: never;
        Relationships: [];
      };
      /** RLS on, zero policies — shaped for S13, read by nothing yet. */
      tier_limits: {
        Row: {
          tier: string;
          max_sections: number | null;
          max_blocks: number | null;
          media_allowed: boolean;
          email_list_allowed: boolean;
          analytics_level: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** RLS on, zero policies — consulted only by SECURITY DEFINER paths. */
      reserved_handles: {
        Row: { handle: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * RLS on, zero policies. Readable only through resolve_handle(), which
       * answers about one handle at a time — a `using (true)` policy would let
       * PostgREST serve a complete list of who used to be called what.
       */
      handle_history: {
        Row: { handle: string; profile_id: string; released_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      contact_details: {
        Row: {
          profile_id: string;
          phone: string | null;
          email: string | null;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          phone?: string | null;
          email?: string | null;
        };
        Update: {
          phone?: string | null;
          email?: string | null;
        };
        Relationships: [];
      };
      custom_fields: {
        Row: {
          id: string;
          profile_id: string;
          label: string;
          value: string | null;
          is_public: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          label: string;
          value?: string | null;
          is_public?: boolean;
          sort_order?: number;
        };
        Update: {
          label?: string;
          value?: string | null;
          is_public?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };
      connections: {
        Row: {
          id: string;
          user_a: string;
          user_b: string;
          connected_at: string;
          disconnected_at: string | null;
          connection_epoch: number;
          a_notified_version: number;
          b_notified_version: number;
        };
        // Writes only via connect_via_scan / disconnect RPCs (§5.1, §5.6).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      blocks: {
        Row: {
          blocker_id: string;
          blocked_id: string;
          created_at: string;
        };
        Insert: {
          blocker_id: string;
          blocked_id: string;
        };
        Update: never;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          reported_id: string;
          category: ReportCategory;
          notes: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          reporter_id: string;
          reported_id: string;
          category: ReportCategory;
          notes?: string | null;
        };
        // resolved_at is service-role only (§5.6).
        Update: never;
        Relationships: [];
      };
      profile_change_events: {
        Row: {
          id: string;
          profile_id: string;
          version: number;
          changed_fields: string[];
          is_major: boolean;
          created_at: string;
          processed_at: string | null;
        };
        // RLS on, zero policies — service role only.
        Insert: never;
        Update: {
          processed_at?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          recipient_id: string;
          type: NotificationType;
          source_profile_id: string;
          change_version: number | null;
          dedupe_seq: number;
          created_at: string;
          read_at: string | null;
        };
        Insert: never;
        // Column grant (§4) allows exactly read_at.
        Update: {
          read_at?: string | null;
        };
        Relationships: [];
      };
      /**
       * §7. RLS on with ZERO policies — clients neither read nor write this.
       * Reading it would hand a caller a precise "how close am I to the limit"
       * oracle, which is exactly what an abuser wants.
       */
      rate_events: {
        Row: {
          id: number;
          actor_id: string;
          action: string;
          subject: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      contact_saves: {
        Row: {
          owner_id: string;
          subject_id: string;
          saved_at: string;
        };
        Insert: {
          owner_id: string;
          subject_id: string;
          saved_at?: string;
        };
        Update: { saved_at?: string };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          last_used_at: string | null;
        };
        // Registration goes through upsert_push_subscription() so a device that
        // changes accounts moves rather than conflicting.
        Insert: never;
        Update: { last_used_at?: string | null };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      /** SECURITY INVOKER — RLS still scopes this to the caller's own fields. */
      reorder_custom_fields: {
        Args: { field_ids: string[] };
        Returns: undefined;
      };
      /** SECURITY DEFINER (§5.1). Returns a structured status, never a bare throw. */
      connect_via_scan: {
        Args: { scanned_token: string };
        Returns: ScanResult;
      };
      /**
       * SECURITY DEFINER (§6). Returns the caller's LIVE ephemeral token,
       * minting one only if none has enough life left to be scanned.
       */
      mint_qr_token: {
        Args: Record<string, never>;
        Returns: MintedQrToken;
      };
      /**
       * SECURITY DEFINER (§6). Kills every outstanding token for the caller and
       * returns a fresh one — the immediate reset for "my screen was
       * photographed", since expiry alone takes up to 15 minutes.
       */
      rotate_qr_token: {
        Args: Record<string, never>;
        Returns: MintedQrToken;
      };
      /**
       * SECURITY DEFINER (S3). Callable by `anon` — this is the public profile
       * page's only read. Viewer-independent by design so its result can be
       * cached and shared; see HandleResolution.
       */
      resolve_handle: {
        Args: { p_handle: string };
        Returns: HandleResolution;
      };
      /**
       * SECURITY DEFINER (S3). Validates, checks the reserved list, parks the
       * outgoing handle in handle_history, and rate-limits to 2 changes per 90
       * days. Returns a structured status — a taken handle is an ordinary form
       * outcome, not an exception.
       */
      set_handle: {
        Args: { p_handle: string };
        Returns: SetHandleResult;
      };
      /**
       * SECURITY DEFINER (§9). Reads qr_tokens, which is deny-all to clients, so
       * every statement inside is scoped to auth.uid() by hand — there is no RLS
       * underneath it to catch a mistake.
       */
      networking_stats: {
        Args: Record<string, never>;
        Returns: NetworkingStats;
      };
      /**
       * SECURITY DEFINER (§5.6). Returns false for "not found", "not yours" and
       * "already disconnected" alike — distinguishing them would be an oracle.
       */
      disconnect_connection: {
        Args: { p_connection_id: string };
        Returns: boolean;
      };
      /**
       * SECURITY DEFINER (§5.6). No arguments by design: the filter is pinned to
       * auth.uid(), so it can only return the caller's own block list. Needed
       * because blocking someone also hides their profile from the blocker.
       */
      list_blocked: {
        Args: Record<string, never>;
        Returns: {
          profile_id: string;
          name: string;
          photo_url: string | null;
          blocked_at: string;
        }[];
      };
      /**
       * SECURITY DEFINER (§8). Soft-deletes and scrubs the caller's profile.
       * Never touches auth.users — that would cascade away the "Deleted account"
       * placeholder other people's connection history depends on.
       */
      delete_my_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      /**
       * SECURITY INVOKER (§11). Search + pagination + total in one round trip;
       * RLS does all the filtering, so the function holds no auth logic.
       */
      search_connections: {
        Args: { p_query?: string | null; p_limit?: number; p_offset?: number };
        Returns: {
          connection_id: string;
          profile_id: string;
          name: string;
          /** Where the row links: their public page, the only page they have. */
          handle: string;
          photo_url: string | null;
          deleted_at: string | null;
          connected_at: string;
          total_count: number;
        }[];
      };
      /** service_role only (§8 + §7). Batched; loop while `more` is true. */
      run_retention: {
        Args: { p_batch?: number };
        Returns: {
          change_events: number;
          notifications: number;
          rate_events: number;
          more: boolean;
        };
      };
      /** service_role only (§5.4). Profiles with unprocessed change events. */
      pending_change_profiles: {
        Args: { p_limit?: number };
        Returns: string[];
      };
      /**
       * service_role only (§5.4). ONE batch = ONE transaction, which is what
       * makes the advisory lock and the batch boundary the same thing.
       * Loop while `done` is false, passing back `cursor` and `batch_version`.
       */
      process_change_batch: {
        Args: {
          p_profile_id: string;
          p_cursor?: string | null;
          p_batch_version?: number | null;
          p_limit?: number;
          p_minor_threshold?: number;
        };
        Returns: {
          locked: boolean;
          done: boolean;
          cursor?: string;
          batch_version?: number;
          version?: number;
          notified?: number;
          connections?: number;
          events?: number;
        };
      };
      /** SECURITY DEFINER — moves an endpoint between accounts on a shared device. */
      upsert_push_subscription: {
        Args: {
          p_endpoint: string;
          p_p256dh: string;
          p_auth: string;
          p_user_agent?: string | null;
        };
        Returns: undefined;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
