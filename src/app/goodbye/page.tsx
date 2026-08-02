import { CenteredPage } from "@/components/page";

export const metadata = { title: "Account deleted · Skan QR" };

export default function GoodbyePage() {
  return (
    <CenteredPage>
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
      <p className="mt-6 text-xs font-semibold text-ink/70">You can close this page.</p>
    </CenteredPage>
  );
}
