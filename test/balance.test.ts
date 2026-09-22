import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeApi, fakeKey } from './helpers/fake-api.js';
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

const WALLET_BODY = {
  network: 'preprod',
  address: 'addr_test1qzown0wnwallet',
  ada: { lovelace: '12000000', ada: 12 },
  tokens: [
    {
      unit: 'platformunittusdm',
      policyId: 'platformpolicy',
      assetNameHex: '745553444d',
      assetNameUtf8: 'tUSDM',
      onChain: '1000000000',
      reserved: '0',
      inFlight: '0',
      available: '1000000000',
      platform: true,
    },
    {
      unit: 'ownunithackusd',
      policyId: 'ownpolicy',
      assetNameHex: '4841434b555344',
      assetNameUtf8: 'HACKUSD',
      onChain: '950',
      reserved: '0',
      inFlight: '0',
      available: '950',
      platform: false,
    },
  ],
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
    'GET /api/org/credits': req => req.headers.authorization === `Bearer ${TOKEN}`
      ? { status: 200, body: CREDITS_BODY }
      : { status: 401, body: { error: 'Invalid API key' } },
    'GET /api/org/wallet': req => req.headers.authorization === `Bearer ${TOKEN}`
      ? { status: 200, body: WALLET_BODY }
      : { status: 401, body: { error: 'Invalid API key' } },
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
  it('prints the credits line, the wallet line and the token table', async () => {
    await balance({ api: api.url, json: false });
    const text = output.join('');
    expect(text).toContain('Sandbox credits: 1,234.50 tADA (locked in campaigns: 200.00, active campaigns: 2)');
    expect(text).toContain('Org wallet: addr_test1qzown0wnwallet  (12.00 tADA)');
    expect(text).toContain('Token');
    expect(text).toContain('Available');
    expect(text).toContain('Reserved');
    expect(text).toContain('Settling');
  });

  it('lists the org own token before the platform token, with a platform suffix', async () => {
    await balance({ api: api.url, json: false });
    const text = output.join('');
    const ownIndex = text.indexOf('HACKUSD');
    const platformIndex = text.indexOf('tUSDM (platform)');
    expect(ownIndex).toBeGreaterThan(-1);
    expect(platformIndex).toBeGreaterThan(-1);
    expect(ownIndex).toBeLessThan(platformIndex);
  });

  it('prints (none) when the wallet holds no tokens', async () => {
    await api.close();
    api = await startFakeApi({
      'GET /api/org/credits': () => ({ status: 200, body: CREDITS_BODY }),
      'GET /api/org/wallet': () => ({ status: 200, body: { ...WALLET_BODY, tokens: [] } }),
    });
    await balance({ api: api.url, json: false });
    expect(output.join('')).toContain('(none)');
  });

  it('prints a token amount above 2^53 unchanged, as the raw string', async () => {
    const hugeAmount = '12345678901234567890';
    await api.close();
    api = await startFakeApi({
      'GET /api/org/credits': () => ({ status: 200, body: CREDITS_BODY }),
      'GET /api/org/wallet': () => ({
        status: 200,
        body: {
          ...WALLET_BODY,
          tokens: [{ ...WALLET_BODY.tokens[1], available: hugeAmount }],
        },
      }),
    });
    await balance({ api: api.url, json: false });
    expect(output.join('')).toContain(hugeAmount);
  });

  it('prints the raw credits and wallet bodies as json', async () => {
    await balance({ api: api.url, json: true });
    const parsed = JSON.parse(output.join(''));
    expect(parsed).toEqual({ credits: CREDITS_BODY, wallet: WALLET_BODY });
  });

  it('throws Not logged in without a stored token', async () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    const err = await balance({ api: api.url, json: false }).catch(e => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain('Not logged in');
  });
});

describe('deposit', () => {
  it('prints the wallet address and the credits top up link', async () => {
    await deposit({ api: api.url, json: false });
    const text = output.join('');
    expect(text).toContain('addr_test1qzown0wnwallet');
    expect(text).toContain(`${api.url}/admin/create/`);
  });

  it('prints the address and network as json', async () => {
    await deposit({ api: api.url, json: true });
    expect(JSON.parse(output.join(''))).toEqual({ address: 'addr_test1qzown0wnwallet', network: 'preprod' });
  });

  it('throws Not logged in without a stored token', async () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    const err = await deposit({ api: api.url, json: false }).catch(e => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain('Not logged in');
  });
});
