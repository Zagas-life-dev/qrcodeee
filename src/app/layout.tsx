import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { AppListeners } from "@/components/app-listeners";
import { Nav } from "@/components/nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QR Connect",
  description: "Share your contact details with a single scan.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "QR Connect", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#111827",
  // The scanner and QR views are fixed-size targets; letting the page zoom on
  // input focus (iOS Safari's default) shifts the camera frame mid-scan.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        {children}
        <AppListeners />
        <Toaster position="top-center" closeButton richColors />
      </body>
    </html>
  );
}
