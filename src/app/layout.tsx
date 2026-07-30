import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { Archivo_Black, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { AppListeners } from "@/components/app-listeners";
import { AppShell } from "@/components/app-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The display face (docs/design lang). Every reference leans on a heavy, wide
 * grotesque for headings — that weight IS the language, and Geist at 900 is
 * still a text face wearing a bold. Single weight, so it costs one file.
 */
const archivoBlack = Archivo_Black({
  variable: "--font-archivo-black",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QR Connect",
  description: "Share your contact details with a single scan.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "QR Connect", statusBarStyle: "default" },
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
      className={`${geistSans.variable} ${geistMono.variable} ${archivoBlack.variable} h-full antialiased`}
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
              title: "!font-bold",
              description: "!text-ink/75",
              actionButton:
                "!rounded-lg !border-2 !border-ink !bg-lemon !text-ink !font-bold",
              cancelButton:
                "!rounded-lg !border-2 !border-ink !bg-paper !text-ink !font-bold",
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
