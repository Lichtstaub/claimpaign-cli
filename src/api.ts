import { resolveToken } from './config.js';
import { UsageError } from './output.js';

export interface ApiRequestOptions {
  api: string;
  token?: string;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  allow?: number[];
  retryDelaysMs?: number[];
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

/** Thrown for any HTTP status of 400 or above that the caller did not `allow`, and for network failures (status 0). */
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_RETRY_DELAYS_MS = [2000, 4000, 8000];
const RETRYABLE_METHODS = new Set(['GET', 'PATCH']);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function messageFromBody(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.status === 'string') return record.status;
  }
  return `HTTP ${status}`;
}

/**
 * Call the Claimpaign sandbox API. Retries a 429 for GET and PATCH requests using
 * `retryDelaysMs` (default 2s, 4s, 8s), up to as many retries as the array has entries.
 * A status of 400 or above becomes an `ApiError`, unless it is listed in `allow`, in which
 * case the response is returned like any success. A network failure becomes `ApiError(0, ...)`.
 */
export async function apiRequest<T = unknown>(options: ApiRequestOptions): Promise<ApiResponse<T>> {
  const { api, token, method, path, body, headers, allow = [], retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = options;
  const url = `${api}${path}`;
  const requestHeaders: Record<string, string> = { ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const canRetry = RETRYABLE_METHODS.has(method.toUpperCase());

  let attempt = 0;
  for (;;) {
    let status: number;
    let parsedBody: unknown;
    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      status = response.status;
      const text = await response.text();
      try {
        parsedBody = text ? JSON.parse(text) : undefined;
      } catch {
        parsedBody = text;
      }
    } catch {
      throw new ApiError(0, `Could not reach ${api}`);
    }

    if (status === 429 && canRetry && attempt < retryDelaysMs.length) {
      await sleep(retryDelaysMs[attempt]);
      attempt += 1;
      continue;
    }

    if (status >= 400 && !allow.includes(status)) {
      throw new ApiError(status, messageFromBody(parsedBody, status), parsedBody);
    }

    return { status, body: parsedBody as T };
  }
}

export function requireToken(): string {
  const token = resolveToken();
  if (!token) throw new UsageError('Not logged in. Run: claimpaign login');
  return token;
}
