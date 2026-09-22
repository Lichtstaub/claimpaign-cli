import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CliConfig { token?: string; api?: string }
export const DEFAULT_API = 'https://claimpaign.com';

export function configDir(): string {
  return process.env.CLAIMPAIGN_CONFIG_DIR || join(homedir(), '.config', 'claimpaign');
}
export function configPath(): string { return join(configDir(), 'config.json'); }

export function readConfig(): CliConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8'));
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch { return {}; }
}

export function writeConfig(patch: Partial<CliConfig>, remove: (keyof CliConfig)[] = []): void {
  const next: CliConfig = { ...readConfig(), ...patch };
  for (const key of remove) delete next[key];
  if (!existsSync(configDir())) mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  chmodSync(configPath(), 0o600);
}

export function resolveToken(): string | undefined {
  return process.env.CLAIMPAIGN_TOKEN || readConfig().token;
}

export function resolveApi(flag?: string): string {
  const raw = flag || process.env.CLAIMPAIGN_API || readConfig().api || DEFAULT_API;
  return raw.replace(/\/+$/, '');
}
