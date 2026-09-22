import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeApi } from './helpers/fake-api.js';
import { claim } from '../src/commands/claim.js';
import { UsageError } from '../src/output.js';

const TEST_ADDRESS = 'addr_test1qzown0wnwallet';
const MAINNET_ADDRESS = 'addr1qzown0wnwallet';

let api: Awaited<ReturnType<typeof startFakeApi>>;
let output: string[];

beforeEach(() => {
  output = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { output.push(String(chunk)); return true; });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (api) await api.close();
});

describe('claim', () => {
  it('claims via a CIP-99 uri, posting to faucet_url with the code untouched and no auth header', async () => {
    api = await startFakeApi({
      'POST /api/claim/v1/01ksj7qeeg0kbh5s64ds2x9yya': () => ({
        status: 200,
        body: { code: 200, status: 'accepted', lovelaces: '2000000', queue_position: 1 },
      }),
    });
    const faucetUrl = `${api.url}/api/claim/v1/01ksj7qeeg0kbh5s64ds2x9yya`;
    const uri = `web+cardano://claim/v1?faucet_url=${encodeURIComponent(faucetUrl)}&code=01KSJ8PW11CPCG40G7S7TVKXZ9`;

    await claim(uri, TEST_ADDRESS, { api: api.url, json: false });

    expect(api.calls).toHaveLength(1);
    const call = api.calls[0];
    expect(call.path).toBe('/api/claim/v1/01ksj7qeeg0kbh5s64ds2x9yya');
    expect(call.body).toEqual({ code: '01KSJ8PW11CPCG40G7S7TVKXZ9', address: TEST_ADDRESS });
    expect(call.headers.authorization).toBeUndefined();
  });

  it('posts a bare foreign code untouched to --faucet', async () => {
    api = await startFakeApi({
      'POST /faucet/foreign': () => ({
        status: 200,
        body: { code: 200, status: 'accepted', lovelaces: '1000000', queue_position: 1 },
      }),
    });
    await claim('Foreign-Code-123', TEST_ADDRESS, { api: api.url, json: false, faucet: `${api.url}/faucet/foreign` });

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].path).toBe('/faucet/foreign');
    expect(api.calls[0].body).toEqual({ code: 'Foreign-Code-123', address: TEST_ADDRESS });
  });

  it('folds a bare Claimpaign code and posts to the derived faucet url', async () => {
    api = await startFakeApi({
      'POST /api/claim/HACK': () => ({
        status: 200,
        body: { code: 200, status: 'accepted', lovelaces: '2000000', queue_position: 1 },
      }),
    });
    await claim('hack_7k3mq9xz4h', TEST_ADDRESS, { api: api.url, json: false });

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].path).toBe('/api/claim/HACK');
    expect(api.calls[0].body).toEqual({ code: '7K3MQ9XZ4H', address: TEST_ADDRESS });
  });

  it('passes a legacy hex code through lowercase', async () => {
    api = await startFakeApi({
      'POST /api/claim/HACK': () => ({
        status: 200,
        body: { code: 200, status: 'accepted', lovelaces: '2000000', queue_position: 1 },
      }),
    });
    await claim('HACK_ab12cd34', TEST_ADDRESS, { api: api.url, json: false });

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].path).toBe('/api/claim/HACK');
    expect(api.calls[0].body).toEqual({ code: 'ab12cd34', address: TEST_ADDRESS });
  });

  it('rejects a mainnet address before making any request', async () => {
    api = await startFakeApi({});
    await expect(claim('hack_7k3mq9xz4h', MAINNET_ADDRESS, { api: api.url, json: false }))
      .rejects.toThrow(UsageError);
    expect(api.calls).toHaveLength(0);
  });

  it('rejects a mainnet address with the exact message', async () => {
    api = await startFakeApi({});
    await expect(claim('hack_7k3mq9xz4h', MAINNET_ADDRESS, { api: api.url, json: false }))
      .rejects.toThrow('This tool claims on the Cardano preprod testnet only, mainnet addresses (addr1...) are not accepted.');
  });

  it('rejects an invalid CIP-99 uri', async () => {
    api = await startFakeApi({});
    await expect(claim('web+cardano://bogus', TEST_ADDRESS, { api: api.url, json: false }))
      .rejects.toThrow('Not a valid CIP-99 claim URI');
    expect(api.calls).toHaveLength(0);
  });

  it('rejects a bare code that does not look like a Claimpaign code', async () => {
    api = await startFakeApi({});
    await expect(claim('not-a-valid-code-at-all', TEST_ADDRESS, { api: api.url, json: false }))
      .rejects.toThrow(UsageError);
    expect(api.calls).toHaveLength(0);
  });

  it('prints ada, tokens and queue position when accepted', async () => {
    api = await startFakeApi({
      'POST /api/claim/HACK': () => ({
        status: 200,
        body: {
          code: 200,
          status: 'accepted',
          lovelaces: '3000000',
          tokens: { 'policyidhex.617373657431': '100', 'policyidhex.617373657432': '5' },
          queue_position: 3,
        },
      }),
    });
    await claim('hack_7k3mq9xz4h', TEST_ADDRESS, { api: api.url, json: false });

    const text = output.join('');
    expect(text).toContain('Accepted: 3 tADA');
    expect(text).toContain('tokens policyidhex.617373657431:100, policyidhex.617373657432:5');
    expect(text).toContain('queue position 3');
  });

  it('prints only the ada part when there are no tokens', async () => {
    api = await startFakeApi({
      'POST /api/claim/HACK': () => ({
        status: 200,
        body: { code: 200, status: 'accepted', lovelaces: '2000000', queue_position: 1 },
      }),
    });
    await claim('hack_7k3mq9xz4h', TEST_ADDRESS, { api: api.url, json: false });

    const text = output.join('');
    expect(text).toContain('Accepted: 2 tADA');
    expect(text).not.toContain('tokens');
    expect(text).toContain('queue position 1');
  });

  it('prints the raw body as json on success', async () => {
    const body = { code: 200, status: 'accepted', lovelaces: '2000000', queue_position: 1 };
    api = await startFakeApi({
      'POST /api/claim/HACK': () => ({ status: 200, body }),
    });
    await claim('hack_7k3mq9xz4h', TEST_ADDRESS, { api: api.url, json: true });

    expect(JSON.parse(output.join(''))).toEqual(body);
  });

  const STATUS_CASES: Array<[string, number, string]> = [
    ['notfound', 404, 'Unknown code'],
    ['alreadyclaimed', 409, 'This code was already claimed'],
    ['expired', 410, 'This campaign has expired'],
    ['ratelimited', 429, 'Too many attempts from this network, wait 15 minutes'],
    ['soldout', 409, 'All claims of this campaign are used up'],
    ['walletlimitreached', 409, 'This wallet reached the claim limit'],
    ['nostakekey', 400, 'Use a base address with a staking part'],
    ['invalidaddress', 400, 'The address was not accepted'],
    ['notclaimable', 403, 'This campaign is not accepting claims right now'],
    ['maintenance', 503, 'The faucet is in maintenance'],
    ['invalidrequest', 400, 'The faucet rejected the request'],
    ['missingcode', 400, 'The faucet rejected the request'],
    ['error', 500, 'The faucet reported an error'],
  ];

  for (const [status, httpStatus, expectedText] of STATUS_CASES) {
    it(`maps ${status} to its message and appends the server detail`, async () => {
      api = await startFakeApi({
        'POST /api/claim/HACK': () => ({
          status: httpStatus,
          body: { code: httpStatus, status, message: 'server detail' },
        }),
      });
      await expect(claim('hack_7k3mq9xz4h', TEST_ADDRESS, { api: api.url, json: false }))
        .rejects.toThrow(`${expectedText} (server detail)`);
    });
  }

  it('maps an unknown status to a generic message with the raw status', async () => {
    api = await startFakeApi({
      'POST /api/claim/HACK': () => ({ status: 400, body: { code: 400, status: 'teapot' } }),
    });
    await expect(claim('hack_7k3mq9xz4h', TEST_ADDRESS, { api: api.url, json: false }))
      .rejects.toThrow('The faucet answered with status teapot');
  });

  it('omits the parenthetical when the server sends no message', async () => {
    api = await startFakeApi({
      'POST /api/claim/HACK': () => ({ status: 404, body: { code: 404, status: 'notfound' } }),
    });
    await expect(claim('hack_7k3mq9xz4h', TEST_ADDRESS, { api: api.url, json: false }))
      .rejects.toThrow('Unknown code');
  });

  it('prints the raw body then throws on failure with --json', async () => {
    const body = { code: 404, status: 'notfound' };
    api = await startFakeApi({
      'POST /api/claim/HACK': () => ({ status: 404, body }),
    });
    await expect(claim('hack_7k3mq9xz4h', TEST_ADDRESS, { api: api.url, json: true }))
      .rejects.toThrow('Unknown code');
    expect(JSON.parse(output.join(''))).toEqual(body);
  });
});
