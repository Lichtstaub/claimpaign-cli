import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { apiRequest, ApiError, requireToken } from '../api.js';
import { configDir, resolveApi } from '../config.js';
import { print, table, UsageError } from '../output.js';
import { buildClaimUri, buildFallbackUri, splitFullCode } from '../codes.js';
import type {
  CampaignCreateRequestBody,
  CampaignCreateResponseBody,
  CampaignCode,
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
      throw new UsageError(
        `A pending campaign creation exists for ${pending.api} (key ${pending.tokenPrefix}...). ` +
        `This run targets ${api}. Use --fresh to discard the pending attempt and start a new one.`,
      );
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
  const initialStatus = createBody.campaign.status;
  const pricing = createBody.pricing;

  if (initialStatus === 'creating') process.stderr.write('Funding is settling.\n');

  const deadline = Date.now() + pollTimeoutMs;
  let page1: CampaignGetResponseBody;
  for (;;) {
    const res = await apiRequest<CampaignGetResponseBody>({
      api, token, method: 'GET', path: `/api/admin/campaign/${campaignId}?page=1&limit=200`,
    });
    page1 = res.body;
    if (page1.campaign.status === 'active') break;
    if (page1.campaign.status === 'creation_failed') {
      deletePendingEntry();
      throw new Error(`Campaign ${campaignId} failed during creation. Check the dashboard or start a new campaign with --fresh.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Campaign ${campaignId} is still settling. It stays pending, run "claimpaign campaign create" again to resume it.`,
      );
    }
    await sleep(pollMs);
  }

  deletePendingEntry();

  let codesFile: string | undefined;
  let exportError: string | undefined;
  try {
    const dedup = new Map<string, CampaignCode>();
    for (const c of page1.codes) dedup.set(c.code, c);
    const totalPages = page1.pagination.pages;
    for (let p = 2; p <= totalPages; p++) {
      const res = await apiRequest<CampaignGetResponseBody>({
        api, token, method: 'GET', path: `/api/admin/campaign/${campaignId}?page=${p}&limit=200`,
      });
      for (const c of res.body.codes) dedup.set(c.code, c);
    }

    const prefix = page1.campaign.code_prefix;
    const csvLines = ['code,claim_uri,fallback_url'];
    for (const c of dedup.values()) {
      const split = splitFullCode(c.code);
      const shortCode = split?.shortCode ?? c.code;
      const codePrefix = split?.prefix ?? prefix;
      csvLines.push(`${c.code},${buildClaimUri(api, codePrefix, shortCode)},${buildFallbackUri(api, c.code)}`);
    }
    const outDir = opts.out || process.cwd();
    const csvPath = join(outDir, `${prefix}-codes.csv`);
    writeFileSync(csvPath, csvLines.join('\n') + '\n');
    codesFile = csvPath;
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
      lines.push(`Export failed: ${exportError}`);
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
    if (page >= body.pages) break;
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
