import { apiRequest, ApiError, requireToken, sleep } from '../api.js';
import { resolveApi, webCreateUrl } from '../config.js';
import { print, table } from '../output.js';
import { MAX_PAGES } from './campaign-codes.js';
import type { CampaignGetResponseBody, CampaignListItem, CampaignListResponseBody } from '../api-types.js';

const DEFAULT_END_WAIT_MS = 20_000;
const DEFAULT_END_WAIT_TIMEOUT_MS = 900_000;

/**
 * Campaigns are created in the web interface since 0.2.0. This points there and fails with
 * exit 1. It sends no request and needs no login, so it behaves the same against every
 * server version.
 */
export function campaignCreateMoved(opts: { api?: string; json: boolean }): never {
  const createUrl = webCreateUrl(resolveApi(opts.api));
  if (opts.json) print({ createUrl }, { json: true });
  throw new Error(`Campaigns are created in the web interface at ${createUrl}, export the codes afterwards with "claimpaign campaign codes <id>".`);
}

/** Lists sandbox campaigns across all pages. */
export async function campaignList(opts: { api?: string; json: boolean }): Promise<void> {
  const token = requireToken();
  const api = resolveApi(opts.api);

  const campaigns: CampaignListItem[] = [];
  let page = 1;
  for (;;) {
    const { body } = await apiRequest<CampaignListResponseBody>({
      api, token, method: 'GET', path: `/api/admin/campaigns?limit=100&page=${page}`,
    });
    campaigns.push(...body.campaigns);
    if (!Number.isFinite(body.pages) || page >= body.pages || page >= MAX_PAGES) break;
    page += 1;
  }

  if (opts.json) {
    print({ campaigns }, { json: true });
    return;
  }

  const rows = campaigns.map(c => ({
    id: c.id,
    name: c.name,
    status: c.status,
    'claimed/capacity': `${c.codes_claimed}/${c.total_codes}`,
    prefix: c.code_prefix,
    created: c.created_at,
  }));
  print(table(rows), { json: false });
}

/** Shows one campaign's status, progress and claim queue. */
export async function campaignStatus(id: string, opts: { api?: string; json: boolean }): Promise<void> {
  const token = requireToken();
  const api = resolveApi(opts.api);

  const { body } = await apiRequest<CampaignGetResponseBody>({
    api, token, method: 'GET', path: `/api/admin/campaign/${id}?page=1&limit=200`,
  });

  if (opts.json) {
    print(body, { json: true });
    return;
  }

  const c = body.campaign;
  const lines = [
    `Campaign: ${c.id}`,
    `Name: ${c.name}`,
    `Status: ${c.status}`,
    `Prefix: ${c.code_prefix}`,
    `Mode: ${c.code_mode}`,
    `Progress: ${c.codes_claimed}/${c.total_codes}`,
    `Queue pending: ${body.queue.pending}`,
    `Created: ${c.created_at}`,
  ];
  print(lines.join('\n'), { json: false });
}

/** Pulls the server's error text out of a management endpoint's error body, empty string when it has none. */
function errorText(body: unknown): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return '';
}

function formatLovelace(lovelace: number): string {
  return (lovelace / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface CampaignEndOpts {
  api?: string;
  json: boolean;
  wait?: boolean;
  waitMs?: number;
  waitTimeoutMs?: number;
}

/**
 * Ends a sandbox campaign. A 409 that names payouts as closing means the campaign is
 * mid settlement, without --wait this fails fast, with --wait it retries every waitMs
 * (default 20s) until the server accepts the end or waitTimeoutMs (default 15 minutes)
 * runs out. Any other 409 or a 400 propagates as an ApiError with the server's text.
 */
export async function campaignEnd(id: string, opts: CampaignEndOpts): Promise<void> {
  const token = requireToken();
  const api = resolveApi(opts.api);
  const waitMs = opts.waitMs ?? DEFAULT_END_WAIT_MS;
  const waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_END_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + waitTimeoutMs;

  for (;;) {
    const res = await apiRequest<{ ok: boolean; status: string; refunded?: number }>({
      api, token, method: 'PATCH', path: `/api/admin/campaign/${id}`, body: { status: 'ended' }, allow: [409],
    });

    if (res.status === 200) {
      if (opts.json) print(res.body, { json: true });
      else print(`Campaign ${id} ended, refunded ${formatLovelace(res.body.refunded ?? 0)} tADA`, { json: false });
      return;
    }

    const message = errorText(res.body);
    if (!message.includes('closing')) throw new ApiError(409, message || 'HTTP 409', res.body);
    if (!opts.wait) throw new Error('Payouts are still settling, run again with --wait');
    if (Date.now() >= deadline) {
      throw new Error(`Campaign ${id} payouts are still settling after ${Math.round(waitTimeoutMs / 60_000)} minutes. Run again to keep waiting.`);
    }
    process.stderr.write('Payouts are still settling, retrying...\n');
    await sleep(waitMs);
  }
}

/** Pauses or resumes a sandbox campaign. A 409 for an invalid transition propagates as an ApiError with the server's text. */
async function setCampaignStatus(id: string, status: 'paused' | 'active', opts: { api?: string; json: boolean }, verb: string): Promise<void> {
  const token = requireToken();
  const api = resolveApi(opts.api);

  const { body } = await apiRequest<{ ok: boolean; status: string }>({
    api, token, method: 'PATCH', path: `/api/admin/campaign/${id}`, body: { status },
  });

  if (opts.json) print(body, { json: true });
  else print(`Campaign ${id} ${verb}`, { json: false });
}

export async function campaignPause(id: string, opts: { api?: string; json: boolean }): Promise<void> {
  await setCampaignStatus(id, 'paused', opts, 'paused');
}

export async function campaignResume(id: string, opts: { api?: string; json: boolean }): Promise<void> {
  await setCampaignStatus(id, 'active', opts, 'resumed');
}
