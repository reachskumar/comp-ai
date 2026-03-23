/**
 * Shared CSRF token helper for hooks that bypass apiClient (e.g. SSE streaming).
 *
 * The apiClient handles CSRF internally, but streaming hooks use raw fetch()
 * and need to include the CSRF token + credentials manually.
 */

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';

let cachedToken: string | null = null;

/** Fetch a fresh CSRF token from the API. */
async function fetchCsrfToken(): Promise<string | null> {
  const accessToken = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (!accessToken) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/csrf/token`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { csrfToken: string };
    cachedToken = data.csrfToken;
    return cachedToken;
  } catch {
    return null;
  }
}

/** Get a cached CSRF token, or fetch a new one. */
export async function getCsrfToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  return fetchCsrfToken();
}

/** Clear the cached token (call on logout or 403). */
export function clearCsrfToken(): void {
  cachedToken = null;
}
