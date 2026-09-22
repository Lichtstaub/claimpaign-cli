import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeApi, fakeKey } from './helpers/fake-api.js';

// End to end coverage of the login/logout wiring in src/cli.ts. The fake api server
// runs in this same process, so the child cli process is driven with the async
// spawn() rather than spawnSync(): spawnSync blocks this process's event loop while
// it waits for the child, which would starve the fake server of the chance to answer
// the child's request and deadlock the test. spawn() keeps stdout/stderr as pipes
// rather than forwarding them, so this stays quiet in the vitest output.
const GOOD = fakeKey('cligood');
const BAD = fakeKey('clibad');

interface CliResult { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }

// A 15s timeout so a regression of the stdin dangling handle fails this test instead of
// hanging the whole suite, the child gets killed and r.signal is non null in that case.
function runCli(args: string[], input: string, dir: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/bin.ts', ...args], {
      // The child must not inherit a token or api from the developer shell
      env: { ...process.env, CLAIMPAIGN_CONFIG_DIR: dir, CLAIMPAIGN_TOKEN: undefined, CLAIMPAIGN_API: undefined },
      timeout: 15000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'cp-cli-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const readConfigFile = (dir: string) => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));

describe('login and logout through the cli', () => {
  let api: Awaited<ReturnType<typeof startFakeApi>>;

  beforeAll(async () => {
    api = await startFakeApi({
      'GET /api/org/credits': req => req.headers.authorization === `Bearer ${GOOD}`
        ? { status: 200, body: { balance: { lovelace: 5000000, ada: 5 }, balances: { preprod: { lovelace: 5000000, ada: 5 } } } }
        : { status: 401, body: { error: 'Invalid API key' } },
    });
  });
  afterAll(async () => { await api.close(); });
  afterEach(() => { expect(api.errors, 'fake api handler threw').toEqual([]); });

  it('logs in with a good key piped on stdin and never echoes it', async () => {
    await withDir(async dir => {
      const r = await runCli(['login', '--api', api.url], GOOD + '\n', dir);
      expect(r.status).toBe(0);
      expect(r.signal).toBeNull();
      expect(readConfigFile(dir)).toEqual({ token: GOOD, api: api.url });
      expect(r.stdout).not.toContain(GOOD);
    });
  });

  it('rejects a bad key, stores nothing, and never echoes it', async () => {
    await withDir(async dir => {
      const r = await runCli(['login', '--api', api.url], BAD + '\n', dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('not accepted');
      expect(r.stderr).not.toContain(BAD);
      expect(() => readConfigFile(dir)).toThrow();
    });
  });

  it('exits 130 and stores nothing when the prompt is cancelled', async () => {
    await withDir(async dir => {
      const r = await runCli(['login', '--api', api.url], '\x03', dir);
      expect(r.status).toBe(130);
      expect(() => readConfigFile(dir)).toThrow();
    });
  });

  it('logs out, removing the token but keeping the api url', async () => {
    await withDir(async dir => {
      const login = await runCli(['login', '--api', api.url], GOOD + '\n', dir);
      expect(login.status).toBe(0);
      const r = await runCli(['logout'], '', dir);
      expect(r.status).toBe(0);
      expect(r.signal).toBeNull();
      expect(r.stdout.trim()).toBe('Logged out.');
      expect(readConfigFile(dir)).toEqual({ api: api.url });
    });
  });

  it('exits 2 for balance with no token and an empty config', async () => {
    await withDir(async dir => {
      const r = await runCli(['balance'], '', dir);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('Not logged in');
    });
  });
});
