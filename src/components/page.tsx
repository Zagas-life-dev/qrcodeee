import Link from "next/link";

/**
 * The layout vocabulary every page is built from.
 *
 * Before this there were six different `<main>` wrappers and seventeen
 * hand-rolled page headers, all nearly-but-not-quite the same — so a heading
 * that read `text-3xl leading-none` on one page read `text-2xl leading-tight` on
 * the next, and two pages that should have felt identical differed by a
 * `py-8`/`py-12` nobody chose on purpose. Placement is a decision the app should
 * make once.
 *
 * These are structure only. Nothing here knows about colour beyond the tones the
 * design language already defines, and every piece stays a plain server
 * component so pages don't pay for the layout they use.
 */

type Width = "md" | "lg" | "xl";

const WIDTHS: Record<Width, string> = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-3xl",
};

/** The standard scrolling page. */
export function Page({
  width = "lg",
  className = "",
  children,
}: {
  width?: Width;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={`mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12 ${WIDTHS[width]} ${className}`}
    >
      {children}
    </main>
  );
}

/**
 * The single-card page: sign-in, goodbye, the auth error. Vertically centred
 * because there is one thing on screen and nothing to scroll to.
 */
export function CenteredPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <div className="w-full max-w-sm rounded-brutal border-2 border-ink bg-paper p-6 shadow-brutal-lg">
        {children}
      </div>
    </main>
  );
}

/**
 * Title, optional description, optional actions.
 *
 * Actions ride on the title's row and wrap beneath it when the two don't fit;
 * the description always spans the full width below both, so a long sentence
 * never gets squeezed into a column by a button group beside it.
 */
export function PageHeader({
  title,
  description,
  actions,
  size = "lg",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** `sm` is for titles built from a person's name, which can run long. */
  size?: "sm" | "lg";
}) {
  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h1
          className={
            size === "lg"
              ? "font-display text-3xl leading-none tracking-tight"
              : "min-w-0 font-display text-2xl leading-tight tracking-tight text-balance"
          }
        >
          {title}
        </h1>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {description ? (
        <p className="mt-3 max-w-prose text-sm font-medium">{description}</p>
      ) : null}
    </header>
  );
}

export function Section({
  title,
  description,
  action,
  className = "",
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`mt-10 ${className}`}>
      {title || action ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          {title ? (
            <h2 className="font-display text-xl leading-none tracking-tight">{title}</h2>
          ) : null}
          {action}
        </div>
      ) : null}
      {description ? (
        <p className="mt-2 max-w-prose text-sm font-medium">{description}</p>
      ) : null}
      <div className={title || action || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/** The dashed "nothing here yet" box, with room for the way out of it. */
export function EmptyState({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-brutal border-2 border-dashed border-ink px-4 py-10 text-center">
      <p className="text-sm font-bold text-balance">{children}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

type Tone = "error" | "warn" | "ok" | "info";

const NOTICE_TONES: Record<Tone, string> = {
  error: "bg-coral",
  warn: "bg-lemon",
  ok: "bg-lime",
  info: "bg-paper",
};

/**
 * A message that needs a surface. The fill carries the state — this system has
 * no red or amber text to do it with, which is why tone is a fill and not a
 * colour on the words.
 */
export function Notice({
  tone = "info",
  role,
  className = "",
  children,
}: {
  tone?: Tone;
  role?: "alert" | "status";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className={`rounded-brutal border-2 border-ink p-4 text-sm font-bold shadow-brutal ${NOTICE_TONES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

/** A small count/status pill, as used beside page titles. */
export function Pill({
  tone = "info",
  className = "",
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-bold ${NOTICE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ── Actions ──────────────────────────────────────────────────────────────
   A class recipe rather than a <Button> component, because these same styles
   have to land on <button>, <Link>, <summary> and on components that already
   take a `className` (SaveContactButton). One function keeps those in step
   without forcing every caller through a wrapper element.

   Every value below is a complete literal class string, so Tailwind's scanner
   still sees them — build them by concatenating fragments and they vanish from
   the stylesheet with no error anywhere. */

type ActionTone = "primary" | "neutral" | "positive" | "danger" | "info" | "solid";
type ActionSize = "sm" | "md" | "lg";

const ACTION_TONES: Record<ActionTone, string> = {
  primary: "bg-lemon",
  neutral: "bg-paper",
  positive: "bg-lime",
  danger: "bg-coral",
  info: "bg-sky",
  /** The point of no return — account deletion's final confirm, nothing else. */
  solid: "bg-ink text-paper",
};

const ACTION_SIZES: Record<ActionSize, string> = {
  // Below the 44px touch minimum by design: `sm` is for controls that sit in a
  // cluster with generous spacing (a row's Public/Private toggle), never for
  // anything that stands alone.
  sm: "min-h-9 gap-1.5 px-3.5 text-xs",
  md: "min-h-11 gap-2 px-4 text-sm",
  lg: "min-h-12 gap-2 px-5 text-sm",
};

/** `lg` carries the full shadow and the deeper press; the rest sit lighter. */
const ACTION_LIFT: Record<ActionSize, string> = {
  sm: "shadow-brutal-sm nb-press-sm",
  md: "shadow-brutal-sm nb-press-sm",
  lg: "shadow-brutal nb-press",
};

export function actionClass({
  tone = "neutral",
  size = "md",
  block = false,
  className = "",
}: {
  tone?: ActionTone;
  size?: ActionSize;
  block?: boolean;
  className?: string;
} = {}): string {
  return [
    // inline-flex + justify-center is what makes min-h-* behave identically on
    // an <a> and a <button>; a bare anchor ignores it and comes out short.
    "inline-flex items-center justify-center rounded-brutal border-2 border-ink font-bold disabled:opacity-50",
    ACTION_TONES[tone],
    ACTION_SIZES[size],
    ACTION_LIFT[size],
    block ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The common case: a styled `next/link`. */
export function ActionLink({
  href,
  tone,
  size,
  block,
  className,
  children,
  ...rest
}: {
  href: string;
  tone?: ActionTone;
  size?: ActionSize;
  block?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link href={href} className={actionClass({ tone, size, block, className })} {...rest}>
      {children}
    </Link>
  );
}
