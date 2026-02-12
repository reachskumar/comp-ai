import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Rate limiting guard for bridge endpoints.
 * SECURITY: 100 requests per minute per tenant to prevent abuse.
 * Uses in-memory store (production should use Redis for distributed rate limiting).
 */
@Injectable()
export class BridgeRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(BridgeRateLimitGuard.name);
  private readonly limits = new Map<string, RateLimitEntry>();
  private readonly MAX_REQUESTS = 100;
  private readonly WINDOW_MS = 60 * 1000; // 1 minute

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { tenantId?: string };
    }>();

    const tenantId = request.user?.tenantId ?? 'anonymous';
    const key = `bridge:${tenantId}`;
    const now = Date.now();

    let entry = this.limits.get(key);

    if (!entry || now - entry.windowStart > this.WINDOW_MS) {
      entry = { count: 1, windowStart: now };
      this.limits.set(key, entry);
      return true;
    }

    entry.count++;

    if (entry.count > this.MAX_REQUESTS) {
      this.logger.warn(`Rate limit exceeded for tenant: ${tenantId}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded. Maximum 100 requests per minute.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

