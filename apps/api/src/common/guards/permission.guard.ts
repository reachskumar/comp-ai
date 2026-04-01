import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../../database';

// ─── Types ──────────────────────────────────────────────────────

export type PermissionAction = 'view' | 'insert' | 'update' | 'delete';

export interface RequiredPermission {
  pageName: string;
  action: PermissionAction;
}

// ─── Decorator ──────────────────────────────────────────────────

export const PERMISSION_KEY = 'required_permission';

/**
 * Decorator to restrict an endpoint based on Compport page-level permissions.
 *
 * @example
 * ```ts
 * @RequirePermission('Write Back', 'update')
 * @UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
 * @Post('submit')
 * async submit() { ... }
 * ```
 *
 * The guard looks up the user's Compport role ID, finds the TenantRole,
 * then checks TenantRolePermission for the matching page + action.
 * PLATFORM_ADMIN always bypasses.
 */
export const RequirePermission = (pageName: string, action: PermissionAction) =>
  SetMetadata(PERMISSION_KEY, { pageName, action } as RequiredPermission);

// ─── Cache ──────────────────────────────────────────────────────

interface CachedPermissions {
  /** Map<pageName, { canView, canInsert, canUpdate, canDelete }> */
  pages: Map<
    string,
    { canView: boolean; canInsert: boolean; canUpdate: boolean; canDelete: boolean }
  >;
  fetchedAt: number;
}

/** Cache key: `tenantId:roleId` */
const permissionCache = new Map<string, CachedPermissions>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Guard ──────────────────────────────────────────────────────

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequirePermission() → allow all authenticated users
    if (!required) return true;

    const request = context.switchToHttp().getRequest<{
      user?: { userId?: string; tenantId?: string; role?: string };
    }>();

    const { userId, tenantId, role } = request.user ?? {};

    if (!role || !tenantId) {
      throw new ForbiddenException('Authentication context is required');
    }

    // PLATFORM_ADMIN bypasses all permission checks
    if (role === 'PLATFORM_ADMIN') return true;

    // Look up permissions (with cache)
    const permissions = await this.getPermissions(tenantId, role);

    // Graceful degradation: if no permissions synced yet, allow with warning
    if (!permissions || permissions.pages.size === 0) {
      this.logger.warn(
        `No permissions synced for tenant=${tenantId} role=${role} — allowing access (graceful degradation)`,
      );
      return true;
    }

    const pagePerms = permissions.pages.get(required.pageName);

    if (!pagePerms) {
      // Page not found in permissions — could be a CompportIQ-only page
      // Allow access with warning to avoid blocking features that don't exist in Compport
      this.logger.warn(
        `Page "${required.pageName}" not found in permissions for tenant=${tenantId} role=${role} — allowing access`,
      );
      return true;
    }

    const actionField =
      `can${required.action.charAt(0).toUpperCase()}${required.action.slice(1)}` as
        | 'canView'
        | 'canInsert'
        | 'canUpdate'
        | 'canDelete';
    const allowed = pagePerms[actionField];

    if (!allowed) {
      this.logger.warn(
        `Permission denied: user=${userId} role=${role} page="${required.pageName}" action=${required.action}`,
      );
      throw new ForbiddenException(
        `Access denied. You do not have ${required.action} permission for ${required.pageName}.`,
      );
    }

    return true;
  }

  private async getPermissions(
    tenantId: string,
    roleId: string,
  ): Promise<CachedPermissions | null> {
    const cacheKey = `${tenantId}:${roleId}`;
    const cached = permissionCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached;
    }

    // Find the TenantRole for this Compport role ID
    const tenantRole = await this.db.forTenant(tenantId, (tx) =>
      tx.tenantRole.findFirst({
        where: { tenantId, compportRoleId: roleId, isActive: true },
        select: { id: true },
      }),
    );

    if (!tenantRole) return null;

    // Load all permissions for this role with page names
    const perms = await this.db.forTenant(tenantId, (tx) =>
      tx.tenantRolePermission.findMany({
        where: { tenantId, roleId: tenantRole.id },
        include: { page: { select: { name: true } } },
      }),
    );

    const pages = new Map<
      string,
      { canView: boolean; canInsert: boolean; canUpdate: boolean; canDelete: boolean }
    >();
    for (const p of perms) {
      pages.set(p.page.name, {
        canView: p.canView,
        canInsert: p.canInsert,
        canUpdate: p.canUpdate,
        canDelete: p.canDelete,
      });
    }

    const entry: CachedPermissions = { pages, fetchedAt: Date.now() };
    permissionCache.set(cacheKey, entry);
    return entry;
  }
}

/** Clear the permission cache (useful after sync or in tests). */
export function clearPermissionCache(): void {
  permissionCache.clear();
}
