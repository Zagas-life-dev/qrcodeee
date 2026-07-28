-- ============================================================================
-- §5.7: "show both timestamps side by side — e.g. 'QR Connect profile: updated
-- today' vs 'Phone contact: last saved March 2026'."
--
-- Nothing in the spec's schema recorded the second one, so it could not be
-- displayed. This is that store.
--
-- IMPORTANT about what this actually means. A browser cannot observe the OS
-- writing a contact — Web Share resolves when the sheet is dismissed, a download
-- resolves when bytes hit disk. So this records that the card was GENERATED AND
-- HANDED OVER, not that it was saved. The UI copy has to match that (§1: never
-- overclaim), which is why the label is "card last downloaded" rather than
-- "contact last saved". Still useful: it is a real lower bound on how stale
-- someone's address book entry might be, which is the question §5.7 is asking.
-- ============================================================================

create table contact_saves (
  owner_id uuid not null references profiles(id) on delete cascade,
  subject_id uuid not null references profiles(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (owner_id, subject_id),
  constraint no_self_save check (owner_id <> subject_id)
);

alter table contact_saves enable row level security;

-- Strictly private to the person who downloaded. The subject must NOT be able to
-- read this: "who has downloaded my card, and when" is a surveillance signal
-- nobody consented to at scan time, and it is not needed by anything.
create policy "owner manages their own contact saves"
  on contact_saves for all using (owner_id = auth.uid());
