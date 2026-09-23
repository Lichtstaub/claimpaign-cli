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
