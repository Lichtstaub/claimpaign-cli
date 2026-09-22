import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { startFakeApi, fakeKey } from './helpers/fake-api.js';
import { login, logout, promptSecret } from '../src/commands/login.js';
import { readConfig } from '../src/config.js';

// Keys must pass the local shape check (cps_ plus 40 chars of a-z and 2-9)
const GOOD = fakeKey('good');
const BAD = fakeKey('bad');
let dir: string; let api: Awaited<ReturnType<typeof startFakeApi>>;
beforeEach(async () => {
  // login() and promptSecret() write status text to stdout/stderr, keep the test run's own output clean
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  dir = mkdtempSync(join(tmpdir(), 'cp-')); process.env.CLAIMPAIGN_CONFIG_DIR = dir;
  api = await startFakeApi({
    'GET /api/org/credits': req => req.headers.authorization === `Bearer ${GOOD}`
      ? { status: 200, body: { balance: { lovelace: 5000000, ada: 5 }, balances: { preprod: { lovelace: 5000000, ada: 5 } } } }
      : { status: 401, body: { error: 'Invalid API key' } },
  });
});
afterEach(async () => { vi.restoreAllMocks(); await api.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.CLAIMPAIGN_CONFIG_DIR; });

describe('login', () => {
  it('stores a key the server accepts, together with the api url', async () => {
    await login({ api: api.url, token: GOOD, json: false });
    expect(readConfig()).toEqual({ token: GOOD, api: api.url });
  });
  it('rejects a key the server refuses and stores nothing', async () => {
    await expect(login({ api: api.url, token: BAD, json: false })).rejects.toThrow('not accepted');
    expect(readConfig()).toEqual({});
  });
  it('logout removes the token but keeps the api url', async () => {
    await login({ api: api.url, token: GOOD, json: false });
    await logout();
    expect(readConfig()).toEqual({ api: api.url });
  });
});

describe('promptSecret', () => {
  it('returns the key from a pasted line with a line ending', async () => {
    const input = new PassThrough();
    const promise = promptSecret('Key: ', input);
    input.write(GOOD + '\n');
    expect(await promise).toBe(GOOD);
  });

  it('assembles a key delivered across several chunks', async () => {
    const input = new PassThrough();
    const promise = promptSecret('Key: ', input);
    input.write(GOOD.slice(0, 10));
    input.write(GOOD.slice(10, 25));
    input.write(GOOD.slice(25) + '\n');
    expect(await promise).toBe(GOOD);
  });

  it('is finished by the line ending on a pipe that stays open', async () => {
    const input = new PassThrough();
    const promise = promptSecret('Key: ', input);
    input.write(GOOD + '\n');
    expect(await promise).toBe(GOOD);
    // the stream itself was never ended, only the line ending resolved the prompt
    expect(input.destroyed).toBe(false);
    expect(input.writableEnded).toBe(false);
  });

  it('returns the buffer at EOF when no line ending arrives', async () => {
    const input = new PassThrough();
    const promise = promptSecret('Key: ', input);
    input.write(GOOD);
    input.end();
    expect(await promise).toBe(GOOD);
  });
});
