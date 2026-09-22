import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeApi, fakeKey, type FakeReq } from './helpers/fake-api.js';
import { campaignCreate, campaignList, campaignStatus } from '../src/commands/campaign.js';
import { UsageError } from '../src/output.js';

const TOKEN = fakeKey('campaign');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FakeCampaign {
  id: string;
  status: string;
  prefix: string;
  codeMode: string;
  totalCodes: number;
  codes: string[];
  codesClaimed: number;
}

type OnCreate = (req: FakeReq, byKey: Map<string, string>, byId: Map<string, FakeCampaign>) => { status: number; body: unknown };
type OnGet = (req: FakeReq, campaign: FakeCampaign) => { status: number; body: unknown };

function makeCodes(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}_CODE${String(i + 1).padStart(4, '0')}`);
}

function defaultGetResponse(req: FakeReq, c: FakeCampaign) {
  const page = Number(req.url.searchParams.get('page') || '1');
  const limit = Number(req.url.searchParams.get('limit') || '50');
  const rows = c.codes.map(code => ({ code, status: 'sent', address: null, claim_status: null, claimed_at: null, tx_hash: null }));
  const start = (page - 1) * limit;
  const pageRows = rows.slice(start, start + limit);
  return {
    status: 200,
    body: {
      campaign: {
        id: c.id, name: 'Test Campaign', status: c.status, code_prefix: c.prefix, code_mode: c.codeMode,
        total_codes: c.totalCodes, codes_claimed: c.codesClaimed, created_at: '2026-01-01T00:00:00Z',
      },
      codes: pageRows,
      queue: { pending: 0, queued: 0, processing: 0 },
      pagination: { total: rows.length, page, limit, pages: Math.max(1, Math.ceil(rows.length / limit)) },
    },
  };
}

async function startCampaignFake(opts: { onCreate: OnCreate; onGet?: OnGet }) {
  const byKey = new Map<string, string>();
  const byId = new Map<string, FakeCampaign>();
  const api = await startFakeApi({
    'POST /api/admin/campaign/create': req => opts.onCreate(req, byKey, byId),
    'GET /api/admin/campaign/': req => {
      const id = req.path.slice('/api/admin/campaign/'.length);
      const c = byId.get(id);
      if (!c) return { status: 404, body: { error: 'Campaign not found' } };
      return opts.onGet ? opts.onGet(req, c) : defaultGetResponse(req, c);
    },
  });
  return { ...api, byKey, byId };
}

/** A create handler that always succeeds with 201 for a new key, and replays for a known one. */
function standardOnCreate(): OnCreate {
  let counter = 0;
  return (req, byKey, byId) => {
    const key = req.headers['idempotency-key'] as string;
    const existingId = byKey.get(key);
    if (existingId) {
      const c = byId.get(existingId)!;
      return { status: 200, body: { campaign: { id: c.id, status: c.status }, codes: c.codes, idempotent: true } };
    }
    counter += 1;
    const id = `camp-${counter}`;
    const prefix = req.body.codePrefix as string;
    const totalCodes = req.body.codeCount as number;
    const codeMode = (req.body.codeMode as string) || 'unique';
    const codes = makeCodes(prefix, codeMode === 'shared' ? 1 : totalCodes);
    byKey.set(key, id);
    byId.set(id, { id, status: 'active', prefix, codeMode, totalCodes, codes, codesClaimed: 0 });
    return {
      status: 201,
      body: {
        pending: false,
        campaign: { id, status: 'active', codePrefix: prefix, totalCodes },
        pricing: { serviceFee: 500_000, perCodeCost: 2_500_000, totalCost: totalCodes * 2_500_000 + 10_000_000, tokenValue: 0 },
        codes,
      },
    };
  };
}

let dir: string;
let output: string[];
let errOutput: string[];
let fake: { close: () => Promise<void> } | undefined;

beforeEach(() => {
  output = [];
  errOutput = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { output.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => { errOutput.push(String(chunk)); return true; });
  dir = mkdtempSync(join(tmpdir(), 'cp-campaign-'));
  process.env.CLAIMPAIGN_CONFIG_DIR = dir;
  process.env.CLAIMPAIGN_TOKEN = TOKEN;
  fake = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (fake) await fake.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CLAIMPAIGN_CONFIG_DIR;
  delete process.env.CLAIMPAIGN_TOKEN;
});

function pendingFile(): string {
  return join(dir, 'pending-create.json');
}

describe('campaign create', () => {
  it('writes a CSV with 3 codes and correct URIs, sends a UUID Idempotency-Key and network preprod', async () => {
    const thisFake = await startCampaignFake({ onCreate: standardOnCreate() });
    fake = thisFake;

    const result = await campaignCreate({ api: thisFake.url, json: false, name: 'My Campaign', claims: 3, prefix: 'TESTA', out: dir });

    expect(result.campaign.id).toBe('camp-1');
    expect(result.campaign.totalCodes).toBe(3);
    expect(result.codesFile).toBe(join(dir, 'TESTA-codes.csv'));

    const csv = readFileSync(result.codesFile!, 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('code,claim_uri,fallback_url');
    expect(lines.length).toBe(4);
    expect(csv).toContain('web+cardano://claim/v1?faucet_url=');
    expect(csv).toContain(`${thisFake.url}/api/qr/`);

    const post = thisFake.calls.find(c => c.method === 'POST')!;
    expect(post.headers['idempotency-key']).toMatch(UUID_RE);
    expect(post.body.network).toBe('preprod');
  });

  it('sends a different key for two independent successful creations', async () => {
    const thisFake = await startCampaignFake({ onCreate: standardOnCreate() });
    fake = thisFake;

    await campaignCreate({ api: thisFake.url, json: false, name: 'First', claims: 1, prefix: 'FIRST1', out: dir });
    await campaignCreate({ api: thisFake.url, json: false, name: 'Second', claims: 1, prefix: 'SECND1', out: dir });

    const keys = thisFake.calls.filter(c => c.method === 'POST').map(c => c.headers['idempotency-key']);
    expect(keys.length).toBe(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(existsSync(pendingFile())).toBe(false);
  });

  it('sends adaPerClaim as 1000000 lovelace for --ada 1', async () => {
    const thisFake = await startCampaignFake({ onCreate: standardOnCreate() });
    fake = thisFake;

    await campaignCreate({ api: thisFake.url, json: false, name: 'Ada One', claims: 1, ada: 1, prefix: 'ADA001', out: dir });

    const post = thisFake.calls.find(c => c.method === 'POST')!;
    expect(post.body.adaPerClaim).toBe(1_000_000);
  });

  it('replays a lost response with the same key and body, only one campaign exists', async () => {
    const thisFake = await startCampaignFake({
      onCreate: (req, byKey, byId) => {
        const key = req.headers['idempotency-key'] as string;
        const existingId = byKey.get(key);
        if (existingId) {
          const c = byId.get(existingId)!;
          return { status: 200, body: { campaign: { id: c.id, status: c.status }, codes: c.codes, idempotent: true } };
        }
        const id = 'camp-lost';
        const prefix = req.body.codePrefix as string;
        const codes = makeCodes(prefix, req.body.codeCount as number);
        byKey.set(key, id);
        byId.set(id, { id, status: 'active', prefix, codeMode: 'unique', totalCodes: req.body.codeCount, codes, codesClaimed: 0 });
        return { status: -1, body: null };
      },
    });
    fake = thisFake;

    await expect(campaignCreate({ api: thisFake.url, json: false, name: 'Lost', claims: 2, prefix: 'LOST01', out: dir })).rejects.toThrow();
    expect(existsSync(pendingFile())).toBe(true);

    const result = await campaignCreate({ api: thisFake.url, json: false, name: 'Lost', claims: 2, prefix: 'LOST01', out: dir });
    expect(result.campaign.id).toBe('camp-lost');
    expect(thisFake.byId.size).toBe(1);
    expect(thisFake.calls.filter(c => c.method === 'POST').length).toBe(2);
    const bodies = thisFake.calls.filter(c => c.method === 'POST').map(c => c.headers['idempotency-key']);
    expect(bodies[0]).toBe(bodies[1]);
    expect(existsSync(pendingFile())).toBe(false);
  });

  it('resumes a lost response even when the pending entry is 30 hours old, with an age note on stderr', async () => {
    const thisFake = await startCampaignFake({
      onCreate: (req, byKey, byId) => {
        const key = req.headers['idempotency-key'] as string;
        const existingId = byKey.get(key);
        if (existingId) {
          const c = byId.get(existingId)!;
          return { status: 200, body: { campaign: { id: c.id, status: c.status }, codes: c.codes, idempotent: true } };
        }
        const id = 'camp-old';
        const prefix = req.body.codePrefix as string;
        const codes = makeCodes(prefix, req.body.codeCount as number);
        byKey.set(key, id);
        byId.set(id, { id, status: 'active', prefix, codeMode: 'unique', totalCodes: req.body.codeCount, codes, codesClaimed: 0 });
        return { status: -1, body: null };
      },
    });
    fake = thisFake;

    await expect(campaignCreate({ api: thisFake.url, json: false, name: 'Old', claims: 1, prefix: 'OLD001', out: dir })).rejects.toThrow();

    const raw = JSON.parse(readFileSync(pendingFile(), 'utf8'));
    raw.createdAt = new Date(Date.now() - 30 * 3_600_000).toISOString();
    writeFileSync(pendingFile(), JSON.stringify(raw));

    errOutput = [];
    const result = await campaignCreate({ api: thisFake.url, json: false, name: 'Old', claims: 1, prefix: 'OLD001', out: dir });
    expect(result.campaign.id).toBe('camp-old');
    expect(errOutput.join('')).toContain('hours old');
  });

  it('keeps the pending entry on a poll timeout and resumes with the replay on the next call', async () => {
    const thisFake = await startCampaignFake({
      onCreate: (req, byKey, byId) => {
        const key = req.headers['idempotency-key'] as string;
        const existingId = byKey.get(key);
        if (existingId) {
          const c = byId.get(existingId)!;
          if (c.status === 'creating') return { status: 202, body: { campaign: { id: c.id, status: 'creating' }, pending: true, idempotent: true } };
          return { status: 200, body: { campaign: { id: c.id, status: c.status }, codes: c.codes, idempotent: true } };
        }
        const id = 'camp-timeout';
        const prefix = req.body.codePrefix as string;
        const codes = makeCodes(prefix, req.body.codeCount as number);
        byKey.set(key, id);
        byId.set(id, { id, status: 'creating', prefix, codeMode: 'unique', totalCodes: req.body.codeCount, codes, codesClaimed: 0 });
        return { status: 202, body: { campaign: { id, status: 'creating' }, codes, pending: true, message: 'Funding is awaiting settlement.' } };
      },
    });
    fake = thisFake;

    await expect(campaignCreate({
      api: thisFake.url, json: false, name: 'Timeout', claims: 2, prefix: 'TOUT01', out: dir, pollMs: 10, pollTimeoutMs: 30,
    })).rejects.toThrow(/settling/);
    expect(existsSync(pendingFile())).toBe(true);

    thisFake.byId.get('camp-timeout')!.status = 'active';

    const result = await campaignCreate({
      api: thisFake.url, json: false, name: 'Timeout', claims: 2, prefix: 'TOUT01', out: dir, pollMs: 10, pollTimeoutMs: 30,
    });
    expect(result.campaign.id).toBe('camp-timeout');
    expect(thisFake.byId.size).toBe(1);
    expect(existsSync(pendingFile())).toBe(false);
  });

  it('resumes a still-creating replay (variant e) and finishes once the campaign becomes active', async () => {
    const getCounts = new Map<string, number>();
    const thisFake = await startCampaignFake({
      onCreate: (req, byKey, byId) => {
        const key = req.headers['idempotency-key'] as string;
        const existingId = byKey.get(key);
        if (existingId) {
          const c = byId.get(existingId)!;
          if (c.status === 'creating') return { status: 202, body: { campaign: { id: c.id, status: 'creating' }, pending: true, idempotent: true } };
          return { status: 200, body: { campaign: { id: c.id, status: c.status }, codes: c.codes, idempotent: true } };
        }
        const id = 'camp-variant-e';
        const prefix = req.body.codePrefix as string;
        const codes = makeCodes(prefix, req.body.codeCount as number);
        byKey.set(key, id);
        byId.set(id, { id, status: 'creating', prefix, codeMode: 'unique', totalCodes: req.body.codeCount, codes, codesClaimed: 0 });
        return { status: 202, body: { campaign: { id, status: 'creating' }, codes, pending: true, message: 'Funding is awaiting settlement.' } };
      },
      onGet: (req, c) => {
        const n = (getCounts.get(c.id) || 0) + 1;
        getCounts.set(c.id, n);
        if (n >= 3) c.status = 'active';
        return defaultGetResponse(req, c);
      },
    });
    fake = thisFake;

    // pollTimeoutMs 0 times out right after the first GET check, deterministically
    await expect(campaignCreate({
      api: thisFake.url, json: false, name: 'Variant E', claims: 2, prefix: 'VARE01', out: dir, pollMs: 5, pollTimeoutMs: 0,
    })).rejects.toThrow(/settling/);
    expect(existsSync(pendingFile())).toBe(true);

    const result = await campaignCreate({
      api: thisFake.url, json: false, name: 'Variant E', claims: 2, prefix: 'VARE01', out: dir, pollMs: 5, pollTimeoutMs: 2000,
    });
    expect(result.campaign.id).toBe('camp-variant-e');
    expect(thisFake.byId.size).toBe(1);
  });

  it('deletes the pending entry on a definitive rejection, a second attempt with a fixed name gets a fresh key', async () => {
    const thisFake = await startCampaignFake({
      onCreate: (req, byKey, byId) => {
        if (req.body.name === 'Bad Name!!') return { status: 400, body: { error: 'Name contains invalid characters' } };
        const key = req.headers['idempotency-key'] as string;
        const id = 'camp-fixed';
        const prefix = req.body.codePrefix as string;
        const codes = makeCodes(prefix, req.body.codeCount as number);
        byKey.set(key, id);
        byId.set(id, { id, status: 'active', prefix, codeMode: 'unique', totalCodes: req.body.codeCount, codes, codesClaimed: 0 });
        return { status: 201, body: { pending: false, campaign: { id, status: 'active', codePrefix: prefix, totalCodes: req.body.codeCount }, pricing: { serviceFee: 500_000, perCodeCost: 2_500_000, totalCost: 3_000_000, tokenValue: 0 }, codes } };
      },
    });
    fake = thisFake;

    await expect(campaignCreate({ api: thisFake.url, json: false, name: 'Bad Name!!', claims: 1, prefix: 'BAD001', out: dir })).rejects.toThrow(/invalid characters/);
    expect(existsSync(pendingFile())).toBe(false);

    const result = await campaignCreate({ api: thisFake.url, json: false, name: 'Good Name', claims: 1, prefix: 'BAD001', out: dir });
    expect(result.campaign.status).toBe('active');

    const posts = thisFake.calls.filter(c => c.method === 'POST');
    expect(posts.length).toBe(2);
    expect(posts[0].headers['idempotency-key']).not.toBe(posts[1].headers['idempotency-key']);
    expect(posts[1].body.name).toBe('Good Name');
  });

  it('refuses to resume a pending entry for a different api or key without --fresh, and sends no request', async () => {
    const thisFake = await startCampaignFake({ onCreate: standardOnCreate() });
    fake = thisFake;

    writeFileSync(pendingFile(), JSON.stringify({
      key: 'existing-key', api: thisFake.url, tokenPrefix: 'MISMATCHEDPRE',
      body: { name: 'X', codePrefix: 'X', codeCount: 1, network: 'preprod' }, createdAt: new Date().toISOString(),
    }));

    await expect(campaignCreate({ api: thisFake.url, json: false, name: 'New', claims: 1, prefix: 'NEW001', out: dir })).rejects.toThrow(UsageError);
    expect(thisFake.calls.length).toBe(0);

    const result = await campaignCreate({ api: thisFake.url, json: false, name: 'New', claims: 1, prefix: 'NEW001', out: dir, fresh: true });
    expect(result.campaign.status).toBe('active');
    expect(thisFake.calls.filter(c => c.method === 'POST').length).toBe(1);
  });

  it('deduplicates a shared code claimed three times into one CSV row and reports 3/60 progress', async () => {
    const thisFake = await startCampaignFake({
      onCreate: (req, byKey, byId) => {
        const key = req.headers['idempotency-key'] as string;
        const id = 'camp-shared';
        const prefix = req.body.codePrefix as string;
        const sharedCode = `${prefix}_SHARED001`;
        byKey.set(key, id);
        byId.set(id, { id, status: 'active', prefix, codeMode: 'shared', totalCodes: req.body.codeCount, codes: [sharedCode, sharedCode, sharedCode], codesClaimed: 3 });
        return { status: 201, body: { pending: false, campaign: { id, status: 'active', codePrefix: prefix, totalCodes: req.body.codeCount }, pricing: { serviceFee: 2_000_000, perCodeCost: 2_000_000, totalCost: 2_000_000, tokenValue: 0 }, codes: [sharedCode] } };
      },
    });
    fake = thisFake;

    const result = await campaignCreate({ api: thisFake.url, json: false, name: 'Shared', claims: 60, shared: true, prefix: 'SHAR01', out: dir });
    expect(result.campaign.totalCodes).toBe(60);
    const csv = readFileSync(result.codesFile!, 'utf8');
    const dataLines = csv.trim().split('\n').slice(1);
    expect(dataLines.length).toBe(1);

    output = [];
    await campaignStatus('camp-shared', { api: thisFake.url, json: false });
    expect(output.join('')).toContain('3/60');
  });

  it('passes a 403 from the server through with its text and drops the pending entry', async () => {
    const thisFake = await startFakeApi({
      'POST /api/admin/campaign/create': () => ({ status: 403, body: { error: 'API keys can only create sandbox (preprod) campaigns' } }),
    });
    fake = thisFake;

    await expect(campaignCreate({ api: thisFake.url, json: false, name: 'Mainnet', claims: 1, prefix: 'MAIN01', out: dir }))
      .rejects.toThrow('API keys can only create sandbox (preprod) campaigns');
    expect(existsSync(pendingFile())).toBe(false);
  });

  it('rejects an invalid --token value as a UsageError before sending a request', async () => {
    await expect(campaignCreate({
      api: 'http://127.0.0.1:1', json: false, name: 'Tok', claims: 1, prefix: 'TOK001', out: dir, token: ['not-a-valid-token'],
    })).rejects.toThrow(UsageError);
    expect(existsSync(pendingFile())).toBe(false);
  });

  it('throws Not logged in without a stored token', async () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    await expect(campaignCreate({ api: 'http://127.0.0.1:1', json: false, name: 'X', claims: 1 })).rejects.toThrow('Not logged in');
  });
});

describe('campaign list', () => {
  it('loads two pages and shows every row', async () => {
    const thisFake = await startFakeApi({
      'GET /api/admin/campaigns': req => {
        const page = Number(req.url.searchParams.get('page') || '1');
        if (page === 1) {
          return { status: 200, body: { campaigns: [{ id: 'c1', name: 'One', status: 'active', total_codes: 10, codes_claimed: 2, code_prefix: 'ONE1', code_mode: 'unique', network: 'preprod', created_at: '2026-01-01' }], total: 2, page: 1, limit: 100, pages: 2 } };
        }
        return { status: 200, body: { campaigns: [{ id: 'c2', name: 'Two', status: 'ended', total_codes: 5, codes_claimed: 5, code_prefix: 'TWO1', code_mode: 'unique', network: 'preprod', created_at: '2026-01-02' }], total: 2, page: 2, limit: 100, pages: 2 } };
      },
    });
    fake = thisFake;

    await campaignList({ api: thisFake.url, json: false });
    const text = output.join('');
    expect(text).toContain('c1');
    expect(text).toContain('c2');
    expect(text).toContain('2/10');
    expect(text).toContain('5/5');
    expect(thisFake.calls.filter(c => c.method === 'GET').length).toBe(2);

    output = [];
    await campaignList({ api: thisFake.url, json: true });
    const parsed = JSON.parse(output.join(''));
    expect(parsed.campaigns.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2']);
  });

  it('throws Not logged in without a stored token', async () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    await expect(campaignList({ api: 'http://127.0.0.1:1', json: false })).rejects.toThrow('Not logged in');
  });
});

describe('campaign status', () => {
  it('prints id, status, progress and queue, json prints the raw body', async () => {
    const thisFake = await startFakeApi({
      'GET /api/admin/campaign/camp-9': () => ({
        status: 200,
        body: {
          campaign: { id: 'camp-9', name: 'Nine', status: 'active', code_prefix: 'NINE1', code_mode: 'unique', total_codes: 4, codes_claimed: 1, created_at: '2026-01-01T00:00:00Z' },
          codes: [],
          queue: { pending: 2, queued: 2, processing: 0 },
          pagination: { total: 4, page: 1, limit: 200, pages: 1 },
        },
      }),
    });
    fake = thisFake;

    await campaignStatus('camp-9', { api: thisFake.url, json: false });
    const text = output.join('');
    expect(text).toContain('camp-9');
    expect(text).toContain('1/4');
    expect(text).toContain('Queue pending: 2');

    output = [];
    await campaignStatus('camp-9', { api: thisFake.url, json: true });
    const parsed = JSON.parse(output.join(''));
    expect(parsed.campaign.id).toBe('camp-9');
  });
});
