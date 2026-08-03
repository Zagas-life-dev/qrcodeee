-- ============================================================================
-- Per-block presentation (site-spec S7).
--
-- A SEPARATE COLUMN FROM `content`, not a key inside it. `content` is parsed by
-- a different function per block type; style is the same three fields for all
-- of them. Nesting it would mean every parser growing a copy of the same
-- alignment logic, and a corrupt style value taking the block's CONTENT down
-- with it — a bad alignment must never cost someone their text.
--
-- The 2KB cap is far above the handful of scalars this holds. It is there for
-- the same reason `content` has one: this column is writable through PostgREST
-- by its owner, and "an owner can store a megabyte per block" is a storage bill
-- rather than a feature.
-- ============================================================================

alter table site_blocks
  add column if not exists style jsonb not null default '{}'::jsonb;

alter table site_blocks
  drop constraint if exists site_blocks_style_object;
alter table site_blocks
  add constraint site_blocks_style_object
  check (jsonb_typeof(style) = 'object' and pg_column_size(style) <= 2048);

-- NOTE ON WHAT IS NOT ENFORCED HERE. There is no check constraint on the keys
-- or values inside `style`, and there should not be: the allowed alignments and
-- the scale range are product decisions that change with the CSS, and encoding
-- them in a constraint means a migration every time a design does. The renderer
-- parses this column with the same "return a well-formed value or the default"
-- rule it applies to `content`, which is where the real guarantee lives —
-- a value written by a newer deploy, or by hand, renders as the default rather
-- than as anything unexpected.
