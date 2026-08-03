"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { BLOCK_CATALOGUE } from "@/lib/site/blocks";
import { newId } from "@/lib/site/mutations";
import { useSiteStore } from "@/lib/site/store";
import type { SectionLayout } from "@/lib/supabase/database.types";

/**
 * First-run onboarding — react-bits `Stepper`, adapted (site-spec S4).
 *
 * WHY A WIZARD HERE AND NOWHERE ELSE. An empty page editor is a wall of
 * controls with nothing to apply them to: sections, layouts, block types,
 * visibility and a publish toggle, none of which mean anything until something
 * exists. The steps below exist to get one section and one block onto the page,
 * after which the real editor is self-explanatory and this never appears again.
 *
 * WHAT CHANGED FROM UPSTREAM:
 *
 * - **The steps are not free-form children.** Upstream is a generic container
 *   you fill with `<Step>`s; this owns its three, because they are a sequence
 *   of server actions with a shared pending state rather than a form split
 *   across pages.
 * - **No back button on the last step.** Upstream always offers one. Here the
 *   final step has already written rows — "back" from it would mean undoing
 *   them, and a wizard that silently deletes what it made is worse than one
 *   that ends.
 * - **The slide is `AnimatePresence` with a height measure removed.** Upstream
 *   animates the container's height to the step's; the three steps here are
 *   close enough in height that measuring buys a reflow per transition and
 *   nothing visible.
 *
 * WHY THERE IS NO ASYNC LEFT IN HERE. Each step used to await its server action
 * before advancing, which made the wizard the slowest surface in the app — three
 * round trips to do what is now three local writes — and gave it a failure mode
 * where the section existed but the step never advanced. Steps now advance
 * immediately and the queue in store.tsx delivers behind them, so the whole
 * sequence can be completed on a train with no signal.
 */
const LAYOUT_CHOICES: { value: SectionLayout; label: string; hint: string }[] = [
  { value: "single", label: "One after another", hint: "Simplest. Good default." },
  { value: "bento", label: "A grid of panes", hint: "Split the space up." },
];

// The starting blocks worth suggesting. Not the full catalogue: a first-run
// screen offering seven choices is the same wall this replaces.
const STARTERS = BLOCK_CATALOGUE.filter((entry) =>
  ["identity", "text", "image", "links"].includes(entry.type),
);

export function OnboardingStepper({ onDone }: { onDone: () => void }) {
  const { mutate } = useSiteStore();
  const [step, setStep] = useState(0);
  const [layout, setLayout] = useState<SectionLayout>("single");

  /**
   * The section this wizard is filling, known before it exists.
   *
   * This is what replaced `newestSectionId`. Step two has to put a block into
   * the section step one made, and with server-assigned ids the only way to name
   * it was to ask the server which section was newest — a question with a wrong
   * answer if another tab was open, and one more round trip in a sequence that
   * was already three.
   */
  const [sectionId] = useState(newId);

  return (
    <section className="rounded-brutal border-2 border-ink bg-paper p-4 shadow-brutal">
      <ol className="flex items-center gap-2" aria-label="Setup progress">
        {["Layout", "First block", "Publish"].map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={step === index ? "step" : undefined}
              className={`flex size-7 items-center justify-center rounded-full border-2 border-ink text-xs font-bold ${
                index < step ? "bg-lime" : index === step ? "bg-lilac" : "bg-paper"
              }`}
            >
              {index < step ? "✓" : index + 1}
            </span>
            <span className="text-xs font-semibold">{label}</span>
            {index < 2 ? <span aria-hidden className="text-ink/40">→</span> : null}
          </li>
        ))}
      </ol>

      {/* `mode="wait"` so the outgoing step is gone before the next arrives —
          two absolutely-positioned steps overlapping mid-transition is how the
          buttons end up stacked on a narrow screen. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="mt-4"
        >
          {step === 0 ? (
            <div>
              <h2 className="font-display text-lg">How should this band look?</h2>
              <p className="mt-1 text-sm font-medium">
                A section is one band across your page. You can add more later,
                and change this whenever you like.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {LAYOUT_CHOICES.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    aria-pressed={layout === choice.value}
                    onClick={() => setLayout(choice.value)}
                    className={`rounded-brutal border-2 border-ink p-3 text-left shadow-brutal-sm nb-press-sm ${
                      layout === choice.value ? "bg-lilac" : "bg-paper"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{choice.label}</span>
                    <span className="mt-1 block text-xs font-medium">{choice.hint}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  mutate({ kind: "addSection", sectionId, layout });
                  setStep(1);
                }}
                className="mt-4 min-h-11 rounded-full border-2 border-ink bg-lilac px-4 text-sm font-semibold shadow-brutal nb-press"
              >
                Add this section
              </button>
            </div>
          ) : null}

          {step === 1 ? (
            <div>
              <h2 className="font-display text-lg">What goes in it first?</h2>
              <p className="mt-1 text-sm font-medium">
                Pick one to start. You can add the rest — galleries, numbers,
                lists — from the section itself.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {STARTERS.map((entry) => (
                  <button
                    key={entry.type}
                    type="button"
                    onClick={() => {
                      mutate({
                        kind: "addBlock",
                        sectionId,
                        blockId: newId(),
                        type: entry.type,
                      });
                      setStep(2);
                    }}
                    className="min-h-11 rounded-full border-2 border-ink bg-paper px-4 text-sm font-semibold shadow-brutal-sm nb-press-sm"
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <h2 className="font-display text-lg">Ready when you are.</h2>
              <p className="mt-1 text-sm font-medium">
                Your page is still hidden. Publishing shows these sections to
                anyone who opens your link — your contact card is already there
                either way.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    mutate({ kind: "setPublished", published: true });
                    onDone();
                  }}
                  className="min-h-11 rounded-full border-2 border-ink bg-lime px-4 text-sm font-semibold shadow-brutal nb-press"
                >
                  Publish my page
                </button>
                {/* Was a sentence saying you could skip, with nothing to skip
                    with. The wizard now has an end that isn't publishing, so it
                    needs a way to reach it. */}
                <button
                  type="button"
                  onClick={onDone}
                  className="min-h-11 rounded-full border-2 border-ink bg-paper px-4 text-sm font-semibold shadow-brutal-sm nb-press-sm"
                >
                  Not yet
                </button>
              </div>
              <p className="mt-2 text-xs font-medium text-ink/70">
                Everything below still works either way, and you can publish any
                time.
              </p>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
