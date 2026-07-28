/**
 * Database types for the QR Connect schema.
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
          qr_token: string;
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
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
