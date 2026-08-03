import type { StatsContent } from "@/lib/site/blocks";

import { Counter } from "./counter";

/**
 * A row of counting numbers (site-spec S5).
 *
 * Server-rendered shell, client `Counter` per value — the same split as
 * `ImageBlock`. The label, the layout and the true number are all in the
 * document; only the count-up needs the browser.
 *
 * `auto-fit` rather than a fixed column count: a stats block is as likely to sit
 * in a quarter-width bento cell as across a full band, and three stats forced
 * into three columns at 200px wide is three unreadable slivers.
 */
export function StatsBlock({ content }: { content: StatsContent }) {
  return (
    <dl className="grid h-full grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-[0.5em]">
      {content.items.map((item, index) => (
        <div
          key={index}
          className="sk-surface flex flex-col justify-center px-[0.75em] py-[1em] text-center"
        >
          {/* dd before dt in the DOM would break the pairing, so the visual
              order is done with `order`, not by reversing the markup. */}
          <dt className="sk-muted order-2 mt-1 text-[0.75em] font-medium">{item.label}</dt>
          <dd className="order-1 text-[1.875em] font-bold tabular-nums">
            <Counter value={item.value} suffix={item.suffix} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
