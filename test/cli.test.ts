import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (...args: string[]) => spawnSync('npx', ['tsx', 'src/bin.ts', ...args], { encoding: 'utf8' });

describe('claimpaign', () => {
  it('prints its version with exit 0', () => {
    const r = run('--version');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('lists the commands in help', () => {
    const help = run('--help').stdout;
    for (const cmd of ['login', 'logout', 'balance', 'deposit', 'create', 'list', 'status', 'codes', 'end', 'pause', 'resume', 'claim']) expect(help).toContain(cmd);
    expect(help).toContain('sandbox (preprod)');
  });
  it('exits 2 on an unknown command or option', () => {
    expect(run('nonsense').status).toBe(2);
    expect(run('--bogus').status).toBe(2);
    expect(run('campaign', 'list').status).toBe(2); // the campaign group is gone since 0.3.0
  });
  it('create exits 1 with the web interface link, also with options and arguments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-cli-create-'));
    try {
      for (const args of [
        ['create'],
        ['create', '--name', 'test123', '--claims', '2', '--ada', '100'],
        ['create', 'test123'],
        ['create', '--token', `${'a'.repeat(56)}.00:1`, '--shared', '--fresh'],
      ]) {
        const r = spawnSync('npx', ['tsx', 'src/bin.ts', '--api', 'http://127.0.0.1:1', ...args], {
          encoding: 'utf8',
          env: { ...process.env, CLAIMPAIGN_CONFIG_DIR: dir, CLAIMPAIGN_TOKEN: '' },
        });
        expect(r.status, args.join(' ')).toBe(1);
        expect(r.stderr).toContain('http://127.0.0.1:1/admin/create/');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
