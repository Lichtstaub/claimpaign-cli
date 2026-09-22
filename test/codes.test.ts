import { describe, expect, it } from 'vitest';
import { normalizeShortCode, splitFullCode, buildClaimUri, buildFallbackUri, parseClaimUri } from '../src/codes.js';

describe('normalizeShortCode', () => {
  it('uppercases Crockford codes and folds O, I and L', () => {
    expect(normalizeShortCode('7k3mq9xz4h')).toBe('7K3MQ9XZ4H');
    expect(normalizeShortCode(' 7K3MQ9XZ4H ')).toBe('7K3MQ9XZ4H');
    expect(normalizeShortCode('OK3MQ9XZ4l')).toBe('0K3MQ9XZ41');
    expect(normalizeShortCode('IK3MQ9XZ4H')).toBe('1K3MQ9XZ4H');
  });

  it('keeps legacy hex codes lowercase', () => {
    expect(normalizeShortCode('A3BF9C12')).toBe('a3bf9c12');
    expect(normalizeShortCode('a3bf9c')).toBe('a3bf9c');
  });

  it('rejects anything that cannot be a code', () => {
    expect(normalizeShortCode('7K3MQ9XZ4U')).toBeNull(); // U is not in the alphabet
    expect(normalizeShortCode('7K3MQ9XZ')).toBeNull(); // 8 chars but not hex
    expect(normalizeShortCode('zz')).toBeNull();
    expect(normalizeShortCode('')).toBeNull();
    expect(normalizeShortCode("7K3MQ9XZ4H' OR 1=1")).toBeNull();
  });
});

describe('splitFullCode', () => {
  it('splits a Crockford full code on the underscore', () => {
    expect(splitFullCode('HACK_7K3MQ9XZ4H')).toEqual({ prefix: 'HACK', shortCode: '7K3MQ9XZ4H' });
  });

  it('splits a legacy hex full code on the underscore', () => {
    expect(splitFullCode('HACK_ab12cd34')).toEqual({ prefix: 'HACK', shortCode: 'ab12cd34' });
  });

  it('returns null when there is no underscore', () => {
    expect(splitFullCode('NOUNDERSCORE')).toBeNull();
  });

  it('splits at the last underscore when the prefix itself has one', () => {
    expect(splitFullCode('MY_HACK_7K3MQ9XZ4H')).toEqual({ prefix: 'MY_HACK', shortCode: '7K3MQ9XZ4H' });
  });

  it('returns null when a part would be empty', () => {
    expect(splitFullCode('_7K3MQ9XZ4H')).toBeNull();
    expect(splitFullCode('HACK_')).toBeNull();
  });
});

describe('buildClaimUri', () => {
  it('builds the exact CIP-99 URI the server produces', () => {
    const uri = buildClaimUri('https://claimpaign.com', 'SUMMIT', '7K3MQ9XZ4H');
    expect(uri).toBe(
      'web+cardano://claim/v1?faucet_url=https%3A%2F%2Fclaimpaign.com%2Fapi%2Fclaim%2FSUMMIT&code=7K3MQ9XZ4H',
    );
  });

  it('still builds URIs for legacy hex codes', () => {
    expect(buildClaimUri('https://claimpaign.com', 'SUMMIT', 'a3bf9c12')).toContain('code=a3bf9c12');
  });
});

describe('buildFallbackUri', () => {
  it('builds the exact fallback URI the server produces', () => {
    expect(buildFallbackUri('https://claimpaign.com', 'SUMMIT_7K3MQ9XZ4H')).toBe(
      'https://claimpaign.com/api/qr/SUMMIT_7K3MQ9XZ4H',
    );
  });
});

describe('parseClaimUri', () => {
  it('parses the tUSDM claim uri', () => {
    const uri =
      'web+cardano://claim/v1?faucet_url=https%3A%2F%2Fbeta.onbd.io%2Fapi%2Fclaim%2Fv1%2F01ksj7qeeg0kbh5s64ds2x9yya&code=01KSJ8PW11CPCG40G7S7TVKXZ9';
    expect(parseClaimUri(uri)).toEqual({
      faucetUrl: 'https://beta.onbd.io/api/claim/v1/01ksj7qeeg0kbh5s64ds2x9yya',
      code: '01KSJ8PW11CPCG40G7S7TVKXZ9',
    });
  });

  it('parses a Claimpaign uri built by buildClaimUri', () => {
    const uri = buildClaimUri('https://claimpaign.com', 'SUMMIT', '7K3MQ9XZ4H');
    expect(parseClaimUri(uri)).toEqual({
      faucetUrl: 'https://claimpaign.com/api/claim/SUMMIT',
      code: '7K3MQ9XZ4H',
    });
  });

  it('parses the slashless scheme form', () => {
    const uri = 'web+cardano:claim/v1?faucet_url=https%3A%2F%2Fclaimpaign.com%2Fapi%2Fclaim%2FSUMMIT&code=7K3MQ9XZ4H';
    expect(parseClaimUri(uri)).toEqual({
      faucetUrl: 'https://claimpaign.com/api/claim/SUMMIT',
      code: '7K3MQ9XZ4H',
    });
  });

  it('returns null for an unrelated uri', () => {
    expect(parseClaimUri('https://example.com?faucet_url=x&code=y')).toBeNull();
  });

  it('returns null for the claim scheme without a query', () => {
    expect(parseClaimUri('web+cardano://claim/v1')).toBeNull();
  });

  it('returns null when faucet_url or code is missing', () => {
    expect(parseClaimUri('web+cardano://claim/v1?code=7K3MQ9XZ4H')).toBeNull();
    expect(parseClaimUri('web+cardano://claim/v1?faucet_url=https%3A%2F%2Fx.com')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseClaimUri('not a uri at all')).toBeNull();
    expect(parseClaimUri('')).toBeNull();
  });
});
