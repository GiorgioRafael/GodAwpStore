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
  bot_message_config: Json;
  ticket_notification_discord_user_ids: string[];
  ticket_close_admin_discord_user_ids: string[];
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
  stock_quantity: number;
  image_url: string | null;
  discord_application_emoji_id: string | null;
  discord_application_emoji_source_sha256: string | null;
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

type GiveawayRow = {
  id: string;
  public_slug: string;
  guild_id: string;
  publication_channel_id: string;
  publication_channel_name: string;
  publication_message_id: string | null;
  publication_error: string | null;
  ticket_category_id: string | null;
  ticket_category_name: string | null;
  title: string;
  description: string;
  rules_text: string;
  starts_at: string;
  ends_at: string;
  status: Database["public"]["Enums"]["giveaway_status"];
  required_valid_invites: number;
  minimum_account_age_days: number;
  minimum_stay_minutes: number;
  winner_entry_id: string | null;
  winner_discord_user_id: string | null;
  winner_display_name: string | null;
  drawn_at: string | null;
  processing_claim_token: string | null;
  processing_claimed_at: string | null;
  discord_ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
  discord_ticket_channel_id: string | null;
  discord_ticket_claim_token: string | null;
  discord_ticket_claimed_at: string | null;
  failure_reason: string | null;
  stock_reserved_at: string;
  stock_released_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type GiveawayPrizeRow = {
  giveaway_id: string;
  position: number;
  product_id: string;
  product_name: string;
  quantity: number;
  created_at: string;
};

type GiveawayEntryRow = {
  id: string;
  giveaway_id: string;
  discord_user_id: string;
  display_name: string;
  avatar_url: string | null;
  referral_token: string;
  access_token: string;
  valid_invite_count: number;
  joined_at: string;
  membership_checked_at: string | null;
  membership_is_valid: boolean;
  membership_invalid_reason: string | null;
  updated_at: string;
};

type GiveawayReferralRow = {
  id: string;
  giveaway_id: string;
  referrer_entry_id: string;
  invitee_discord_user_id: string;
  invitee_display_name: string;
  invitee_avatar_url: string | null;
  invitee_account_created_at: string;
  joined_at: string;
  join_completed_at: string | null;
  draw_checked_at: string | null;
  draw_is_valid: boolean;
  draw_invalid_reason: string | null;
  status: Database["public"]["Enums"]["giveaway_referral_status"];
  validated_at: string | null;
  invalid_reason: string | null;
  last_checked_at: string | null;
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
  quantity: number;
  status: Database["public"]["Enums"]["order_status"];
  currency_code: string;
  subtotal_price_cents: number;
  sale_price_cents: number;
  minimum_price_cents: number;
  discount_bps: number;
  discount_amount_cents: number;
  discount_reason: string | null;
  commission_bps: number;
  payment_reference: string | null;
  payment_provider: string;
  payment_provider_reference: string | null;
  payment_provider_checkout_id: string | null;
  payment_checkout_url: string | null;
  livepix_checkout_claim_token: string | null;
  livepix_checkout_claimed_at: string | null;
  payment_provider_proof_id: string | null;
  payment_status: Database["public"]["Enums"]["payment_status"];
  payment_expires_at: string | null;
  payment_provider_created_at: string | null;
  stock_released_at: string | null;
  stock_release_reason: string | null;
  late_payment_detected_at: string | null;
  discord_ticket_channel_id: string | null;
  discord_ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
  discord_ticket_claimed_at: string | null;
  discord_ticket_close_claim_token: string | null;
  discord_ticket_close_claimed_at: string | null;
  discord_ticket_close_claimed_by_discord_user_id: string | null;
  discord_ticket_closed_at: string | null;
  discord_ticket_closed_by_discord_user_id: string | null;
  game_nickname: string | null;
  game_nickname_submitted_at: string | null;
  paid_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

type OrderItemRow = {
  order_id: string;
  position: number;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  subtotal_price_cents: number;
  sale_price_cents: number;
  discount_amount_cents: number;
  created_at: string;
};

type OrderInventoryUnitRow = {
  order_id: string;
  inventory_unit_id: string;
  position: number;
  created_at: string;
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
      giveaways: {
        Row: GiveawayRow;
        Insert: InsertRow<
          GiveawayRow,
          | "public_slug"
          | "guild_id"
          | "publication_channel_id"
          | "publication_channel_name"
          | "title"
          | "starts_at"
          | "ends_at"
          | "status"
        >;
        Update: UpdateRow<GiveawayRow>;
        Relationships: [
          Relationship<"giveaways_guild_id_fkey", ["guild_id"], "guilds", ["id"]>,
          Relationship<
            "giveaways_winner_entry_fkey",
            ["winner_entry_id"],
            "giveaway_entries",
            ["id"]
          >,
          Relationship<
            "giveaways_created_by_fkey",
            ["created_by"],
            "admin_profiles",
            ["auth_user_id"]
          >,
        ];
      };
      giveaway_prizes: {
        Row: GiveawayPrizeRow;
        Insert: InsertRow<
          GiveawayPrizeRow,
          "giveaway_id" | "position" | "product_id" | "product_name" | "quantity"
        >;
        Update: UpdateRow<GiveawayPrizeRow>;
        Relationships: [
          Relationship<
            "giveaway_prizes_giveaway_id_fkey",
            ["giveaway_id"],
            "giveaways",
            ["id"]
          >,
          Relationship<
            "giveaway_prizes_product_id_fkey",
            ["product_id"],
            "products",
            ["id"]
          >,
        ];
      };
      giveaway_entries: {
        Row: GiveawayEntryRow;
        Insert: InsertRow<
          GiveawayEntryRow,
          "giveaway_id" | "discord_user_id" | "display_name"
        >;
        Update: UpdateRow<GiveawayEntryRow>;
        Relationships: [
          Relationship<
            "giveaway_entries_giveaway_id_fkey",
            ["giveaway_id"],
            "giveaways",
            ["id"]
          >,
        ];
      };
      giveaway_referrals: {
        Row: GiveawayReferralRow;
        Insert: InsertRow<
          GiveawayReferralRow,
          | "giveaway_id"
          | "referrer_entry_id"
          | "invitee_discord_user_id"
          | "invitee_display_name"
          | "invitee_account_created_at"
        >;
        Update: UpdateRow<GiveawayReferralRow>;
        Relationships: [
          Relationship<
            "giveaway_referrals_giveaway_id_fkey",
            ["giveaway_id"],
            "giveaways",
            ["id"]
          >,
          Relationship<
            "giveaway_referrals_referrer_entry_id_fkey",
            ["referrer_entry_id"],
            "giveaway_entries",
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
          | "subtotal_price_cents"
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
      order_items: {
        Row: OrderItemRow;
        Insert: InsertRow<
          OrderItemRow,
          | "order_id"
          | "position"
          | "product_id"
          | "quantity"
          | "unit_price_cents"
          | "subtotal_price_cents"
          | "sale_price_cents"
        >;
        Update: UpdateRow<OrderItemRow>;
        Relationships: [
          Relationship<"order_items_order_id_fkey", ["order_id"], "orders", ["id"]>,
          Relationship<
            "order_items_product_id_fkey",
            ["product_id"],
            "products",
            ["id"]
          >,
        ];
      };
      order_inventory_units: {
        Row: OrderInventoryUnitRow;
        Insert: InsertRow<OrderInventoryUnitRow, "order_id" | "inventory_unit_id" | "position">;
        Update: UpdateRow<OrderInventoryUnitRow>;
        Relationships: [
          Relationship<
            "order_inventory_units_order_id_fkey",
            ["order_id"],
            "orders",
            ["id"]
          >,
          Relationship<
            "order_inventory_units_inventory_unit_id_fkey",
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
      admin_reorder_products: {
        Args: { p_product_ids: string[] };
        Returns: number;
      };
      admin_create_giveaway: {
        Args: {
          p_public_slug: string;
          p_guild_id: string;
          p_publication_channel_id: string;
          p_publication_channel_name: string;
          p_ticket_category_id: string | null;
          p_ticket_category_name: string | null;
          p_title: string;
          p_description: string;
          p_rules_text: string;
          p_starts_at: string;
          p_ends_at: string;
          p_required_valid_invites: number;
          p_minimum_account_age_days: number;
          p_minimum_stay_minutes: number;
          p_prizes: Json;
        };
        Returns: {
          created_giveaway_id: string;
          created_status: Database["public"]["Enums"]["giveaway_status"];
          created_public_slug: string;
        }[];
      };
      admin_create_giveaway_v2: {
        Args: {
          p_public_slug: string;
          p_guild_id: string;
          p_publication_channel_id: string;
          p_publication_channel_name: string;
          p_ticket_category_id: string | null;
          p_ticket_category_name: string | null;
          p_title: string;
          p_description: string;
          p_rules_text: string;
          p_ends_at: string;
          p_required_valid_invites: number;
          p_minimum_account_age_days: number;
          p_minimum_stay_minutes: number;
          p_prizes: Json;
        };
        Returns: {
          created_giveaway_id: string;
          created_status: Database["public"]["Enums"]["giveaway_status"];
          created_public_slug: string;
        }[];
      };
      admin_cancel_giveaway: {
        Args: { p_giveaway_id: string };
        Returns: { cancelled_giveaway_id: string; was_cancelled: boolean }[];
      };
      record_giveaway_publication: {
        Args: { p_giveaway_id: string; p_message_id: string | null; p_error: string | null };
        Returns: boolean;
      };
      register_giveaway_participant: {
        Args: {
          p_giveaway_id: string;
          p_discord_user_id: string;
          p_display_name: string;
          p_avatar_url: string | null;
        };
        Returns: {
          entry_id: string;
          referral_token: string;
          valid_invite_count: number;
          was_created: boolean;
        }[];
      };
      register_giveaway_referral: {
        Args: {
          p_giveaway_id: string;
          p_referral_token: string;
          p_invitee_discord_user_id: string;
          p_invitee_display_name: string;
          p_invitee_avatar_url: string | null;
          p_invitee_account_created_at: string;
          p_initially_valid: boolean;
        };
        Returns: {
          referral_id: string;
          referral_status: Database["public"]["Enums"]["giveaway_referral_status"];
          was_created: boolean;
        }[];
      };
      set_giveaway_referral_status: {
        Args: {
          p_referral_id: string;
          p_status: Database["public"]["Enums"]["giveaway_referral_status"];
          p_invalid_reason: string | null;
        };
        Returns: boolean;
      };
      prepare_giveaway_referral: {
        Args: {
          p_giveaway_id: string;
          p_referral_token: string;
          p_invitee_discord_user_id: string;
          p_invitee_display_name: string;
          p_invitee_avatar_url: string | null;
          p_invitee_account_created_at: string;
        };
        Returns: {
          referral_id: string;
          referral_status: Database["public"]["Enums"]["giveaway_referral_status"];
          was_created: boolean;
          join_completed_at: string | null;
        }[];
      };
      complete_giveaway_referral_join: {
        Args: {
          p_referral_id: string;
          p_joined_at: string;
          p_initially_valid: boolean;
        };
        Returns: {
          referral_id: string;
          referral_status: Database["public"]["Enums"]["giveaway_referral_status"];
          was_completed: boolean;
        }[];
      };
      activate_due_giveaways: { Args: Record<never, never>; Returns: number };
      activate_due_giveaways_v2: {
        Args: Record<never, never>;
        Returns: { giveaway_id: string }[];
      };
      claim_due_giveaway: {
        Args: { p_claim_token: string };
        Returns: {
          giveaway_id: string;
          discord_guild_id: string;
          required_valid_invites: number;
        }[];
      };
      claim_due_giveaway_v2: {
        Args: { p_claim_token: string };
        Returns: {
          giveaway_id: string;
          discord_guild_id: string;
          required_valid_invites: number;
          minimum_stay_minutes: number;
          ends_at: string;
        }[];
      };
      mark_giveaway_entry_membership: {
        Args: {
          p_giveaway_id: string;
          p_claim_token: string;
          p_entry_id: string;
          p_is_valid: boolean;
          p_invalid_reason: string | null;
        };
        Returns: boolean;
      };
      mark_giveaway_referral_draw_status: {
        Args: {
          p_giveaway_id: string;
          p_claim_token: string;
          p_referral_id: string;
          p_is_valid: boolean;
          p_invalid_reason: string | null;
        };
        Returns: boolean;
      };
      pick_giveaway_winner: {
        Args: { p_giveaway_id: string; p_claim_token: string };
        Returns: { entry_id: string; discord_user_id: string }[];
      };
      complete_giveaway_draw: {
        Args: {
          p_giveaway_id: string;
          p_claim_token: string;
          p_winner_entry_id: string | null;
        };
        Returns: {
          completed_giveaway_id: string;
          resulting_status: Database["public"]["Enums"]["giveaway_status"];
          winner_discord_user_id: string | null;
        }[];
      };
      complete_giveaway_draw_v2: {
        Args: {
          p_giveaway_id: string;
          p_claim_token: string;
          p_winner_entry_id: string | null;
        };
        Returns: {
          completed_giveaway_id: string;
          resulting_status: Database["public"]["Enums"]["giveaway_status"];
          winner_discord_user_id: string | null;
        }[];
      };
      claim_giveaway_ticket: {
        Args: { p_claim_token: string };
        Returns: {
          giveaway_id: string;
          discord_guild_id: string;
          winner_discord_user_id: string;
          winner_display_name: string;
          ticket_category_id: string | null;
          giveaway_title: string;
          prizes: Json;
        }[];
      };
      complete_giveaway_ticket: {
        Args: { p_giveaway_id: string; p_claim_token: string; p_channel_id: string };
        Returns: boolean;
      };
      fail_giveaway_ticket: {
        Args: { p_giveaway_id: string; p_claim_token: string; p_error: string | null };
        Returns: boolean;
      };
      admin_giveaway_entry_counts: {
        Args: { p_giveaway_ids: string[] };
        Returns: {
          giveaway_id: string;
          participant_count: number;
          eligible_participant_count: number;
        }[];
      };
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
      claim_livepix_checkout: {
        Args: { p_order_id: string; p_claim_token: string };
        Returns: {
          claimed_order_id: string;
          claimed: boolean;
          provider_reference: string | null;
          checkout_url: string | null;
        }[];
      };
      register_claimed_livepix_checkout: {
        Args: {
          p_order_id: string;
          p_claim_token: string;
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
      release_livepix_checkout_claim: {
        Args: { p_order_id: string; p_claim_token: string };
        Returns: boolean;
      };
      expire_unpaid_orders: {
        Args: { p_batch_size?: number };
        Returns: {
          expired_order_id: string;
          expired_product_id: string;
          restored_quantity: number;
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
          order_quantity: number;
        }[];
      };
      claim_discord_ticket_close: {
        Args: {
          p_order_id: string;
          p_discord_guild_id: string;
          p_ticket_channel_id: string;
          p_closed_by_discord_user_id: string;
          p_claim_token: string;
        };
        Returns: {
          claimed_order_id: string;
          claimed: boolean;
          already_closed: boolean;
          ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
          ticket_channel_id: string;
          claim_token: string | null;
          claim_expires_at: string | null;
          closed_at: string | null;
          closed_by_discord_user_id: string | null;
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
      complete_discord_ticket_close: {
        Args:
          | {
              p_order_id: string;
              p_ticket_channel_id: string;
              p_claim_token: string;
            }
          | {
              p_order_id: string;
              p_ticket_channel_id: string;
              p_claim_token: string;
              p_completion_source:
                | "discord_http_interaction"
                | "discord_close_reconciliation";
            };
        Returns: {
          completed_order_id: string;
          was_closed: boolean;
          ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
          ticket_channel_id: string;
          closed_at: string;
          closed_by_discord_user_id: string | null;
        }[];
      };
      fail_discord_ticket: {
        Args: { p_order_id: string };
        Returns: { failed_order_id: string; was_failed: boolean }[];
      };
      release_discord_ticket_close: {
        Args: { p_order_id: string; p_claim_token: string };
        Returns: {
          released_order_id: string;
          released: boolean;
          ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
        }[];
      };
      renew_discord_ticket_close_claim: {
        Args: {
          p_order_id: string;
          p_ticket_channel_id: string;
          p_claim_token: string;
        };
        Returns: {
          renewed_order_id: string;
          renewed: boolean;
          active: boolean;
          ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
          ticket_channel_id: string;
          claim_expires_at: string | null;
        }[];
      };
      reconcile_missing_discord_ticket: {
        Args: { p_order_id: string; p_ticket_channel_id: string };
        Returns: {
          reconciled_order_id: string;
          was_closed: boolean;
          ticket_status: Database["public"]["Enums"]["discord_ticket_status"];
          ticket_channel_id: string;
          closed_at: string;
          closed_by_discord_user_id: string | null;
        }[];
      };
      submit_paid_order_game_nickname: {
        Args: {
          p_order_id: string;
          p_buyer_discord_id: string;
          p_discord_guild_id: string;
          p_ticket_channel_id: string;
          p_game_nickname: string;
        };
        Returns: {
          order_id: string;
          game_nickname: string;
          was_created: boolean;
          was_changed: boolean;
        }[];
      };
      get_paid_order_summary: {
        Args: {
          p_created_from?: string | null;
          p_created_to?: string | null;
        };
        Returns: {
          paid_orders_count: number;
          total_received_cents: number;
        }[];
      };
      create_bot_order_with_reservation: {
        Args: {
          p_interaction_id: string;
          p_guild_id: string;
          p_whitelist_entry_id: string;
          p_product_id: string;
          p_buyer_discord_id: string;
          p_quantity: number;
          p_subtotal_price_cents: number;
          p_sale_price_cents: number;
          p_discount_bps: number;
          p_discount_amount_cents: number;
          p_discount_reason: string | null;
          p_commission_bps: number;
        };
        Returns: {
          created_order_id: string | null;
          resulting_status: Database["public"]["Enums"]["order_status"];
          was_created: boolean;
          out_of_stock: boolean;
        }[];
      };
      create_bot_cart_with_reservation: {
        Args: {
          p_interaction_id: string;
          p_guild_id: string;
          p_whitelist_entry_id: string;
          p_buyer_discord_id: string;
          p_items: Json;
          p_discount_bps: number;
          p_discount_reason: string | null;
          p_commission_bps: number;
        };
        Returns: {
          checkout_order_id: string | null;
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
      giveaway_status:
        | "scheduled"
        | "active"
        | "drawing"
        | "completed"
        | "cancelled"
        | "failed";
      giveaway_referral_status: "pending" | "valid" | "invalid";
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
