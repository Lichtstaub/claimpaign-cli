import { apiRequest, requireToken } from '../api.js';
import { resolveApi } from '../config.js';
import { print, table } from '../output.js';

interface CreditsBody {
  balance: { lovelace: number; ada: number };
  balances: { preprod: { lovelace: number; ada: number } };
  lockedInCampaigns: { lovelace: number; ada: number };
  activeCampaignCount: number;
}

interface WalletToken {
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

interface WalletBody {
  network: string;
  address: string;
  ada: { lovelace: string; ada: number };
  tokens: WalletToken[];
}

function formatAda(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Fetches sandbox credits and the org wallet in parallel and prints a combined summary. */
export async function balance(opts: { api?: string; json: boolean }): Promise<void> {
  const token = requireToken();
  const api = resolveApi(opts.api);

  const [credits, wallet] = await Promise.all([
    apiRequest<CreditsBody>({ api, token, method: 'GET', path: '/api/org/credits' }),
    apiRequest<WalletBody>({ api, token, method: 'GET', path: '/api/org/wallet' }),
  ]);

  if (opts.json) {
    print({ credits: credits.body, wallet: wallet.body }, { json: true });
    return;
  }

  const creditsBody = credits.body;
  const walletBody = wallet.body;

  const ownTokens = walletBody.tokens.filter(t => !t.platform);
  const platformTokens = walletBody.tokens.filter(t => t.platform);
  const rows = [...ownTokens, ...platformTokens].map(t => ({
    Token: t.assetNameUtf8 + (t.platform ? ' (platform)' : ''),
    Available: t.available,
    Reserved: t.reserved,
    Settling: t.inFlight,
  }));

  const lines = [
    `Sandbox credits: ${formatAda(creditsBody.balance.ada)} tADA (locked in campaigns: ${formatAda(creditsBody.lockedInCampaigns.ada)}, active campaigns: ${creditsBody.activeCampaignCount})`,
    `Org wallet: ${walletBody.address}  (${formatAda(walletBody.ada.ada)} tADA)`,
    '',
    table(rows),
  ];
  print(lines.join('\n'), { json: false });
}
