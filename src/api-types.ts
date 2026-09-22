/** Shared response shapes for the org credits and org wallet endpoints. */

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

export interface WalletToken {
  unit: string;
  policyId: string;
  assetNameHex: string;
  assetNameUtf8: string;
  onChain: string;
  reserved: string;
  inFlight: string;
  available: string;
  platform: boolean;
}

export interface WalletBody {
  network: string;
  address: string;
  ada: { lovelace: string; ada: number };
  tokens: WalletToken[];
}

/** Shared response shapes for the admin campaign endpoints. */

export interface TokenBundleItem {
  unit: string;
  quantity: string;
}

/** Body sent to POST /api/admin/campaign/create. */
export interface CampaignCreateRequestBody {
  name: string;
  codePrefix: string;
  codeCount: number;
  network: 'preprod';
  adaPerClaim?: number;
  tokenBundle?: TokenBundleItem[];
  codeMode?: 'shared';
  expiresAt?: string;
  description?: string;
}

export interface CampaignPricing {
  serviceFee: number;
  perCodeCost: number;
  totalCost: number;
  tokenValue: number;
}

/**
 * The create response has several shapes (see api-contract.md variants a to f), the CLI
 * only ever reads campaign.id and campaign.status from it and loads the rest through GET.
 */
export interface CampaignCreateResponseBody {
  campaign: { id: string; status: string; [key: string]: unknown };
  pricing?: CampaignPricing;
  codes?: string[];
  pending?: boolean;
  idempotent?: boolean;
  message?: string;
}

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
  [key: string]: unknown;
}

/** GET /api/admin/campaigns response. */
export interface CampaignListResponseBody {
  campaigns: CampaignListItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
