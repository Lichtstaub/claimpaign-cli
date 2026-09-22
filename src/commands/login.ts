import { writeConfig, resolveApi } from '../config.js';
import { apiRequest, ApiError } from '../api.js';
import { CancelledError, UsageError } from '../output.js';

/**
 * Prompt for a secret without echo. A TTY delivers raw chunks that may hold a pasted
 * key plus its line ending, so every chunk is scanned character by character and the
 * first line ending finishes the prompt. A pipe is read until its first line ending
 * or EOF. Raw mode and listeners are cleaned up on every exit path.
 */
/** Anything readable, with the TTY extras optional so tests can pass a PassThrough. */
export type SecretInput = NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown; pause(): unknown; resume(): unknown; unref?: () => unknown };

export function promptSecret(question: string, input: SecretInput = process.stdin): Promise<string> {
  process.stderr.write(question);
  const isTty = !!input.isTTY && typeof input.setRawMode === 'function';
  if (isTty) input.setRawMode!(true);
  input.resume();
  let buffer = '';
  return new Promise<string>((resolve, reject) => {
    const finish = (value: string | null, err?: Error) => {
      input.off('data', onData); input.off('end', onEnd); input.off('error', onError);
      if (isTty) input.setRawMode!(false);
      input.pause();
      // A read that finished on a line ending, not EOF, leaves the stream open, unref lets the process exit naturally
      input.unref?.();
      if (isTty) process.stderr.write('\n');
      if (err) reject(err); else resolve((value ?? buffer).trim());
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish(buffer);
        if (ch === '\x03') { finish(null, new CancelledError('Cancelled')); return; }
        if (ch === '\x7f' || ch === '\b') buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
    };
    const onEnd = () => finish(buffer);
    const onError = (err: Error) => finish(null, err);
    input.on('data', onData); input.on('end', onEnd); input.on('error', onError);
  });
}

export async function login(opts: { api?: string; token?: string; json: boolean }): Promise<void> {
  const api = resolveApi(opts.api);
  const token = opts.token ?? await promptSecret('Paste your sandbox API key (from Settings, Sandbox API): ');
  if (!/^cps_[a-z2-9]{40}$/.test(token)) throw new UsageError('That does not look like a Claimpaign sandbox key (cps_ followed by 40 characters)');
  try {
    await apiRequest({ api, token, method: 'GET', path: '/api/org/credits' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw new Error('This key was not accepted. Create one under Settings, Sandbox API.');
    throw err;
  }
  writeConfig({ token, api });
  if (!opts.json) process.stdout.write(`Logged in. Key stored in ${configPathHint()} (sandbox only).\n`);
}

export async function logout(): Promise<void> {
  writeConfig({}, ['token']);
}

function configPathHint(): string {
  return process.env.CLAIMPAIGN_CONFIG_DIR ? `${process.env.CLAIMPAIGN_CONFIG_DIR}/config.json` : '~/.config/claimpaign/config.json';
}
