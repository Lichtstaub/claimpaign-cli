import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

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
});
