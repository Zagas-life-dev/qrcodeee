import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { Geist_Mono, Lilita_One, Outfit } from "next/font/google";
import "./globals.css";

import { AppListeners } from "@/components/app-listeners";
import { AppShell } from "@/components/app-shell";

/**
 * The text face, named outright by docs/newdesignlang's type sheet.
 *
 * Loaded as a variable font (no `weight`), which is what lets the UI use 400 for
 * body, 500 for the labels that carry secondary hierarchy and 600 for anything
 * emphatic, all from one file. That matters more here than it did under the old
 * face: this language forbids opacity as a hierarchy tool, so weight steps are
 * doing the work instead and there have to be enough of them.
 */
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The display face. The reference specifies BullyPulpitNF, which is not
 * available as a webfont; Lilita One is the nearest Google Fonts equivalent and
 * matches on the three traits the look actually rests on — chunky weight,
 * rounded terminals, slightly condensed.
 *
 * Single weight, so it costs one file, and that is all a display face used for
 * headings and the wordmark needs.
 */
const lilitaOne = Lilita_One({
  variable: "--font-lilita-one",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Skan QR",
  description: "Share your contact details with a single scan.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Skan QR", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // The canvas, so the browser chrome and the installed app's status bar
  // continue the page rather than framing it in a leftover dark grey.
  themeColor: "#ffe27f",
  // The scanner and QR views are fixed-size targets; letting the page zoom on
  // input focus (iOS Safari's default) shifts the camera frame mid-scan.
  width: "device-width",
  initialScale: 1,
  // REQUIRED for env(safe-area-inset-*) to report anything but zero. Without
  // it the layout is letterboxed inside the safe area and every inset in the
  // stylesheet silently resolves to 0px — the bottom tab bar then sits above a
  // dead strip on a notched phone instead of filling to the edge.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${geistMono.variable} ${lilitaOne.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
        <AppListeners />
        {/* richColors is dropped in favour of the app's own fills: it ships its
            own tinted backgrounds, which would sit inside a brutalist border
            looking like a toast from a different app. The `!` modifiers are not
            decoration — sonner's own rules are attribute selectors of equal
            specificity, so without them the winner depends on stylesheet
            order. */}
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            classNames: {
              toast:
                "!rounded-brutal !border-2 !border-ink !bg-paper !text-ink !shadow-brutal !font-sans",
              title: "!font-semibold",
              // A weight step rather than a tint: this language treats opacity
              // as decoration, not as hierarchy, and a faded label on a pastel
              // toast is just a muddier pastel.
              description: "!font-medium",
              actionButton:
                "!rounded-full !border-2 !border-ink !bg-lilac !text-ink !font-semibold",
              cancelButton:
                "!rounded-full !border-2 !border-ink !bg-paper !text-ink !font-semibold",
              closeButton: "!rounded-full !border-2 !border-ink !bg-paper !text-ink",
              success: "!bg-lime",
              error: "!bg-coral",
              warning: "!bg-lemon",
            },
          }}
        />
      </body>
    </html>
  );
}
