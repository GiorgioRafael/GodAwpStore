/**
 * TypeScript representation of the public schema created by
 * migrations in `supabase/migrations`.
 *
 * Keep this file in sync with the migrations. It intentionally includes the
 * encrypted inventory columns so the server-only service-role client can use
 * them, while database grants and RLS continue to prevent browser access.
 */

export type JsonObject = { [key: string]: Json | undefined };

export type Json =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | Json[];

type InsertRow<Row, Required extends keyof Row = never> = Partial<Row> & Pick<Row, Required>;
type UpdateRow<Row> = Partial<Row>;

type Relationship<
  Name extends string,
  Columns extends string[],
  ReferencedRelation extends string,
  ReferencedColumns extends string[],
  IsOneToOne extends boolean = false,
> = {
  foreignKeyName: Name;
  columns: Columns;
  isOneToOne: IsOneToOne;
  referencedRelation: ReferencedRelation;
  referencedColumns: ReferencedColumns;
};

type AdminProfileRow = {
  auth_user_id: string;
  discord_user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_active: boolean;
  authorization_expires_at: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

type AuditEventRow = {
  id: string;
  actor_auth_user_id: string | null;
  actor_discord_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  metadata: Json;
  created_at: string;
};

type PlatformSettingsRow = {
  id: number;
  currency_code: string;
  global_commission_bps: number;
  display_timezone: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type WhitelistEntryRow = {
  id: string;
  discord_id: string;
  label: string | null;
  notes: string | null;
  is_active: boolean;
  commission_override_bps: number | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type GameRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  status: Database["public"]["Enums"]["catalog_status"];
  sort_order: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SubstoreRow = {
  id: string;
  game_id: string;
  name: string;
  slug: string;
  title: string;
  description: string;
  color_hex: string;
  image_url: string | null;
  thumbnail_url: string | null;
  author_name: string | null;
  author_icon_url: string | null;
  footer_text: string | null;
  footer_icon_url: string | null;
  status: Database["public"]["Enums"]["catalog_status"];
  sort_order: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProductRow = {
  id: string;
  substore_id: string;
  name: string;
  slug: string;
  description: string | null;
  minimum_price_cents: number;
  image_url: string | null;
  status: Database["public"]["Enums"]["catalog_status"];
  sort_order: number;
  low_stock_threshold: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type InventoryBatchRow = {
  id: string;
  product_id: string;
  request_id: string | null;
  source: string;
  import_method: string;
  unit_count: number;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type InventoryUnitRow = {
  id: string;
  product_id: string;
  batch_id: string;
  encrypted_payload: string;
  iv: string;
  auth_tag: string;
  fingerprint: string;
  status: Database["public"]["Enums"]["inventory_unit_status"];
  reservation_expires_at: string | null;
  delivered_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type GuildRow = {
  id: string;
  discord_guild_id: string;
  owner_discord_id: string;
  whitelist_entry_id: string | null;
  name: string;
  status: Database["public"]["Enums"]["guild_status"];
  configuration: Json;
  archived_at: string | null;
  joined_at: string | null;
  left_at: string | null;
  created_at: string;
  updated_at: string;
};

type OrderRow = {
  id: string;
  guild_id: string;
  seller_whitelist_entry_id: string | null;
  product_id: string;
  inventory_unit_id: string | null;
  buyer_discord_id: string;
  status: Database["public"]["Enums"]["order_status"];
  currency_code: string;
  sale_price_cents: number;
  minimum_price_cents: number;
  commission_bps: number;
  payment_reference: string | null;
  payment_provider: string;
  payment_provider_reference: string | null;
  payment_provider_checkout_id: string | null;
  payment_checkout_url: string | null;
  payment_provider_proof_id: string | null;
  payment_status: Database["public"]["Enums"]["payment_status"];
  payment_expires_at: string | null;
  payment_provider_created_at: string | null;
  discord_ticket_channel_id: string | null;
  discord_ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
  discord_ticket_claimed_at: string | null;
  paid_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentWebhookEventRow = {
  id: string;
  provider: string;
  event_type: string;
  provider_checkout_id: string;
  provider_reference: string;
  provider_proof_id: string;
  amount_cents: number;
  currency_code: string;
  provider_created_at: string;
  reconciliation_sha256: string;
  order_id: string | null;
  state_changed: boolean;
  received_at: string;
  processed_at: string | null;
};

type PayoutRow = {
  id: string;
  whitelist_entry_id: string;
  amount_cents: number;
  currency_code: string;
  status: Database["public"]["Enums"]["payout_status"];
  destination_reference: string | null;
  notes: string | null;
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
  created_at: string;
  updated_at: string;
};

type LedgerEntryRow = {
  id: string;
  whitelist_entry_id: string;
  guild_id: string | null;
  order_id: string | null;
  payout_id: string | null;
  kind: Database["public"]["Enums"]["ledger_entry_kind"];
  status: Database["public"]["Enums"]["ledger_entry_status"];
  amount_cents: number;
  currency_code: string;
  description: string | null;
  created_by: string | null;
  available_at: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      admin_profiles: {
        Row: AdminProfileRow;
        Insert: InsertRow<AdminProfileRow, "auth_user_id" | "discord_user_id" | "display_name">;
        Update: UpdateRow<AdminProfileRow>;
        Relationships: [];
      };
      audit_events: {
        Row: AuditEventRow;
        Insert: InsertRow<AuditEventRow, "action" | "entity_type">;
        Update: UpdateRow<AuditEventRow>;
        Relationships: [
          Relationship<
            "audit_events_actor_auth_user_id_fkey",
            ["actor_auth_user_id"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      platform_settings: {
        Row: PlatformSettingsRow;
        Insert: InsertRow<PlatformSettingsRow>;
        Update: UpdateRow<PlatformSettingsRow>;
        Relationships: [
          Relationship<
            "platform_settings_updated_by_fkey",
            ["updated_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      whitelist_entries: {
        Row: WhitelistEntryRow;
        Insert: InsertRow<WhitelistEntryRow, "discord_id">;
        Update: UpdateRow<WhitelistEntryRow>;
        Relationships: [
          Relationship<
            "whitelist_entries_created_by_fkey",
            ["created_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      games: {
        Row: GameRow;
        Insert: InsertRow<GameRow, "name" | "slug">;
        Update: UpdateRow<GameRow>;
        Relationships: [
          Relationship<
            "games_created_by_fkey",
            ["created_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      substores: {
        Row: SubstoreRow;
        Insert: InsertRow<SubstoreRow, "game_id" | "name" | "slug" | "title">;
        Update: UpdateRow<SubstoreRow>;
        Relationships: [
          Relationship<
            "substores_game_id_fkey",
            ["game_id"],
            "games",
            ["id"]
          >,
          Relationship<
            "substores_created_by_fkey",
            ["created_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      products: {
        Row: ProductRow;
        Insert: InsertRow<
          ProductRow,
          "substore_id" | "name" | "slug" | "minimum_price_cents"
        >;
        Update: UpdateRow<ProductRow>;
        Relationships: [
          Relationship<
            "products_substore_id_fkey",
            ["substore_id"],
            "substores",
            ["id"]
          >,
          Relationship<
            "products_created_by_fkey",
            ["created_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      inventory_batches: {
        Row: InventoryBatchRow;
        Insert: InsertRow<InventoryBatchRow, "product_id" | "source" | "unit_count">;
        Update: UpdateRow<InventoryBatchRow>;
        Relationships: [
          Relationship<
            "inventory_batches_product_id_fkey",
            ["product_id"],
            "products",
            ["id"]
          >,
          Relationship<
            "inventory_batches_created_by_fkey",
            ["created_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      inventory_units: {
        Row: InventoryUnitRow;
        Insert: InsertRow<
          InventoryUnitRow,
          "product_id" | "batch_id" | "encrypted_payload" | "iv" | "auth_tag" | "fingerprint"
        >;
        Update: UpdateRow<InventoryUnitRow>;
        Relationships: [
          Relationship<
            "inventory_units_product_id_fkey",
            ["product_id"],
            "products",
            ["id"]
          >,
          Relationship<
            "inventory_units_batch_id_fkey",
            ["batch_id"],
            "inventory_batches",
            ["id"]
          >,
          Relationship<
            "inventory_units_created_by_fkey",
            ["created_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      guilds: {
        Row: GuildRow;
        Insert: InsertRow<GuildRow, "discord_guild_id" | "owner_discord_id" | "name">;
        Update: UpdateRow<GuildRow>;
        Relationships: [
          Relationship<
            "guilds_whitelist_entry_id_fkey",
            ["whitelist_entry_id"],
            "whitelist_entries",
            ["id"]
          >,
        ];
      };
      orders: {
        Row: OrderRow;
        Insert: InsertRow<
          OrderRow,
          | "guild_id"
          | "product_id"
          | "buyer_discord_id"
          | "sale_price_cents"
          | "minimum_price_cents"
          | "commission_bps"
        >;
        Update: UpdateRow<OrderRow>;
        Relationships: [
          Relationship<"orders_guild_id_fkey", ["guild_id"], "guilds", ["id"]>,
          Relationship<
            "orders_seller_whitelist_entry_id_fkey",
            ["seller_whitelist_entry_id"],
            "whitelist_entries",
            ["id"]
          >,
          Relationship<"orders_product_id_fkey", ["product_id"], "products", ["id"]>,
          Relationship<
            "orders_inventory_unit_id_fkey",
            ["inventory_unit_id"],
            "inventory_units",
            ["id"]
          >,
        ];
      };
      payment_webhook_events: {
        Row: PaymentWebhookEventRow;
        Insert: InsertRow<
          PaymentWebhookEventRow,
          | "provider"
          | "event_type"
          | "provider_checkout_id"
          | "provider_reference"
          | "provider_proof_id"
          | "amount_cents"
          | "currency_code"
          | "provider_created_at"
          | "reconciliation_sha256"
        >;
        Update: UpdateRow<PaymentWebhookEventRow>;
        Relationships: [
          Relationship<
            "payment_webhook_events_order_id_fkey",
            ["order_id"],
            "orders",
            ["id"]
          >,
        ];
      };
      payouts: {
        Row: PayoutRow;
        Insert: InsertRow<PayoutRow, "whitelist_entry_id" | "amount_cents">;
        Update: UpdateRow<PayoutRow>;
        Relationships: [
          Relationship<
            "payouts_whitelist_entry_id_fkey",
            ["whitelist_entry_id"],
            "whitelist_entries",
            ["id"]
          >,
          Relationship<
            "payouts_processed_by_fkey",
            ["processed_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      ledger_entries: {
        Row: LedgerEntryRow;
        Insert: InsertRow<LedgerEntryRow, "whitelist_entry_id" | "kind" | "amount_cents">;
        Update: UpdateRow<LedgerEntryRow>;
        Relationships: [
          Relationship<
            "ledger_entries_whitelist_entry_id_fkey",
            ["whitelist_entry_id"],
            "whitelist_entries",
            ["id"]
          >,
          Relationship<"ledger_entries_guild_id_fkey", ["guild_id"], "guilds", ["id"]>,
          Relationship<"ledger_entries_order_id_fkey", ["order_id"], "orders", ["id"]>,
          Relationship<"ledger_entries_payout_id_fkey", ["payout_id"], "payouts", ["id"]>,
          Relationship<
            "ledger_entries_created_by_fkey",
            ["created_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
    };
    Views: {
      effective_whitelist_commissions: {
        Row: {
          whitelist_entry_id: string;
          discord_id: string;
          commission_override_bps: number | null;
          global_commission_bps: number;
          effective_commission_bps: number;
          commission_source: string;
        };
        Relationships: [];
      };
      product_stock_summary: {
        Row: {
          product_id: string;
          product_name: string;
          substore_id: string;
          available_count: number;
          reserved_count: number;
          total_count: number;
          low_stock_threshold: number;
          is_low_stock: boolean;
          delivered_count: number;
          quarantined_count: number;
          revoked_count: number;
          product_status: Database["public"]["Enums"]["catalog_status"];
        };
        Relationships: [];
      };
      whitelist_balances: {
        Row: {
          whitelist_entry_id: string;
          discord_id: string;
          balance_cents: number;
          pending_balance_cents: number;
          available_balance_cents: number;
          total_profit_cents: number;
          total_paid_out_cents: number;
        };
        Relationships: [];
      };
      admin_dashboard_summary: {
        Row: {
          games_count: number;
          substores_count: number;
          products_count: number;
          available_units_count: number;
          low_stock_products_count: number;
          guilds_count: number;
          orders_count: number;
          delivered_orders_count: number;
          ledger_balance_cents: number;
          pending_payouts_cents: number;
        };
        Relationships: [];
      };
      admin_paid_pix_metrics: {
        Row: {
          paid_orders_count: number;
          gross_revenue_cents: number;
          gross_revenue_today_cents: number;
          gross_revenue_last_7_days_cents: number;
          gross_revenue_last_30_days_cents: number;
          average_order_cents: number;
          last_paid_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      admin_import_inventory_units: {
        Args: {
          p_product_id: string;
          p_source: string;
          p_import_method: string;
          p_units: Json;
          p_request_id: string;
        };
        Returns: { batch_id: string; imported_count: number; reused: boolean }[];
      };
      admin_get_inventory_secret: {
        Args: { p_unit_id: string };
        Returns: {
          product_id: string;
          encrypted_payload: string;
          iv: string;
          auth_tag: string;
        }[];
      };
      admin_check_inventory_fingerprints: {
        Args: { p_fingerprints: string[] };
        Returns: { fingerprint: string }[];
      };
      admin_change_inventory_status: {
        Args: {
          p_unit_id: string;
          p_status: string;
          p_reason?: string | null;
        };
        Returns: {
          id: string;
          product_id: string;
          batch_id: string;
          status: Database["public"]["Enums"]["inventory_unit_status"];
          reservation_expires_at: string | null;
          delivered_at: string | null;
          revoked_at: string | null;
          revocation_reason: string | null;
          created_at: string;
          updated_at: string;
        }[];
      };
      register_livepix_checkout: {
        Args: {
          p_order_id: string;
          p_provider_reference: string;
          p_checkout_url: string;
          p_expires_at?: string | null;
        };
        Returns: {
          registered_order_id: string;
          provider_reference: string;
          checkout_url: string;
          was_created: boolean;
        }[];
      };
      confirm_livepix_payment: {
        Args: {
          p_provider_checkout_id: string;
          p_provider_proof_id: string;
          p_provider_reference: string;
          p_amount_cents: number;
          p_currency_code: string;
          p_provider_created_at: string;
          p_reconciliation_sha256: string;
        };
        Returns: {
          processed_order_id: string;
          discord_guild_id: string;
          buyer_discord_id: string;
          product_name: string;
          paid_amount_cents: number;
          resulting_order_status: Database["public"]["Enums"]["order_status"];
          first_confirmation: boolean;
          existing_ticket_channel_id: string | null;
          ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
        }[];
      };
      claim_discord_ticket: {
        Args: { p_order_id: string };
        Returns: {
          claimed_order_id: string;
          claimed: boolean;
          discord_guild_id: string;
          buyer_discord_id: string;
          product_name: string;
          paid_amount_cents: number;
          ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
          existing_channel_id: string | null;
        }[];
      };
      complete_discord_ticket: {
        Args: { p_order_id: string; p_channel_id: string };
        Returns: {
          completed_order_id: string;
          channel_id: string;
          was_completed: boolean;
        }[];
      };
      fail_discord_ticket: {
        Args: { p_order_id: string };
        Returns: { failed_order_id: string; was_failed: boolean }[];
      };
      create_bot_order_with_reservation: {
        Args: {
          p_interaction_id: string;
          p_guild_id: string;
          p_whitelist_entry_id: string;
          p_product_id: string;
          p_buyer_discord_id: string;
          p_sale_price_cents: number;
          p_commission_bps: number;
        };
        Returns: {
          created_order_id: string | null;
          resulting_status: Database["public"]["Enums"]["order_status"];
          was_created: boolean;
          out_of_stock: boolean;
        }[];
      };
    };
    Enums: {
      catalog_status: "active" | "inactive" | "archived";
      inventory_unit_status:
        | "available"
        | "reserved"
        | "delivered"
        | "quarantined"
        | "revoked";
      guild_status: "active" | "suspended" | "left" | "archived";
      order_status:
        | "pending"
        | "awaiting_payment"
        | "paid"
        | "processing"
        | "delivered"
        | "cancelled"
        | "expired"
        | "refunded"
        | "failed";
      payment_status:
        | "uninitialized"
        | "pending"
        | "paid"
        | "expired"
        | "cancelled"
        | "refunded"
        | "failed";
      discord_ticket_status:
        | "not_created"
        | "creating"
        | "open"
        | "closed"
        | "failed";
      payout_status:
        | "requested"
        | "approved"
        | "processing"
        | "paid"
        | "rejected"
        | "cancelled"
        | "failed";
      ledger_entry_kind:
        | "sale_profit"
        | "commission"
        | "payout"
        | "payout_reversal"
        | "refund"
        | "adjustment";
      ledger_entry_status: "pending" | "available" | "settled" | "reversed";
    };
    CompositeTypes: Record<never, never>;
  };
};

export type Tables<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Row"];

export type TablesInsert<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Insert"];

export type TablesUpdate<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Update"];

export type Views<
  ViewName extends keyof Database["public"]["Views"],
> = Database["public"]["Views"][ViewName]["Row"];

export type Enums<
  EnumName extends keyof Database["public"]["Enums"],
> = Database["public"]["Enums"][EnumName];
