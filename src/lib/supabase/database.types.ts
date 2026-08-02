/**
 * Database types for the Skan QR schema.
 *
 * HAND-WRITTEN PLACEHOLDER — mirrors supabase/migrations/*.sql exactly, but is
 * meant to be replaced by generated output as soon as the migrations are applied:
 *
 *   npx supabase gen types typescript --project-id kandpaghwwhvmppkkgfy \
 *     > src/lib/supabase/database.types.ts
 *
 * Columns that RLS or column-grants make unwritable by clients (profile_version,
 * qr_token, deleted_at, connections.*, notifications.* other than read_at) are
 * still present on Row — you can read them — but are omitted from Insert/Update
 * where the client genuinely cannot write them, so the type system agrees with
 * the database instead of quietly disagreeing.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** §3: shape stored in profiles.qr_style. Not enforced by the DB beyond a size cap. */
export type QrStyle = {
  dotColor?: string;
  backgroundColor?: string;
  dotStyle?: "square" | "dots" | "rounded" | "extra-rounded" | "classy" | "classy-rounded";
  cornerStyle?: "square" | "dot" | "extra-rounded";
  logoUrl?: string;
};

export type NotificationType =
  | "major_change"
  | "accumulated_changes"
  | "new_connection";

/**
 * The profile payload connect_via_scan returns (§5.1). Contact details are
 * present because the connection now exists; custom_fields contains only the
 * public ones — the function filters them by hand, since SECURITY DEFINER means
 * RLS isn't doing it.
 */
/**
 * A minted QR token and the moment it stops resolving (§6).
 *
 * `expires_at` is returned rather than a duration so the client schedules its
 * refresh against the server's clock, not its own — a device with a skewed
 * clock would otherwise refresh early forever or, worse, display a dead code.
 */
export type MintedQrToken = { token: string; expires_at: string };

/**
 * Everything the analytics page renders, in one round trip.
 *
 * Note what is NOT here: any count of who saved the CALLER's card.
 * contact_saves is owner-only under a policy that calls the inverse "a
 * surveillance signal nobody consented to at scan time", and an aggregate is
 * that same signal at lower resolution — with two connections, "1 person saved
 * your card" names them. `saved` is what the caller saved, never the reverse.
 */
export type NetworkingStats = {
  active: number;
  new_30d: number;
  new_prev_30d: number;
  scans_30d: number;
  scans_total: number;
  saved: number;
  unsaved: number;
  /** Connections whose profile changed after the caller last downloaded it. */
  stale: number;
  first_connection_at: string | null;
  weeks: { week_start: string; connections: number; scans: number }[];
};

export type ScannedProfile = {
  id: string;
  name: string;
  photo_url: string | null;
  bio: string | null;
  phone: string | null;
  email: string | null;
  custom_fields: { label: string; value: string | null }[];
};

/**
 * Structured status rather than succeed/fail, so the UI can respond precisely
 * instead of showing one generic error toast (§5.1).
 *
 * Note `blocked` is only ever returned to the person who PLACED the block. The
 * blocked party gets `invalid_token`, because a distinct response would confirm
 * that one specific person blocked them — the exact fact the blocks RLS policy
 * refuses to disclose. §5.5 therefore has no "you have been blocked" toast.
 */
export type ScanResult =
  | { status: "new_connection"; connection_epoch: number; profile: ScannedProfile }
  | { status: "already_connected"; connection_epoch: number; profile: ScannedProfile }
  | { status: "self_scan" }
  | { status: "invalid_token" }
  | { status: "blocked" }
  | { status: "unauthenticated" }
  /** §7. Scans/minute, failed scans/hour, or new connections/hour. */
  | { status: "rate_limited" };

export type ReportCategory =
  | "spam"
  | "harassment"
  | "impersonation"
  | "inappropriate"
  | "scam"
  | "other";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          photo_url: string | null;
          bio: string | null;
          qr_style: Json;
          profile_version: number;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // No insert policy on profiles — rows come from handle_new_user().
        Insert: never;
        // Column grants (§4) allow exactly these four.
        Update: {
          name?: string;
          photo_url?: string | null;
          bio?: string | null;
          qr_style?: Json;
        };
        Relationships: [];
      };
      contact_details: {
        Row: {
          profile_id: string;
          phone: string | null;
          email: string | null;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          phone?: string | null;
          email?: string | null;
        };
        Update: {
          phone?: string | null;
          email?: string | null;
        };
        Relationships: [];
      };
      custom_fields: {
        Row: {
          id: string;
          profile_id: string;
          label: string;
          value: string | null;
          is_public: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          label: string;
          value?: string | null;
          is_public?: boolean;
          sort_order?: number;
        };
        Update: {
          label?: string;
          value?: string | null;
          is_public?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };
      connections: {
        Row: {
          id: string;
          user_a: string;
          user_b: string;
          connected_at: string;
          disconnected_at: string | null;
          connection_epoch: number;
          a_notified_version: number;
          b_notified_version: number;
        };
        // Writes only via connect_via_scan / disconnect RPCs (§5.1, §5.6).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      blocks: {
        Row: {
          blocker_id: string;
          blocked_id: string;
          created_at: string;
        };
        Insert: {
          blocker_id: string;
          blocked_id: string;
        };
        Update: never;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          reported_id: string;
          category: ReportCategory;
          notes: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          reporter_id: string;
          reported_id: string;
          category: ReportCategory;
          notes?: string | null;
        };
        // resolved_at is service-role only (§5.6).
        Update: never;
        Relationships: [];
      };
      profile_change_events: {
        Row: {
          id: string;
          profile_id: string;
          version: number;
          changed_fields: string[];
          is_major: boolean;
          created_at: string;
          processed_at: string | null;
        };
        // RLS on, zero policies — service role only.
        Insert: never;
        Update: {
          processed_at?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          recipient_id: string;
          type: NotificationType;
          source_profile_id: string;
          change_version: number | null;
          dedupe_seq: number;
          created_at: string;
          read_at: string | null;
        };
        Insert: never;
        // Column grant (§4) allows exactly read_at.
        Update: {
          read_at?: string | null;
        };
        Relationships: [];
      };
      /**
       * §7. RLS on with ZERO policies — clients neither read nor write this.
       * Reading it would hand a caller a precise "how close am I to the limit"
       * oracle, which is exactly what an abuser wants.
       */
      rate_events: {
        Row: {
          id: number;
          actor_id: string;
          action: string;
          subject: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      contact_saves: {
        Row: {
          owner_id: string;
          subject_id: string;
          saved_at: string;
        };
        Insert: {
          owner_id: string;
          subject_id: string;
          saved_at?: string;
        };
        Update: { saved_at?: string };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          last_used_at: string | null;
        };
        // Registration goes through upsert_push_subscription() so a device that
        // changes accounts moves rather than conflicting.
        Insert: never;
        Update: { last_used_at?: string | null };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      /** SECURITY INVOKER — RLS still scopes this to the caller's own fields. */
      reorder_custom_fields: {
        Args: { field_ids: string[] };
        Returns: undefined;
      };
      /** SECURITY DEFINER (§5.1). Returns a structured status, never a bare throw. */
      connect_via_scan: {
        Args: { scanned_token: string };
        Returns: ScanResult;
      };
      /**
       * SECURITY DEFINER (§6). Returns the caller's LIVE ephemeral token,
       * minting one only if none has enough life left to be scanned.
       */
      mint_qr_token: {
        Args: Record<string, never>;
        Returns: MintedQrToken;
      };
      /**
       * SECURITY DEFINER (§6). Kills every outstanding token for the caller and
       * returns a fresh one — the immediate reset for "my screen was
       * photographed", since expiry alone takes up to 15 minutes.
       */
      rotate_qr_token: {
        Args: Record<string, never>;
        Returns: MintedQrToken;
      };
      /**
       * SECURITY DEFINER (§9). Reads qr_tokens, which is deny-all to clients, so
       * every statement inside is scoped to auth.uid() by hand — there is no RLS
       * underneath it to catch a mistake.
       */
      networking_stats: {
        Args: Record<string, never>;
        Returns: NetworkingStats;
      };
      /**
       * SECURITY DEFINER (§5.6). Returns false for "not found", "not yours" and
       * "already disconnected" alike — distinguishing them would be an oracle.
       */
      disconnect_connection: {
        Args: { p_connection_id: string };
        Returns: boolean;
      };
      /**
       * SECURITY DEFINER (§5.6). No arguments by design: the filter is pinned to
       * auth.uid(), so it can only return the caller's own block list. Needed
       * because blocking someone also hides their profile from the blocker.
       */
      list_blocked: {
        Args: Record<string, never>;
        Returns: {
          profile_id: string;
          name: string;
          photo_url: string | null;
          blocked_at: string;
        }[];
      };
      /**
       * SECURITY DEFINER (§8). Soft-deletes and scrubs the caller's profile.
       * Never touches auth.users — that would cascade away the "Deleted account"
       * placeholder other people's connection history depends on.
       */
      delete_my_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      /**
       * SECURITY INVOKER (§11). Search + pagination + total in one round trip;
       * RLS does all the filtering, so the function holds no auth logic.
       */
      search_connections: {
        Args: { p_query?: string | null; p_limit?: number; p_offset?: number };
        Returns: {
          connection_id: string;
          profile_id: string;
          name: string;
          photo_url: string | null;
          deleted_at: string | null;
          connected_at: string;
          total_count: number;
        }[];
      };
      /** service_role only (§8 + §7). Batched; loop while `more` is true. */
      run_retention: {
        Args: { p_batch?: number };
        Returns: {
          change_events: number;
          notifications: number;
          rate_events: number;
          more: boolean;
        };
      };
      /** service_role only (§5.4). Profiles with unprocessed change events. */
      pending_change_profiles: {
        Args: { p_limit?: number };
        Returns: string[];
      };
      /**
       * service_role only (§5.4). ONE batch = ONE transaction, which is what
       * makes the advisory lock and the batch boundary the same thing.
       * Loop while `done` is false, passing back `cursor` and `batch_version`.
       */
      process_change_batch: {
        Args: {
          p_profile_id: string;
          p_cursor?: string | null;
          p_batch_version?: number | null;
          p_limit?: number;
          p_minor_threshold?: number;
        };
        Returns: {
          locked: boolean;
          done: boolean;
          cursor?: string;
          batch_version?: number;
          version?: number;
          notified?: number;
          connections?: number;
          events?: number;
        };
      };
      /** SECURITY DEFINER — moves an endpoint between accounts on a shared device. */
      upsert_push_subscription: {
        Args: {
          p_endpoint: string;
          p_p256dh: string;
          p_auth: string;
          p_user_agent?: string | null;
        };
        Returns: undefined;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
