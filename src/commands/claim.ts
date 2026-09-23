import { apiRequest } from '../api.js';
import { resolveApi } from '../config.js';
import { print, UsageError, formatAda } from '../output.js';
import { parseClaimUri, splitFullCode, normalizeShortCode } from '../codes.js';

interface ClaimResponseBody {
  code: number | string;
  status: string;
  message?: string;
  lovelaces?: string | number;
  tokens?: Record<string, string | number>;
  queue_position?: number;
}

/** Per-status message for every non accepted CIP-99 claim status, see api-contract.md. */
const STATUS_MESSAGES: Record<string, string> = {
  notfound: 'Unknown code',
  alreadyclaimed: 'This code was already claimed',
  expired: 'This campaign has expired',
  ratelimited: 'Too many attempts from this network, wait 15 minutes',
  soldout: 'All claims of this campaign are used up',
  walletlimitreached: 'This wallet reached the claim limit',
  nostakekey: 'Use a base address with a staking part',
  invalidaddress: 'The address was not accepted',
  notclaimable: 'This campaign is not accepting claims right now',
  maintenance: 'The faucet is in maintenance',
  invalidrequest: 'The faucet rejected the request',
  missingcode: 'The faucet rejected the request',
  error: 'The faucet reported an error',
};

/**
 * Resolves the input into a faucet URL and a code, in this order: a CIP-99 uri gives both
 * untouched, an explicit --faucet posts the input untouched to that url, otherwise the input
 * is a Claimpaign code (PREFIX_shortcode) and the faucet url is derived from the api base.
 */
function resolveClaimTarget(input: string, faucetOpt: string | undefined, api: string): { faucetUrl: string; code: string } {
  if (input.startsWith('web+cardano:')) {
    const parsed = parseClaimUri(input);
    if (!parsed) throw new UsageError('Not a valid CIP-99 claim URI');
    return parsed;
  }

  if (faucetOpt) {
    return { faucetUrl: faucetOpt, code: input };
  }

  const split = splitFullCode(input);
  if (!split) throw new UsageError('This does not look like a Claimpaign code (expected PREFIX_code)');
  const shortCode = normalizeShortCode(split.shortCode);
  if (!shortCode) throw new UsageError('This does not look like a Claimpaign code');
  return { faucetUrl: `${api}/api/claim/${split.prefix.toUpperCase()}`, code: shortCode };
}

function formatAccepted(body: ClaimResponseBody): string {
  const ada = Number(body.lovelaces ?? 0) / 1_000_000;
  const parts = [`Accepted: ${formatAda(ada)} tADA`];
  if (body.tokens && Object.keys(body.tokens).length > 0) {
    const tokenList = Object.entries(body.tokens).map(([unit, qty]) => `${unit}:${qty}`).join(', ');
    parts.push(`tokens ${tokenList}`);
  }
  if (typeof body.queue_position === 'number') {
    parts.push(`queue position ${body.queue_position}`);
  }
  return parts.join(', ');
}

/** Claims a CIP-99 code to a Cardano testnet address. No login, no bearer header sent. */
export async function claim(input: string, address: string, opts: { api?: string; json: boolean; faucet?: string }): Promise<void> {
  const api = resolveApi(opts.api);
  const { faucetUrl, code } = resolveClaimTarget(input, opts.faucet, api);

  if (!address.startsWith('addr_test')) {
    throw new UsageError('This tool claims to Cardano testnet addresses (addr_test...) only, mainnet addresses (addr1...) are not accepted.');
  }

  const url = new URL(faucetUrl);
  const { status, body: rawBody } = await apiRequest({
    api: url.origin,
    method: 'POST',
    path: url.pathname + url.search,
    body: { code, address },
    allow: [400, 401, 403, 404, 409, 410, 422, 429, 500, 503],
  });

  if (!rawBody || typeof rawBody !== 'object') {
    throw new Error(`The faucet answered with an unexpected response (HTTP ${status})`);
  }
  const body = rawBody as ClaimResponseBody;

  if (body.status === 'accepted') {
    if (opts.json) {
      print(body, { json: true });
      return;
    }
    print(formatAccepted(body), { json: false });
    return;
  }

  if (opts.json) print(body, { json: true });

  const base = STATUS_MESSAGES[body.status] ?? `The faucet answered with status ${body.status}`;
  throw new Error(body.message ? `${base} (${body.message})` : base);
}
