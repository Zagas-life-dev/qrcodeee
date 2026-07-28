export const metadata = { title: "Account deleted · QR Connect" };

export default function GoodbyePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">Your account is deleted</h1>
        <p className="mt-2 text-sm opacity-70">
          Your contact details, photo, bio and custom fields are gone, and your
          QR code no longer works.
        </p>
        <p className="mt-4 text-sm opacity-70">
          Anyone who already saved you to their phone still has that contact —
          that lives on their device and is out of our reach.
        </p>
        <p className="mt-6 text-xs opacity-50">You can close this page.</p>
      </div>
    </main>
  );
}
