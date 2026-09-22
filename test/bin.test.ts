import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
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
});
