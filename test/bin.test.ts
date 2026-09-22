import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('installed binary', () => {
  it('runs under its npm bin name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-bin-'));
    const link = join(dir, 'claimpaign');
    symlinkSync(resolve('dist/bin.js'), link);
    const r = spawnSync('node', [link, '--version'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('installs from the packed tarball into a fresh project and runs the published bin', () => {
    const packDir = mkdtempSync(join(tmpdir(), 'cp-pack-'));
    const probeDir = mkdtempSync(join(tmpdir(), 'cp-probe-'));
    try {
      execFileSync('npm', ['pack', '--pack-destination', packDir], { cwd: resolve('.'), stdio: 'ignore' });
      const tarballName = readdirSync(packDir).find(f => f.endsWith('.tgz'));
      if (!tarballName) throw new Error('npm pack did not produce a tarball');
      const tarballPath = join(packDir, tarballName);

      writeFileSync(join(probeDir, 'package.json'), JSON.stringify({ name: 'probe', private: true }));
      execFileSync('npm', ['install', '--no-audit', '--no-fund', tarballPath], { cwd: probeDir, stdio: 'ignore' });

      const version = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version;
      const bin = join(probeDir, 'node_modules', '.bin', 'claimpaign');
      const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(version);
    } finally {
      rmSync(packDir, { recursive: true, force: true });
      rmSync(probeDir, { recursive: true, force: true });
    }
  }, 60_000);
});
