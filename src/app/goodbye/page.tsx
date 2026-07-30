export const metadata = { title: "Account deleted · QR Connect" };

export default function GoodbyePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <div className="w-full max-w-sm rounded-brutal border-2 border-ink bg-paper p-6 shadow-brutal-lg">
        <h1 className="font-display text-2xl leading-tight tracking-tight">
          Your account is deleted
        </h1>
        <p className="mt-3 text-sm font-medium">
          Your contact details, photo, bio and custom fields are gone, and your
          QR code no longer works.
        </p>
        <p className="mt-4 text-sm font-medium">
          Anyone who already saved you to their phone still has that contact —
          that lives on their device and is out of our reach.
        </p>
        <p className="mt-6 text-xs font-bold text-ink/70">You can close this page.</p>
      </div>
    </main>
  );
}
