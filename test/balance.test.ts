import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeApi, fakeKey, authGuarded } from './helpers/fake-api.js';
import { balance } from '../src/commands/balance.js';
import { deposit } from '../src/commands/deposit.js';
import { UsageError } from '../src/output.js';

const TOKEN = fakeKey('balance');

const CREDITS_BODY = {
  network: 'preprod',
  businessComplete: true,
  balance: { lovelace: 1234500000, ada: 1234.5 },
  balances: { preprod: { lovelace: 1234500000, ada: 1234.5 } },
  summary: {
    totalDeposited: { lovelace: 1500000000, ada: 1500 },
    lockedInCampaigns: { lovelace: 200000000, ada: 200 },
    activeCampaignCount: 2,
  },
  platformAddress: 'addr_test1qzplatform0addr',
  transactions: [],
};

let dir: string;
let api: Awaited<ReturnType<typeof startFakeApi>>;
let output: string[];

beforeEach(async () => {
  output = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { output.push(String(chunk)); return true; });
  dir = mkdtempSync(join(tmpdir(), 'cp-balance-'));
  process.env.CLAIMPAIGN_CONFIG_DIR = dir;
  process.env.CLAIMPAIGN_TOKEN = TOKEN;
  api = await startFakeApi({
    'GET /api/org/credits': authGuarded(TOKEN, CREDITS_BODY),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  expect(api.errors, 'fake api handler threw').toEqual([]);
  await api.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CLAIMPAIGN_CONFIG_DIR;
  delete process.env.CLAIMPAIGN_TOKEN;
});

describe('balance', () => {
  it('prints the credits line', async () => {
    await balance({ api: api.url, json: false });
    expect(output.join('')).toBe('Sandbox (preprod) credits: 1,234.50 tADA (locked in campaigns: 200.00, active campaigns: 2)\n');
  });

  it('never asks for the organization wallet', async () => {
    await balance({ api: api.url, json: false });
    expect(api.calls.map(c => c.path)).toEqual(['/api/org/credits']);
  });

  it('prints the raw credits body as json', async () => {
    await balance({ api: api.url, json: true });
    expect(JSON.parse(output.join(''))).toEqual({ credits: CREDITS_BODY });
  });

  it('throws Not logged in without a stored token', async () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    const err = await balance({ api: api.url, json: false }).catch(e => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain('Not logged in');
  });
});

describe('deposit', () => {
  it('prints the top up link, the faucet and where test tokens come from, without an address', () => {
    deposit({ api: api.url, json: false });
    const text = output.join('');
    expect(text).toContain(`${api.url}/admin/create/`);
    expect(text).toContain('https://docs.cardano.org/cardano-testnets/tools/faucet');
    expect(text).toContain('tUSDM');
    expect(text).not.toMatch(/addr_test/);
  });

  it('prints both links as json', () => {
    deposit({ api: api.url, json: true });
    expect(JSON.parse(output.join(''))).toEqual({
      topupUrl: `${api.url}/admin/create/`,
      faucetUrl: 'https://docs.cardano.org/cardano-testnets/tools/faucet',
    });
  });

  it('needs no login and sends no request', () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    deposit({ api: api.url, json: false });
    expect(api.calls).toEqual([]);
  });
});
