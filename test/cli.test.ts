import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeKey } from './helpers/fake-api.js';

const run = (...args: string[]) => spawnSync('npx', ['tsx', 'src/bin.ts', ...args], { encoding: 'utf8' });

describe('claimpaign', () => {
  it('prints its version with exit 0', () => {
    const r = run('--version');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('lists the commands in help', () => {
    const help = run('--help').stdout;
    for (const cmd of ['login', 'balance', 'deposit', 'campaign', 'claim']) expect(help).toContain(cmd);
  });
  it('exits 2 on an unknown command or option', () => {
    expect(run('nonsense').status).toBe(2);
    expect(run('--bogus').status).toBe(2);
  });
  it('campaign create with no options and an empty config dir exits 2 with the missing --name/--claims message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-cli-create-'));
    try {
      const r = spawnSync('npx', ['tsx', 'src/bin.ts', '--api', 'http://127.0.0.1:1', 'campaign', 'create'], {
        encoding: 'utf8',
        env: { ...process.env, CLAIMPAIGN_CONFIG_DIR: dir, CLAIMPAIGN_TOKEN: fakeKey('cli') },
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('--name and --claims are required to create a new campaign');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
