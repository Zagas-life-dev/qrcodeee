/**
 * Phone, email and custom fields, on the owner's page rather than in front of it.
 *
 * WHAT THIS REPLACED. /u/{handle} used to open with `ConnectedProfileCard` — an
 * app-styled hero card holding the same three things — drawn identically on
 * every site in the product. Everything the owner built started below it. The
 * identity is now a real block in their own site (see the permanent identity
 * migration), and this is the one part of that card that could not become a
 * block: contact details are read per viewer through RLS, so they cannot live in
 * the cached, viewer-independent site read.
 *
 * IT TAKES THE SKIN. `sk-surface`, `sk-muted` and `sk-rule-t` mean this panel is
 * styled by whatever look its owner picked, exactly like the blocks above it —
 * it belongs to the page rather than sitting on it. That is a deliberate change
 * to the boundary described in globals.css, and the boundary itself has NOT
 * gone: the actions underneath — save, connect, sign up — keep app styling under
 * every skin, because a page owner restyling the affordance that says "this is
 * Skan QR and this is what tapping does" is precisely the move a phishing page
 * would make. Showing someone's phone number is not that move; offering to save
 * it is.
 *
 * `tel:` and `mailto:` because this page's whole job is being opened on a phone
 * by someone who just met the owner. A number you have to select and copy is a
 * number you write down wrong.
 */
export function ContactDetails({
  phone,
  email,
  fields,
  showGaps = false,
}: {
  phone: string | null;
  email: string | null;
  /** `value` is nullable in the schema, so a field can exist with nothing in it. */
  fields: { label: string; value: string | null }[];
  /**
   * Render "Not provided" for empty values instead of dropping the row.
   *
   * True only when the owner is looking at their own page: §1 says a missing
   * field is never an error, and on your own page the gaps are the useful part.
   * A visitor gets the rows that exist and no inventory of the ones that don't.
   */
  showGaps?: boolean;
}) {
  const rows = [
    { label: "Phone", value: phone, href: phone ? `tel:${phone}` : null },
    { label: "Email", value: email, href: email ? `mailto:${email}` : null },
    ...fields.map((field) => ({ label: field.label, value: field.value, href: null })),
  ].filter((row) => showGaps || row.value);

  if (rows.length === 0) return null;

  return (
    <section className="sk-surface p-5">
      <h2 className="sk-muted text-xs font-semibold tracking-wide uppercase">
        Contact details
      </h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-3">
            <dt className="w-24 shrink-0 text-xs font-semibold tracking-wide uppercase">
              {row.label}
            </dt>
            <dd className="min-w-0 font-medium wrap-break-word">
              {row.value ? (
                row.href ? (
                  <a href={row.href} className="underline underline-offset-2">
                    {row.value}
                  </a>
                ) : (
                  row.value
                )
              ) : (
                <span className="sk-muted">Not provided</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
