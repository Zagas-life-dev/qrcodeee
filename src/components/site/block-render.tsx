import {
  SOCIAL_NETWORKS,
  parseBlockContent,
  socialUrl,
  type RichDoc,
  type RichSpan,
  type LinksContent,
  type SocialsContent,
} from "@/lib/site/blocks";
import { parseBlockStyle } from "@/lib/site/block-style";
import { onAccent } from "@/lib/site/theme";
import { SocialIcon } from "@/lib/site/social-icons";
import type { SiteBlock, SiteOwner } from "@/lib/site/read";

import { USER_LINK_REL } from "./link-rel";
import { AnimatedList } from "./blocks/animated-list";
import { GalleryBlock } from "./blocks/gallery-block";
import { IdentityBlock } from "./blocks/identity-block";
import { ImageBlock } from "./blocks/image-block";
import { SocialDock } from "./blocks/social-dock";
import { StatsBlock } from "./blocks/stats-block";

/**
 * One block, rendered (site-spec S5).
 *
 * Every path through this file goes through `parseBlockContent` first, and an
 * unparseable block renders as nothing. That covers three separate cases with
 * one rule: content corrupted by a hand-crafted PostgREST write, content written
 * by a newer deploy than the one rendering it, and a block type that has been
 * removed. None of them may take down a page that other blocks are fine on.
 *
 * There is no `dangerouslySetInnerHTML` anywhere below, and there is nothing to
 * sanitise — rich text arrives as a node tree and is mapped to elements, so
 * markup can never round-trip through the database in the first place.
 */
export function BlockRender({
  block,
  owner,
}: {
  block: SiteBlock;
  /**
   * Whose page this is. Image blocks store a bare media UUID and the Cloudinary
   * path is rebuilt from this — see the note at the top of `media.ts`. It is
   * prop-drilled rather than read from a context because this component renders
   * on the server for /u/{handle} and in the client editor, and a React context
   * cannot span both.
   */
  owner: SiteOwner;
}) {
  const parsed = parseBlockContent(block.type, block.content);
  if (!parsed) return null;

  // Presentation is parsed separately from content and can never fail — a bad
  // alignment must not cost someone their text. See block-style.ts.
  const style = parseBlockStyle(block.style);

  return (
    <div
      className="site-block"
      data-align={style.align}
      data-tone={style.tone}
      // The one value here that is a NUMBER rather than an attribute, and the
      // only thing that reaches CSS as a value: clamped to [0.8, 1.75] and
      // rounded to two places by `clampBlockScale`.
      style={
        {
          "--block-scale": style.scale,
          // A block accent simply re-declares the same two custom properties
          // further down the tree, so the existing [data-tone="accent"] rule
          // picks it up with no second code path. Its foreground is derived,
          // never chosen — same guarantee as the page accent.
          ...(style.accent
            ? { "--sk-accent": style.accent, "--sk-on-accent": onAccent(style.accent) }
            : {}),
        } as React.CSSProperties
      }
    >
      <BlockBody parsed={parsed} owner={owner} />
    </div>
  );
}

function BlockBody({
  parsed,
  owner,
}: {
  parsed: NonNullable<ReturnType<typeof parseBlockContent>>;
  owner: SiteOwner;
}) {
  switch (parsed.type) {
    case "text":
      return <TextBlock doc={parsed.content.doc} />;
    case "links":
      return <LinksBlock content={parsed.content} />;
    case "socials":
      return parsed.content.variant === "dock" ? (
        <SocialDock content={parsed.content} />
      ) : (
        <SocialsBlock content={parsed.content} />
      );
    case "image":
      return <ImageBlock content={parsed.content} owner={owner} />;
    case "gallery":
      return <GalleryBlock content={parsed.content} owner={owner} />;
    case "stats":
      return <StatsBlock content={parsed.content} />;
    case "list":
      return <AnimatedList content={parsed.content} />;
    case "identity":
      return <IdentityBlock content={parsed.content} owner={owner} />;
  }
}

function Span({ span }: { span: RichSpan }) {
  let node: React.ReactNode = span.s;
  if (span.b) node = <strong className="font-semibold">{node}</strong>;
  if (span.i) node = <em>{node}</em>;

  if (span.href) {
    return (
      <a
        href={span.href}
        target="_blank"
        rel={USER_LINK_REL}
        className="underline underline-offset-2"
      >
        {node}
      </a>
    );
  }
  return <>{node}</>;
}

function Spans({ spans }: { spans: RichSpan[] }) {
  return (
    <>
      {spans.map((span, i) => (
        <Span key={i} span={span} />
      ))}
    </>
  );
}

function TextBlock({ doc }: { doc: RichDoc }) {
  return (
    <div className="sk-surface p-[1em]">
      {doc.nodes.map((node, i) => {
        switch (node.t) {
          case "h2":
            return (
              <h2 key={i} className="mt-4 text-[1.25em] leading-tight font-bold first:mt-0">
                <Spans spans={node.c} />
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="mt-3 text-[1em] leading-tight font-bold first:mt-0">
                <Spans spans={node.c} />
              </h3>
            );
          case "p":
            return (
              <p key={i} className="mt-2 text-[0.875em] font-medium first:mt-0">
                <Spans spans={node.c} />
              </p>
            );
          case "ul":
          case "ol": {
            const List = node.t === "ul" ? "ul" : "ol";
            return (
              <List
                key={i}
                className={`mt-2 space-y-1 pl-5 text-sm font-medium first:mt-0 ${
                  node.t === "ul" ? "list-disc" : "list-decimal"
                }`}
              >
                {node.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}

function LinksBlock({ content }: { content: LinksContent }) {
  return (
    <ul className="flex h-full flex-col gap-[0.5em]">
      {content.items.map((item, i) => (
        <li key={i}>
          <a
            href={item.url}
            target="_blank"
            rel={USER_LINK_REL}
            className="sk-chip flex min-h-11 items-center justify-between gap-[0.75em] px-[1em] py-[0.625em] text-[0.875em] font-semibold nb-press"
          >
            <span className="min-w-0 truncate">{item.label}</span>
            <span aria-hidden className="shrink-0">
              ↗
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function SocialsBlock({ content }: { content: SocialsContent }) {
  return (
    <ul className="flex flex-wrap gap-[0.5em]">
      {content.items.map((item, i) => (
        <li key={i}>
          <a
            href={socialUrl(item.network, item.handle)}
            target="_blank"
            rel={USER_LINK_REL}
            className="sk-chip inline-flex min-h-11 items-center gap-[0.375em] px-[0.875em] py-[0.5em] text-[0.875em] font-semibold nb-press-sm"
          >
            {/* Mark AND name, not one or the other. The mark is what gets
                recognised at a glance in a row of twelve chips; the name is what
                survives a screen reader, a high-contrast mode that drops fills,
                and the viewer who has never seen the Bluesky butterfly. The
                mark is `aria-hidden` so the pair announces once. */}
            <SocialIcon network={item.network} className="size-[1em] shrink-0" />
            <span>{SOCIAL_NETWORKS[item.network].label}</span>
            <span className="sk-muted font-normal">@{item.handle}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
