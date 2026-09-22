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
