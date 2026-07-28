import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

import { NotificationBell } from "./notification-bell";

const LINKS = [
  { href: "/qr", label: "My code" },
  { href: "/scan", label: "Scan" },
  { href: "/connections", label: "Connections" },
  { href: "/profile", label: "Profile" },
];

/** Renders nothing when signed out, so /login and /connect keep a clean shell. */
export async function Nav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Server-rendered starting count so the badge is correct on first paint
  // instead of flashing in after the client subscribes.
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return (
    <header className="border-b border-current/10">
      <nav className="mx-auto flex w-full max-w-3xl items-center gap-1 px-6 py-3 text-sm">
        <Link href="/qr" className="mr-3 font-semibold tracking-tight">
          QR Connect
        </Link>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md px-2.5 py-1.5 opacity-70 transition hover:bg-current/5 hover:opacity-100"
          >
            {link.label}
          </Link>
        ))}
        <NotificationBell userId={user.id} initialCount={count ?? 0} />
      </nav>
    </header>
  );
}
