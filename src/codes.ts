/**
 * Claim code normalization and CIP-99 URI helpers, ported from the server's
 * src/lib/codes.ts on claimpaign.com. Short codes are 10 characters of Crockford
 * base32 (0-9, A-Z without I, L, O, U). Legacy codes are 6 to 9 lowercase hex
 * characters and stay valid, the same way the server accepts both.
 */

const CODE_LENGTH = 10;
const CROCKFORD_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const LEGACY_HEX_CODE = /^[a-f0-9]{6,9}$/;

/**
 * Turn user input into the stored short code form, or null if it cannot be a code.
 * Crockford codes (10 chars) are uppercased and the classic typos are folded the way
 * the spec allows: O reads as 0, I and L read as 1. Legacy hex codes (6 to 9 chars)
 * are lowercased and returned as they are.
 */
export function normalizeShortCode(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === CODE_LENGTH) {
    const folded = trimmed.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
    return CROCKFORD_CODE.test(folded) ? folded : null;
  }
  const lower = trimmed.toLowerCase();
  return LEGACY_HEX_CODE.test(lower) ? lower : null;
}

/** Splits a full code (PREFIX_shortcode) on the last underscore, null when it does not have one. */
export function splitFullCode(full: string): { prefix: string; shortCode: string } | null {
  const sep = full.lastIndexOf('_');
  if (sep < 0) return null;
  const prefix = full.slice(0, sep);
  const shortCode = full.slice(sep + 1);
  if (!prefix || !shortCode) return null;
  return { prefix, shortCode };
}

/** Builds a CIP-99 claim URI for a Claimpaign faucet endpoint, matching the server's format. */
export function buildClaimUri(api: string, prefix: string, shortCode: string): string {
  const faucetUrl = `${api}/api/claim/${prefix}`;
  return `web+cardano://claim/v1?faucet_url=${encodeURIComponent(faucetUrl)}&code=${encodeURIComponent(shortCode)}`;
}

/** Builds the HTTPS fallback URI that redirects to the wallet deep link. */
export function buildFallbackUri(api: string, fullCode: string): string {
  return `${api}/api/qr/${fullCode}`;
}

const CLAIM_URI_PREFIXES = ['web+cardano://claim/v1', 'web+cardano:claim/v1'];

/**
 * Parses a CIP-99 claim URI, accepting both the slashed and slashless scheme forms
 * that wallets are seen to produce. The query string is parsed with URLSearchParams
 * after cutting at the first question mark, the WHATWG URL parser does not reliably
 * handle the slashless custom scheme.
 */
export function parseClaimUri(uri: string): { faucetUrl: string; code: string } | null {
  const qIndex = uri.indexOf('?');
  if (qIndex < 0) return null;
  const head = uri.slice(0, qIndex);
  if (!CLAIM_URI_PREFIXES.includes(head)) return null;
  const params = new URLSearchParams(uri.slice(qIndex + 1));
  const faucetUrl = params.get('faucet_url');
  const code = params.get('code');
  if (!faucetUrl || !code) return null;
  return { faucetUrl, code };
}
