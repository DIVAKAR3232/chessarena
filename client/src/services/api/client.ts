import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import type { PageMeta } from '../../types/api';

/**
 * All REST calls go to the relative path /api/v1 — proxied by Vite in development and by a
 * Vercel rewrite in production — so auth cookies are first-party (see docs/SECURITY.md).
 */
export const http = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get fieldIssues(): FieldIssue[] {
    return Array.isArray(this.details) ? (this.details as FieldIssue[]) : [];
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let csrfPromise: Promise<string> | null = null;

async function ensureCsrf(force = false): Promise<string> {
  const existing = readCookie('csrf_token');
  if (existing && !force) return existing;
  csrfPromise ??= axios
    .get<{ data: { csrfToken: string } }>('/api/v1/auth/csrf', { withCredentials: true })
    .then((r) => r.data.data.csrfToken)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

http.interceptors.request.use(async (config) => {
  const method = (config.method ?? 'get').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    config.headers.set('X-CSRF-Token', await ensureCsrf());
  }
  return config;
});

let refreshPromise: Promise<boolean> | null = null;

/** Rotates the refresh token once for all concurrent 401s. */
export function refreshSession(): Promise<boolean> {
  refreshPromise ??= ensureCsrf()
    .then((csrf) =>
      axios.post('/api/v1/auth/refresh', null, { withCredentials: true, headers: { 'X-CSRF-Token': csrf } }),
    )
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

type RetriableConfig = AxiosRequestConfig & { _retried?: boolean };

const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/csrf'];

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<{ error?: { code: string; message: string; details?: unknown } }>) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status ?? 0;
    const body = error.response?.data?.error;

    if (config && !config._retried) {
      // Access token expired: refresh once and replay.
      if (status === 401 && !NO_REFRESH.some((p) => config.url?.startsWith(p))) {
        config._retried = true;
        if (await refreshSession()) return http(config);
      }
      // CSRF cookie missing/rotated: fetch a fresh one and replay.
      if (status === 403 && body?.code === 'CSRF_INVALID') {
        config._retried = true;
        await ensureCsrf(true);
        return http(config);
      }
    }
    if (!error.response) throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
    throw new ApiError(status, body?.code ?? 'ERROR', body?.message ?? 'Something went wrong', body?.details);
  },
);

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong';

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const r = await http.get<{ data: T }>(url, { params });
  return r.data.data;
}

export async function getPaged<T>(url: string, params?: Record<string, unknown>) {
  const r = await http.get<{ data: T[]; meta: PageMeta & Record<string, unknown> }>(url, {
    params,
  });
  return r.data;
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await http.post<{ data: T }>(url, body ?? {});
  return r.data.data;
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const r = await http.patch<{ data: T }>(url, body ?? {});
  return r.data.data;
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const r = await http.put<{ data: T }>(url, body ?? {});
  return r.data.data;
}

export async function del<T>(url: string, body?: unknown): Promise<T> {
  const r = await http.delete<{ data: T }>(url, { data: body });
  return r.data.data;
}
