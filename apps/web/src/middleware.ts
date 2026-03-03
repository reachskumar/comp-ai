import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Hostnames to skip subdomain extraction for */
const SKIP_SUBDOMAINS = new Set(['app', 'www', 'localhost', '127']);

/**
 * Extract subdomain from hostname.
 * "standardbank.compportiq.ai" → "standardbank"
 * "app.compportiq.ai" → null (skipped)
 * "localhost:3000" → null
 */
function extractSubdomain(hostname: string): string | null {
  // Remove port
  const host = hostname.split(':')[0] || '';

  // Skip IP addresses
  if (/^[0-9.]+$/.test(host)) return null;

  const parts = host.split('.');
  if (parts.length < 3) return null; // e.g., "compportiq.ai" or "localhost"

  const subdomain = parts[0]!;
  if (SKIP_SUBDOMAINS.has(subdomain)) return null;

  return subdomain;
}

/**
 * Next.js middleware for:
 * 1. Subdomain-based tenant detection (sets x-tenant-slug header)
 * 2. Auth route protection (redirects unauthenticated users to /login)
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // ─── Subdomain Detection ────────────────────────────────
  const hostname = request.headers.get('host') || '';
  const subdomain = extractSubdomain(hostname);
  if (subdomain) {
    response.headers.set('x-tenant-slug', subdomain);
  }

  // ─── Auth Check (dashboard routes only) ─────────────────
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('accessToken')?.value;
    if (!token) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
};
