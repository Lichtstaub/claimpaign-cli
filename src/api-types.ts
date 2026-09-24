/** Shared response shape for the org credits endpoint. */

export interface CreditsBody {
  network: string;
  businessComplete: boolean;
  balance: { lovelace: number; ada: number };
  balances: { preprod: { lovelace: number; ada: number } };
  summary: {
    totalDeposited: { lovelace: number; ada: number };
    lockedInCampaigns: { lovelace: number; ada: number };
    activeCampaignCount: number;
  };
  platformAddress: string;
  transactions: unknown[];
}

/** Shared response shapes for the admin campaign endpoints. */

export interface CampaignCode {
  code: string;
  status: string;
  address: string | null;
  claim_status: string | null;
  claimed_at: string | null;
  tx_hash: string | null;
}

export interface CampaignFields {
  id: string;
  name: string;
  status: string;
  code_prefix: string;
  code_mode: string;
  total_codes: number;
  codes_claimed: number;
  created_at: string;
  [key: string]: unknown;
}

/** GET /api/admin/campaign/<id> response. */
export interface CampaignGetResponseBody {
  campaign: CampaignFields;
  codes: CampaignCode[];
  queue: { pending: number; queued: number; processing: number };
  pagination: { total: number; page: number; limit: number; pages: number };
}

export interface CampaignListItem {
  id: string;
  name: string;
  status: string;
  total_codes: number;
  codes_claimed: number;
  code_prefix: string;
  code_mode: string;
  network: string;
  created_at: string;
  /** Lovelace per claim, before the min UTxO floor of token and NFT campaigns. */
  ada_per_claim?: number;
  campaign_type?: string;
  /** Tokens per claim as a JSON array of TokenBundleItem, stored as a string. */
  token_bundle?: string | null;
  has_tokens?: number;
  has_nft?: number;
  [key: string]: unknown;
}

export interface TokenBundleItem { unit: string; quantity: string }

export type TokenMeta = Record<string, { ticker: string; decimals: number }>;

/** GET /api/admin/campaigns response. */
export interface CampaignListResponseBody {
  campaigns: CampaignListItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  /** Ticker and decimals of the tokens in this page's campaigns, null when none are known. */
  tokenMeta?: TokenMeta | null;
}
