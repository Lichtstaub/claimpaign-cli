import { apiRequest, requireToken } from '../api.js';
import { resolveApi } from '../config.js';
import { print, formatAda } from '../output.js';
import type { CreditsBody } from '../api-types.js';

/** Fetches the sandbox credits and prints them. */
export async function balance(opts: { api?: string; json: boolean }): Promise<void> {
  const token = requireToken();
  const api = resolveApi(opts.api);

  const { body } = await apiRequest<CreditsBody>({ api, token, method: 'GET', path: '/api/org/credits' });

  if (opts.json) {
    print({ credits: body }, { json: true });
    return;
  }

  print(
    `Sandbox (preprod) credits: ${formatAda(body.balance.ada)} tADA (locked in campaigns: ${formatAda(body.summary.lockedInCampaigns.ada)}, active campaigns: ${body.summary.activeCampaignCount})`,
    { json: false },
  );
}
