import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, writeConfig, resolveToken, resolveApi, configPath } from '../src/config.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cp-')); process.env.CLAIMPAIGN_CONFIG_DIR = dir; delete process.env.CLAIMPAIGN_TOKEN; delete process.env.CLAIMPAIGN_API; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.CLAIMPAIGN_CONFIG_DIR; });

describe('config file', () => {
  it('writes the file with owner-only permissions and reads it back', () => {
    writeConfig({ token: 'cps_' + 'a'.repeat(40) });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(readConfig().token).toBe('cps_' + 'a'.repeat(40));
    writeConfig({ api: 'http://localhost:4321' });
    expect(readConfig()).toEqual({ token: 'cps_' + 'a'.repeat(40), api: 'http://localhost:4321' });
  });
  it('resolves the token from the environment before the file', () => {
    writeConfig({ token: 'cps_file' });
    expect(resolveToken()).toBe('cps_file');
    process.env.CLAIMPAIGN_TOKEN = 'cps_env';
    expect(resolveToken()).toBe('cps_env');
  });
  it('resolves the api url from flag, env, file, default', () => {
    expect(resolveApi()).toBe('https://claimpaign.com');
    writeConfig({ api: 'http://file:1/' });
    expect(resolveApi()).toBe('http://file:1');
    process.env.CLAIMPAIGN_API = 'http://env:2';
    expect(resolveApi()).toBe('http://env:2');
    expect(resolveApi('http://flag:3')).toBe('http://flag:3');
  });
  it('returns an empty config when the file is missing or corrupt', () => {
    expect(readConfig()).toEqual({});
    writeConfig({ token: 'x' });
    writeFileSync(configPath(), '{not json');
    expect(readConfig()).toEqual({});
  });
});
