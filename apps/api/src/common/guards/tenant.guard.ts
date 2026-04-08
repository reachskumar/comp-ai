import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database';

/** In-memory cache for tenant status to avoid DB hit on every request */
const tenantCache = new Map<string, { isActive: boolean; expiresAt: number }>();
const CACHE_TTL = 60_000; // 60 seconds

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { tenantId?: string } }>();
    const tenantId = request.user?.tenantId;

    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required');
    }

    // Check cache first
    const cached = tenantCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.isActive) {
        throw new ForbiddenException('Tenant is suspended. Please contact your administrator.');
      }
      return true;
    }

    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, isActive: true },
    });

    if (!tenant) {
      this.logger.warn(`Tenant not found: ${tenantId}`);
      throw new ForbiddenException('Tenant not found or inactive');
    }

    // Cache the result
    tenantCache.set(tenantId, { isActive: tenant.isActive, expiresAt: Date.now() + CACHE_TTL });

    // Evict old entries periodically (prevent memory leak)
    if (tenantCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of tenantCache) {
        if (v.expiresAt < now) tenantCache.delete(k);
      }
    }

    if (!tenant.isActive) {
      throw new ForbiddenException('Tenant is suspended. Please contact your administrator.');
    }

    return true;
  }
}
