import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeApi, fakeKey } from './helpers/fake-api.js';
import { campaignCreateMoved, campaignList, campaignStatus, campaignEnd, campaignPause, campaignResume } from '../src/commands/campaign.js';
import { UsageError } from '../src/output.js';
import { ApiError } from '../src/api.js';

const TOKEN = fakeKey('campaign');

let dir: string;
let output: string[];
let errOutput: string[];
let fake: Awaited<ReturnType<typeof startFakeApi>> | undefined;

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
  if (fake) {
    expect(fake.errors, 'fake api handler threw').toEqual([]);
    await fake.close();
  }
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CLAIMPAIGN_CONFIG_DIR;
  delete process.env.CLAIMPAIGN_TOKEN;
});

describe('campaign create', () => {
  it('points to the web interface, sends no request and fails', async () => {
    fake = await startFakeApi({});
    expect(() => campaignCreateMoved({ api: fake!.url, json: false })).toThrow(`${fake!.url}/admin/create/`);
    expect(fake!.calls).toEqual([]);
    expect(output.join('')).toBe('');
    expect(errOutput.join('')).toBe('');
  });

  it('prints the link as json before failing', () => {
    expect(() => campaignCreateMoved({ api: 'https://claimpaign.com', json: true })).toThrow('web interface');
    expect(JSON.parse(output.join(''))).toEqual({ createUrl: 'https://claimpaign.com/admin/create/' });
  });

  it('needs no login', () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    expect(() => campaignCreateMoved({ api: 'https://claimpaign.com', json: false })).toThrow('web interface');
  });
});

describe('campaign list', () => {
  const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, name: id, status, total_codes: 10, codes_claimed: 0, code_prefix: 'P', code_mode: 'unique', network: 'preprod', created_at: '2026-01-01',
    ada_per_claim: 10_000_000, campaign_type: 'ada', token_bundle: null, has_tokens: 0, has_nft: 0, ...extra,
  });

  const listFake = (campaigns: unknown[], tokenMeta: unknown = null) => startFakeApi({
    'GET /api/admin/campaigns': () => ({ status: 200, body: { campaigns, total: campaigns.length, page: 1, limit: 100, pages: 1, tokenMeta } }),
  });

  const listedIds = () => JSON.parse(output.join('')).campaigns.map((c: { id: string }) => c.id);

  it('loads two pages and shows every row', async () => {
    const thisFake = await startFakeApi({
      'GET /api/admin/campaigns': req => {
        const page = Number(req.url.searchParams.get('page') || '1');
        const campaigns = page === 1 ? [row('c1', 'active', { codes_claimed: 2 })] : [row('c2', 'ended', { total_codes: 5, codes_claimed: 5 })];
        return { status: 200, body: { campaigns, total: 2, page, limit: 100, pages: 2 } };
      },
    });
    fake = thisFake;

    await campaignList({ api: thisFake.url, json: false, all: true });
    const text = output.join('');
    expect(text).toContain('c1');
    expect(text).toContain('c2');
    expect(text).toContain('2/10');
    expect(text).toContain('5/5');
    expect(thisFake.calls.filter(c => c.method === 'GET').length).toBe(2);

    output = [];
    await campaignList({ api: thisFake.url, json: true, all: true });
    expect(listedIds()).toEqual(['c1', 'c2']);
  });

  it('hides ended and failed campaigns unless all is set, and says how many are hidden', async () => {
    fake = await listFake([row('live', 'active'), row('held', 'paused'), row('done', 'ended'), row('broken', 'creation_failed')]);

    await campaignList({ api: fake.url, json: false });
    const text = output.join('');
    expect(text).toContain('live');
    expect(text).toContain('held');
    expect(text).not.toContain('done');
    expect(text).not.toContain('broken');
    expect(errOutput.join('')).toContain('2 ended campaigns not shown, "claimpaign list --all" includes them');

    output = []; errOutput = [];
    await campaignList({ api: fake.url, json: false, all: true });
    expect(output.join('')).toContain('done');
    expect(output.join('')).toContain('broken');
    expect(errOutput.join('')).toBe('');
  });

  it('filters the json output the same way', async () => {
    fake = await listFake([row('live', 'active'), row('done', 'ended')]);

    await campaignList({ api: fake.url, json: true });
    expect(listedIds()).toEqual(['live']);
    expect(errOutput.join('')).toBe('');

    output = [];
    await campaignList({ api: fake.url, json: true, all: true });
    expect(listedIds()).toEqual(['live', 'done']);
  });

  it('prints an empty table and the hidden count when no campaign is running', async () => {
    fake = await listFake([row('done', 'ended')]);
    await campaignList({ api: fake.url, json: false });
    expect(output.join('')).toBe('(none)\n');
    expect(errOutput.join('')).toContain('1 ended campaign not shown, "claimpaign list --all" includes it');
  });

  it('shows what one claim pays, with the token floor, token amounts and nfts', async () => {
    const usdm = 'aa11.7455534d'; // asset name hex of "tUSDM"
    const mystery = 'bb22.4d59535445525930'; // asset name hex of "MYSTERY0", not in tokenMeta
    fake = await listFake([
      row('adaonly', 'active', { ada_per_claim: 10_000_000 }),
      row('tokens', 'active', { campaign_type: 'token', ada_per_claim: 0, has_tokens: 1, token_bundle: JSON.stringify([{ unit: usdm, quantity: '100000000' }, { unit: mystery, quantity: '5' }]) }),
      row('nft', 'active', { campaign_type: 'nft', ada_per_claim: 3_500_000, has_nft: 1 }),
    ], { [usdm]: { ticker: 'tUSDM', decimals: 6 } });

    await campaignList({ api: fake.url, json: false });
    const lines = output.join('').split('\n');
    expect(lines[0]).toContain('per claim');
    expect(lines.find(l => l.startsWith('adaonly'))).toContain('10.00 tADA');
    expect(lines.find(l => l.startsWith('tokens'))).toContain('2.00 tADA + 100 tUSDM + 5 MYSTERY0');
    expect(lines.find(l => l.startsWith('nft'))).toContain('3.50 tADA + NFT');
  });

  it('throws Not logged in without a stored token', async () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    const err = await campaignList({ api: 'http://127.0.0.1:1', json: false }).catch(e => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain('Not logged in');
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

describe('campaign end', () => {
  it('prints the refund in tADA on 200, sending only { status: "ended" }', async () => {
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-end-1': () => ({ status: 200, body: { ok: true, status: 'ended', refunded: 12_500_000 } }),
    });
    fake = thisFake;

    await campaignEnd('camp-end-1', { api: thisFake.url, json: false });
    expect(output.join('')).toBe('Campaign camp-end-1 ended, refunded 12.50 tADA\n');
    expect(thisFake.calls[0].body).toEqual({ status: 'ended' });
  });

  it('prints the raw 200 body with --json', async () => {
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-end-json': () => ({ status: 200, body: { ok: true, status: 'ended', refunded: 1_000_000 } }),
    });
    fake = thisFake;

    await campaignEnd('camp-end-json', { api: thisFake.url, json: true });
    const parsed = JSON.parse(output.join(''));
    expect(parsed).toEqual({ ok: true, status: 'ended', refunded: 1_000_000 });
  });

  it('throws the settling message on a 409 with "closing" in the text, without --wait', async () => {
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-end-2': () => ({ status: 409, body: { error: 'Payouts are closing, try again shortly' } }),
    });
    fake = thisFake;

    await expect(campaignEnd('camp-end-2', { api: thisFake.url, json: false }))
      .rejects.toThrow('Payouts are still settling, run again with --wait');
  });

  it('retries every waitMs on a closing 409 with --wait, succeeding once the server returns 200', async () => {
    let calls = 0;
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-end-3': () => {
        calls += 1;
        if (calls === 1) return { status: 409, body: { error: 'Payouts are closing' } };
        return { status: 200, body: { ok: true, status: 'ended', refunded: 5_000_000 } };
      },
    });
    fake = thisFake;

    await campaignEnd('camp-end-3', { api: thisFake.url, json: false, wait: true, waitMs: 10 });
    expect(calls).toBe(2);
    expect(output.join('')).toContain('refunded 5.00 tADA');
    expect(errOutput.join('')).toContain('Payouts are still settling, retrying...');
  });

  it('with --json and --wait on a closing 409 then 200, stdout carries only the 200 body, the settling note stays on stderr', async () => {
    let calls = 0;
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-end-json-wait': () => {
        calls += 1;
        if (calls === 1) return { status: 409, body: { error: 'Payouts are closing' } };
        return { status: 200, body: { ok: true, status: 'ended', refunded: 3_000_000 } };
      },
    });
    fake = thisFake;

    await campaignEnd('camp-end-json-wait', { api: thisFake.url, json: true, wait: true, waitMs: 10 });
    expect(calls).toBe(2);
    expect(output.length).toBe(1);
    expect(JSON.parse(output.join(''))).toEqual({ ok: true, status: 'ended', refunded: 3_000_000 });
    expect(errOutput.join('')).toContain('Payouts are still settling, retrying...');
  });

  it('propagates a non closing 409 as an ApiError with the server text', async () => {
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-end-4': () => ({ status: 409, body: { error: 'Campaign is already paused, cannot end' } }),
    });
    fake = thisFake;

    const err = await campaignEnd('camp-end-4', { api: thisFake.url, json: false }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Campaign is already paused, cannot end');
  });

  it('propagates a 400 as an ApiError with the server text', async () => {
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-end-5': () => ({ status: 400, body: { error: 'Campaign is already ended' } }),
    });
    fake = thisFake;

    const err = await campaignEnd('camp-end-5', { api: thisFake.url, json: false }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Campaign is already ended');
  });

  it('throws Not logged in without a stored token', async () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    const err = await campaignEnd('camp-x', { api: 'http://127.0.0.1:1', json: false }).catch(e => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain('Not logged in');
  });
});

describe('campaign pause and resume', () => {
  it('pauses with exactly { status: "paused" } and prints a confirmation', async () => {
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-pause-1': () => ({ status: 200, body: { ok: true, status: 'paused' } }),
    });
    fake = thisFake;

    await campaignPause('camp-pause-1', { api: thisFake.url, json: false });
    expect(output.join('')).toBe('Campaign camp-pause-1 paused\n');
    expect(thisFake.calls[0].body).toEqual({ status: 'paused' });
  });

  it('resumes with exactly { status: "active" } and prints a confirmation', async () => {
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-resume-1': () => ({ status: 200, body: { ok: true, status: 'active' } }),
    });
    fake = thisFake;

    await campaignResume('camp-resume-1', { api: thisFake.url, json: false });
    expect(output.join('')).toBe('Campaign camp-resume-1 resumed\n');
    expect(thisFake.calls[0].body).toEqual({ status: 'active' });
  });

  it('passes a 409 from pausing an ended campaign through as an ApiError with the server text', async () => {
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-pause-2': () => ({ status: 409, body: { error: 'Campaign is ended, cannot set paused' } }),
    });
    fake = thisFake;

    const err = await campaignPause('camp-pause-2', { api: thisFake.url, json: false }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Campaign is ended, cannot set paused');
  });

  it('prints the raw body with --json for both pause and resume', async () => {
    const thisFake = await startFakeApi({
      'PATCH /api/admin/campaign/camp-pr-json': req => ({ status: 200, body: { ok: true, status: req.body.status } }),
    });
    fake = thisFake;

    await campaignPause('camp-pr-json', { api: thisFake.url, json: true });
    expect(JSON.parse(output.join(''))).toEqual({ ok: true, status: 'paused' });

    output = [];
    await campaignResume('camp-pr-json', { api: thisFake.url, json: true });
    expect(JSON.parse(output.join(''))).toEqual({ ok: true, status: 'active' });
  });

  it('throws Not logged in without a stored token', async () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    const pauseErr = await campaignPause('camp-x', { api: 'http://127.0.0.1:1', json: false }).catch(e => e);
    expect(pauseErr).toBeInstanceOf(UsageError);
    expect(pauseErr.message).toContain('Not logged in');
    const resumeErr = await campaignResume('camp-x', { api: 'http://127.0.0.1:1', json: false }).catch(e => e);
    expect(resumeErr).toBeInstanceOf(UsageError);
    expect(resumeErr.message).toContain('Not logged in');
  });
});
