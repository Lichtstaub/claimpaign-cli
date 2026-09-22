import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { apiRequest, ApiError, requireToken } from '../api.js';
import { configDir, resolveApi } from '../config.js';
import { print, table, UsageError } from '../output.js';
import { buildClaimUri, buildFallbackUri, splitFullCode } from '../codes.js';
import { writeCsv, writeQrImages, writePdf } from '../export.js';
import type {
  CampaignCreateRequestBody,
  CampaignCreateResponseBody,
  CampaignCode,
  CampaignFields,
  CampaignGetResponseBody,
  CampaignListItem,
  CampaignListResponseBody,
  CampaignPricing,
  TokenBundleItem,
} from '../api-types.js';

const PREFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const TOKEN_ARG = /^([a-f0-9]{56})\.([a-f0-9]*):([0-9]+)$/;
const DEFAULT_POLL_MS = 10_000;
const DEFAULT_POLL_TIMEOUT_MS = 900_000;
const DEFAULT_END_WAIT_MS = 20_000;
const DEFAULT_END_WAIT_TIMEOUT_MS = 900_000;
/** Safety cap on paginated fetches, in case a server response carries a bad or huge pages value. */
const MAX_PAGES = 1000;

export interface CampaignCreateOpts {
  api?: string;
  json: boolean;
  name: string;
  claims: number;
  ada?: number;
  token?: string[];
  shared?: boolean;
  prefix?: string;
  expires?: string;
  description?: string;
  out?: string;
  fresh?: boolean;
  pollMs?: number;
  pollTimeoutMs?: number;
}

export interface CampaignCreateResult {
  campaign: { id: string; status: string; codePrefix: string; totalCodes: number };
  pricing?: CampaignPricing;
  codesFile?: string;
  exportError?: string;
}

interface PendingCreateEntry {
  key: string;
  api: string;
  tokenPrefix: string;
  body: CampaignCreateRequestBody;
  createdAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pendingPath(): string {
  return join(configDir(), 'pending-create.json');
}

function readPendingEntry(): PendingCreateEntry | undefined {
  try {
    const parsed = JSON.parse(readFileSync(pendingPath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && typeof parsed.key === 'string') return parsed as PendingCreateEntry;
    return undefined;
  } catch {
    return undefined;
  }
}

function writePendingEntry(entry: PendingCreateEntry): void {
  if (!existsSync(configDir())) mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(pendingPath(), JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 });
  chmodSync(pendingPath(), 0o600);
}

function deletePendingEntry(): void {
  try {
    rmSync(pendingPath());
  } catch {
    // nothing pending, nothing to do
  }
}

/** Letters and digits from the name, uppercased, first 8 chars, plus 2 random ones for uniqueness. */
function derivePrefix(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
  const base = cleaned || 'CP';
  let suffix = '';
  for (let i = 0; i < 2; i++) suffix += PREFIX_CHARS[randomInt(PREFIX_CHARS.length)];
  return base + suffix;
}

function parseTokenArg(raw: string): TokenBundleItem {
  const match = TOKEN_ARG.exec(raw);
  if (!match) {
    throw new UsageError(`Invalid --token value "${raw}", expected <policyId 56 hex>.<assetNameHex>:<quantity digits>`);
  }
  const [, policyId, assetNameHex, quantity] = match;
  return { unit: `${policyId}.${assetNameHex}`, quantity };
}

function buildRequestBody(opts: CampaignCreateOpts, prefix: string): CampaignCreateRequestBody {
  const body: CampaignCreateRequestBody = {
    name: opts.name,
    codePrefix: prefix,
    codeCount: opts.claims,
    network: 'preprod',
  };
  if (opts.ada !== undefined) body.adaPerClaim = Math.round(opts.ada * 1_000_000);
  if (opts.token && opts.token.length > 0) body.tokenBundle = opts.token.map(parseTokenArg);
  if (opts.shared) body.codeMode = 'shared';
  if (opts.expires) body.expiresAt = opts.expires;
  if (opts.description) body.description = opts.description;
  return body;
}

/** 400/403/404 are always final, 409 only when it names a creation_failed campaign. */
function isDefinitiveRejection(status: number, body: unknown): boolean {
  if (status === 400 || status === 403 || status === 404) return true;
  if (status === 409) {
    const record = body as { error?: string; campaign?: { status?: string } } | undefined;
    if (record?.campaign?.status === 'creation_failed') return true;
    if (typeof record?.error === 'string' && record.error.includes('creation_failed')) return true;
  }
  return false;
}

function formatAda(lovelace: number): string {
  return (lovelace / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Explains why a pending entry cannot be resumed, without ever printing any part of the
 * API key, only whether it differs.
 */
function pendingMismatchMessage(pending: PendingCreateEntry, api: string, tokenPrefix: string): string {
  const reasons: string[] = [];
  if (pending.api !== api) reasons.push(`the pending attempt targets ${pending.api}, this run targets ${api}`);
  if (pending.tokenPrefix !== tokenPrefix) reasons.push('the pending attempt used a different API key');
  return `A pending campaign creation exists, but ${reasons.join(' and ')}. Run with --fresh to start a new one.`;
}

/** Polls GET .../campaign/<id> every pollMs until active, or throws once deadline passes or creation_failed comes back. */
async function pollUntilActive(params: {
  api: string; token: string; campaignId: string; pollMs: number; deadline: number;
}): Promise<CampaignGetResponseBody> {
  const { api, token, campaignId, pollMs, deadline } = params;
  for (;;) {
    const res = await apiRequest<CampaignGetResponseBody>({
      api, token, method: 'GET', path: `/api/admin/campaign/${campaignId}?page=1&limit=200`,
    });
    const page1 = res.body;
    if (page1.campaign.status === 'active') return page1;
    if (page1.campaign.status === 'creation_failed') {
      deletePendingEntry();
      throw new Error(`Campaign ${campaignId} failed during creation. Check the dashboard or start a new campaign with --fresh.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Campaign ${campaignId} is still settling. It stays pending, run "claimpaign campaign create" again to resume it, ` +
        'or use --fresh to start a new campaign instead.',
      );
    }
    await sleep(pollMs);
  }
}

/**
 * Fetches every page of a campaign's codes and deduplicates by code (shared campaigns
 * report their one code once per claim). Accepts an already fetched first page to avoid
 * refetching it when the caller has just polled the campaign into existence.
 */
async function loadAllCodes(params: {
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

/** Writes every code of a freshly created campaign to a CSV, using the page already fetched by pollUntilActive. Returns its path. */
async function exportCodes(params: {
  api: string; token: string; campaignId: string; page1: CampaignGetResponseBody; outDir: string;
}): Promise<string> {
  const { api, token, campaignId, page1, outDir } = params;
  const { campaign, codes } = await loadAllCodes({ api, token, campaignId, firstPage: page1 });

  const prefix = campaign.code_prefix;
  const rows = codes.map(c => {
    const split = splitFullCode(c.code);
    const shortCode = split?.shortCode ?? c.code;
    const codePrefix = split?.prefix ?? prefix;
    return { code: c.code, claim_uri: buildClaimUri(api, codePrefix, shortCode), fallback_url: buildFallbackUri(api, c.code) };
  });

  mkdirSync(outDir, { recursive: true });
  const csvPath = join(outDir, `${prefix}-codes.csv`);
  writeCsv(csvPath, rows);
  return csvPath;
}

/**
 * Creates a sandbox campaign and exports its codes to a CSV file.
 *
 * A creation attempt is tracked in a pending-create.json file in the config directory
 * until it either reaches active, is definitively rejected by the server, or --fresh
 * discards it. An existing pending attempt for the same api and API key is always
 * resumed with its original idempotency key and body, ignoring the options given now.
 */
export async function campaignCreate(opts: CampaignCreateOpts): Promise<CampaignCreateResult> {
  const token = requireToken();
  const api = resolveApi(opts.api);
  const tokenPrefix = token.slice(0, 12);
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const pollTimeoutMs = opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;

  let pending = readPendingEntry();
  if (opts.fresh && pending) {
    deletePendingEntry();
    pending = undefined;
  }

  let key: string;
  let body: CampaignCreateRequestBody;

  if (pending) {
    if (pending.api !== api || pending.tokenPrefix !== tokenPrefix) {
      throw new UsageError(pendingMismatchMessage(pending, api, tokenPrefix));
    }
    key = pending.key;
    body = pending.body;
    const ageHours = Math.floor((Date.now() - new Date(pending.createdAt).getTime()) / 3_600_000);
    process.stderr.write(`Resuming the previous creation from ${pending.createdAt} (key ${pending.key.slice(0, 8)}...)\n`);
    if (ageHours >= 24) process.stderr.write(`This attempt is ${ageHours} hours old.\n`);
  } else {
    if (!Number.isInteger(opts.claims) || opts.claims <= 0) throw new UsageError('--claims must be a positive integer');
    if (opts.ada !== undefined && (!Number.isFinite(opts.ada) || opts.ada < 0)) throw new UsageError('--ada must be a non negative number');
    const prefix = opts.prefix || derivePrefix(opts.name);
    body = buildRequestBody(opts, prefix);
    key = randomUUID();
    writePendingEntry({ key, api, tokenPrefix, body, createdAt: new Date().toISOString() });
  }

  let createBody: CampaignCreateResponseBody;
  try {
    const res = await apiRequest<CampaignCreateResponseBody>({
      api, token, method: 'POST', path: '/api/admin/campaign/create',
      body, headers: { 'Idempotency-Key': key },
    });
    createBody = res.body;
  } catch (err) {
    if (err instanceof ApiError && isDefinitiveRejection(err.status, err.body)) deletePendingEntry();
    throw err;
  }

  const campaignId = createBody.campaign.id;
  const pricing = createBody.pricing;

  if (createBody.campaign.status === 'creating') process.stderr.write('Funding is settling.\n');

  const page1 = await pollUntilActive({ api, token, campaignId, pollMs, deadline: Date.now() + pollTimeoutMs });
  deletePendingEntry();

  let codesFile: string | undefined;
  let exportError: string | undefined;
  try {
    codesFile = await exportCodes({ api, token, campaignId, page1, outDir: opts.out || process.cwd() });
  } catch (err) {
    exportError = `Could not export codes for campaign ${campaignId}: ${(err as Error).message}. Run: claimpaign campaign codes ${campaignId}`;
  }

  const result: CampaignCreateResult = {
    campaign: {
      id: campaignId,
      status: page1.campaign.status,
      codePrefix: page1.campaign.code_prefix,
      totalCodes: page1.campaign.total_codes,
    },
    ...(pricing ? { pricing } : {}),
    ...(codesFile ? { codesFile } : {}),
    ...(exportError ? { exportError } : {}),
  };

  if (opts.json) {
    print(result, { json: true });
  } else {
    const lines = [`Campaign ${result.campaign.id} is active.`, `Prefix: ${result.campaign.codePrefix}`];
    if (page1.campaign.code_mode === 'shared') lines.push(`Claim capacity: ${result.campaign.totalCodes} (one shared code)`);
    else lines.push(`Codes: ${result.campaign.totalCodes}`);
    lines.push(`Cost: ${pricing ? `${formatAda(pricing.totalCost)} tADA` : 'see claimpaign campaign status'}`);
    if (codesFile) {
      lines.push(`Codes exported to ${codesFile}`);
      if (page1.campaign.code_mode === 'shared') lines.push('Anyone with this code can claim it once per wallet.');
    } else if (exportError) {
      // The full message only appears once, in the Error thrown below, not here too.
      lines.push('Codes could not be exported, see the error below.');
    }
    print(lines.join('\n'), { json: false });
  }

  if (result.exportError) throw new Error(result.exportError);
  return result;
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

  const exportItems = items.map(it => ({ code: it.code, uri: opts.fallback ? it.fallback_url : it.claim_uri }));
  const result: { csv?: string; qrDir?: string; pdf?: string; count: number } = { count: items.length };

  if (opts.csv) {
    writeCsv(opts.csv, items.map(it => ({ code: it.code, status: it.status, claim_uri: it.claim_uri, fallback_url: it.fallback_url })));
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

/** Pulls the server's error text out of a management endpoint's error body, empty string when it has none. */
function errorText(body: unknown): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return '';
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
    const res = await apiRequest<{ ok: boolean; status: string; refunded: number }>({
      api, token, method: 'PATCH', path: `/api/admin/campaign/${id}`, body: { status: 'ended' }, allow: [409],
    });

    if (res.status === 200) {
      if (opts.json) print(res.body, { json: true });
      else print(`Campaign ${id} ended, refunded ${formatAda(res.body.refunded)} tADA`, { json: false });
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
