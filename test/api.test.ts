import { describe, expect, it } from 'vitest';
import { startFakeApi, fakeKey } from './helpers/fake-api.js';
import { apiRequest, ApiError } from '../src/api.js';

const TOKEN = fakeKey('token');

describe('apiRequest', () => {
  it('sends the bearer token in the authorization header', async () => {
    const api = await startFakeApi({
      'GET /api/org/credits': req => ({ status: 200, body: { seen: req.headers.authorization } }),
    });
    try {
      const res = await apiRequest<{ seen: string }>({ api: api.url, token: TOKEN, method: 'GET', path: '/api/org/credits' });
      expect(res.body.seen).toBe(`Bearer ${TOKEN}`);
    } finally {
      await api.close();
    }
  });

  it('turns the error field of the response body into the message', async () => {
    const api = await startFakeApi({
      'GET /api/org/credits': () => ({ status: 401, body: { error: 'Invalid API key' } }),
    });
    try {
      const err = await apiRequest({ api: api.url, token: TOKEN, method: 'GET', path: '/api/org/credits' }).catch(e => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(401);
      expect(err.message).toBe('Invalid API key');
    } finally {
      await api.close();
    }
  });

  it('retries a 429 on GET and succeeds once the handler allows it through', async () => {
    let calls = 0;
    const api = await startFakeApi({
      'GET /api/org/credits': () => {
        calls += 1;
        return calls < 3 ? { status: 429, body: { error: 'slow down' } } : { status: 200, body: { ok: true } };
      },
    });
    try {
      const res = await apiRequest<{ ok: boolean }>({
        api: api.url, token: TOKEN, method: 'GET', path: '/api/org/credits', retryDelaysMs: [1, 1, 1],
      });
      expect(res.body).toEqual({ ok: true });
      expect(calls).toBe(3);
    } finally {
      await api.close();
    }
  });

  it('does not retry a 429 on POST', async () => {
    let calls = 0;
    const api = await startFakeApi({
      'POST /api/org/topup': () => { calls += 1; return { status: 429, body: { error: 'slow down' } }; },
    });
    try {
      const err = await apiRequest({
        api: api.url, token: TOKEN, method: 'POST', path: '/api/org/topup', retryDelaysMs: [1, 1, 1],
      }).catch(e => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(429);
      expect(calls).toBe(1);
    } finally {
      await api.close();
    }
  });

  it('maps a network error to ApiError with status 0', async () => {
    const api = await startFakeApi({});
    const deadUrl = api.url;
    await api.close();
    const err = await apiRequest({ api: deadUrl, token: TOKEN, method: 'GET', path: '/api/org/credits' }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe(`Could not reach ${deadUrl}`);
  });

  it('returns a status listed in allow instead of throwing', async () => {
    const api = await startFakeApi({
      'POST /api/org/campaign': () => ({ status: 409, body: { error: 'already exists' } }),
    });
    try {
      const res = await apiRequest({
        api: api.url, token: TOKEN, method: 'POST', path: '/api/org/campaign', allow: [409],
      });
      expect(res.status).toBe(409);
    } finally {
      await api.close();
    }
  });
});
