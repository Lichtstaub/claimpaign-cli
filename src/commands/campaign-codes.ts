import { apiRequest, requireToken } from '../api.js';
import { resolveApi } from '../config.js';
import { print, table } from '../output.js';
import { buildClaimUri, buildFallbackUri, splitFullCode } from '../codes.js';
import { writeCsv, writeQrImages, writePdf, type ExportItem } from '../export.js';
import type { CampaignCode, CampaignFields, CampaignGetResponseBody } from '../api-types.js';

/**
 * Safety cap on paginated fetches, in case a server response carries a bad or huge
 * pages value. Shared with campaign.ts's own pagination loop over the campaign list.
 */
export const MAX_PAGES = 1000;

/** Shared with campaign.ts, so a freshly created campaign's CSV lines up with campaign codes. */
export const CSV_COLUMNS = ['code', 'status', 'claim_uri', 'fallback_url'];

/**
 * Fetches every page of a campaign's codes and deduplicates by code (shared campaigns
 * report their one code once per claim). Accepts an already fetched first page to avoid
 * refetching it when the caller has just polled the campaign into existence.
 */
export async function loadAllCodes(params: {
  api: string; token: string; campaignId: string; firstPage?: CampaignGetResponseBody;
}): Promise<{ campaign: CampaignFields; codes: CampaignCode[] }> {
  const { api, token, campaignId } = params;
  const first = params.firstPage ?? (await apiRequest<CampaignGetResponseBody>({
    api, token, method: 'GET', path: `/api/admin/campaign/${campaignId}?page=1&limit=200`,
  })).body;

  const dedup = new Map<string, CampaignCode>();
  for (const c of first.codes) dedup.set(c.code, c);
  const totalPages = Number.isFinite(first.pagination.pages) ? Math.min(first.pagination.pages, MAX_PAGES) : 1;
  for (let p = 2; p <= totalPages; p++) {
    const res = await apiRequest<CampaignGetResponseBody>({
      api, token, method: 'GET', path: `/api/admin/campaign/${campaignId}?page=${p}&limit=200`,
    });
    for (const c of res.body.codes) dedup.set(c.code, c);
  }

  return { campaign: first.campaign, codes: [...dedup.values()] };
}

export interface CampaignCodesOpts {
  api?: string;
  json: boolean;
  csv?: string;
  qrDir?: string;
  pdf?: string;
  fallback?: boolean;
  all?: boolean;
}

interface CampaignCodesItem {
  code: string;
  status: string;
  claim_uri: string;
  fallback_url: string;
}

/** Picks the URI that goes into a QR image or PDF card for each row: the fallback HTTPS URL when fallback is true, the claim URI otherwise. */
export function buildExportItems(rows: CampaignCodesItem[], fallback: boolean): ExportItem[] {
  return rows.map(r => ({ code: r.code, uri: fallback ? r.fallback_url : r.claim_uri }));
}

/**
 * Exports a campaign's codes as CSV, QR images and/or a print-ready PDF, or shows them
 * as a table or JSON when no output flag is given. Unclaimed codes only, unless --all,
 * except a shared campaign's one code is always included regardless of claims.
 */
export async function campaignCodes(id: string, opts: CampaignCodesOpts): Promise<void> {
  const token = requireToken();
  const api = resolveApi(opts.api);

  const { campaign, codes } = await loadAllCodes({ api, token, campaignId: id });
  const isShared = campaign.code_mode === 'shared';
  const filtered = opts.all || isShared ? codes : codes.filter(c => c.status === 'unclaimed');

  const items: CampaignCodesItem[] = filtered.map(c => {
    const split = splitFullCode(c.code);
    const shortCode = split?.shortCode ?? c.code;
    const codePrefix = split?.prefix ?? campaign.code_prefix;
    return {
      code: c.code,
      status: c.status,
      claim_uri: buildClaimUri(api, codePrefix, shortCode),
      fallback_url: buildFallbackUri(api, c.code),
    };
  });

  const hasOutputs = Boolean(opts.csv || opts.qrDir || opts.pdf);

  if (!hasOutputs) {
    if (opts.json) {
      print({ campaign: { id: campaign.id, name: campaign.name, codePrefix: campaign.code_prefix }, codes: items }, { json: true });
    } else {
      print(table(items.map(it => ({ code: it.code, status: it.status, claim_uri: it.claim_uri }))), { json: false });
    }
    return;
  }

  const exportItems = buildExportItems(items, Boolean(opts.fallback));
  const result: { csv?: string; qrDir?: string; pdf?: string; count: number } = { count: items.length };

  if (opts.csv) {
    writeCsv(opts.csv, items.map(it => ({ code: it.code, status: it.status, claim_uri: it.claim_uri, fallback_url: it.fallback_url })), CSV_COLUMNS);
    result.csv = opts.csv;
  }
  if (opts.qrDir) {
    await writeQrImages(opts.qrDir, exportItems);
    result.qrDir = opts.qrDir;
  }
  if (opts.pdf) {
    await writePdf(opts.pdf, exportItems, campaign.name);
    result.pdf = opts.pdf;
  }

  if (opts.json) {
    print(result, { json: true });
    return;
  }
  const lines: string[] = [];
  if (result.csv) lines.push(`Wrote ${items.length} codes to ${result.csv}`);
  if (result.qrDir) lines.push(`Wrote ${items.length} QR images to ${result.qrDir}`);
  if (result.pdf) lines.push(`Wrote ${items.length} codes to ${result.pdf}`);
  print(lines.join('\n'), { json: false });
}
