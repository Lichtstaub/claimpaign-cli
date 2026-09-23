import { createServer, type IncomingMessage, type Server } from 'node:http';

export interface FakeReq { method: string; path: string; headers: Record<string, string>; body: any; url: URL }
export type Handler = (req: FakeReq) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

export async function startFakeApi(handlers: Record<string, Handler>) {
  const calls: FakeReq[] = [];
  const errors: Error[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    // Every path answers, a throwing handler becomes a 500 and is kept for the test
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url || '/', 'http://fake');
      const fake: FakeReq = { method: req.method || 'GET', path: url.pathname, headers: req.headers as Record<string, string>, body: raw ? JSON.parse(raw) : undefined, url };
      calls.push(fake);
      // exact "METHOD /path" first, then a prefix match like "GET /api/admin/campaign/"
      const key = `${fake.method} ${fake.path}`;
      const handler = handlers[key] ?? Object.entries(handlers).find(([k]) => key.startsWith(k))?.[1];
      if (!handler) return send(404, { error: `no fake handler for ${key}` });
      const out = await handler(fake);
      send(out.status, out.body);
    } catch (err) {
      errors.push(err as Error);
      send(500, { error: `fake handler failed: ${(err as Error).message}` });
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, calls, errors, close: () => new Promise<void>(r => server.close(() => r())) };
}

export function fakeKey(label: string): string {
  return 'cps_' + (label + 'x'.repeat(40)).slice(0, 40).replace(/[^a-z2-9]/g, 'x');
}

/** A handler that returns body for the given bearer token, and a 401 with the standard invalid key error otherwise. */
export function authGuarded(token: string, body: unknown): Handler {
  return req => req.headers.authorization === `Bearer ${token}`
    ? { status: 200, body }
    : { status: 401, body: { error: 'Invalid API key' } };
}
