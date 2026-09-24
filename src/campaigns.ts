import { apiRequest, ApiError, requireToken } from './api.js';
import { resolveApi } from './config.js';
import { UsageError } from './output.js';
import type { CampaignListItem, CampaignListResponseBody, TokenMeta } from './api-types.js';

/**
 * Safety cap on paginated fetches, in case a server response carries a bad or huge
 * pages value. Shared with the codes loader in commands/campaign-codes.ts.
 */
export const MAX_PAGES = 1000;

/** Campaign ids are 8 characters of the server's id alphabet, which leaves out l and o. */
const ID_PATTERN = /^[a-km-np-z2-9]{8}$/;

/** Shortest start of an id that picks a campaign, so a stray letter cannot end one. */
const MIN_ID_START = 3;

/** Loads every sandbox campaign of the key's organization across all pages, ended ones included. */
export async function loadCampaigns(apiFlag?: string): Promise<{ campaigns: CampaignListItem[]; tokenMeta: TokenMeta }> {
  const api = resolveApi(apiFlag);
  const token = requireToken();
  const campaigns: CampaignListItem[] = [];
  const tokenMeta: TokenMeta = {};
  let page = 1;
  for (;;) {
    const { body } = await apiRequest<CampaignListResponseBody>({
      api, token, method: 'GET', path: `/api/admin/campaigns?limit=100&page=${page}`,
    });
    campaigns.push(...body.campaigns);
    Object.assign(tokenMeta, body.tokenMeta);
    if (!Number.isFinite(body.pages) || page >= body.pages || page >= MAX_PAGES) break;
    page += 1;
  }
  return { campaigns, tokenMeta };
}

/**
 * Turns what the user typed into a campaign id: the id itself, the code prefix in any case,
 * or a start of the id that fits one campaign only. Anything but the exact id prints the
 * picked campaign on stderr.
 */
export async function resolveCampaignId(ref: string, apiFlag?: string): Promise<string> {
  const { campaigns } = await loadCampaigns(apiFlag);
  if (campaigns.some(c => c.id === ref)) return ref;

  const byPrefix = campaigns.find(c => c.code_prefix?.toUpperCase() === ref.toUpperCase());
  const byIdStart = ref.length >= MIN_ID_START ? campaigns.filter(c => c.id.startsWith(ref.toLowerCase())) : [];
  if (!byPrefix && byIdStart.length > 1) {
    throw new UsageError(`"${ref}" fits several campaigns (${byIdStart.map(c => c.id).join(', ')}), type more of the id or use the code prefix`);
  }

  const match = byPrefix ?? byIdStart[0];
  if (!match) throw new UsageError(`No campaign with the id or code prefix "${ref}", "claimpaign list --all" shows both`);
  process.stderr.write(`Using campaign ${match.id}, ${match.name} (${match.code_prefix})\n`);
  return match.id;
}

/**
 * Runs a campaign command for what the user typed. Something shaped like an id goes straight
 * to the command, one request as before. Anything else, or an id the server answers with 404,
 * for example a code prefix typed in lowercase, is resolved through the campaign list first.
 */
export async function withCampaign(ref: string, apiFlag: string | undefined, command: (id: string) => Promise<void>): Promise<void> {
  if (ID_PATTERN.test(ref)) {
    try {
      return await command(ref);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }
  await command(await resolveCampaignId(ref, apiFlag));
}
