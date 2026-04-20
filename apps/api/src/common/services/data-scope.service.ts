import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';
import { Prisma } from '@compensation/database';

// ─── Types ──────────────────────────────────────────────────

export type ScopeTier = 'FULL' | 'MANAGER' | 'SELF';

export interface DataScope {
  tier: ScopeTier;
  /** Spread into any Prisma employee query's `where` clause */
  employeeFilter: Prisma.EmployeeWhereInput;
  /** Set for MANAGER/SELF tiers — the specific employee IDs visible */
  visibleEmployeeIds?: string[];
}

// ─── Cache ──────────────────────────────────────────────────

interface CachedScope {
  scope: DataScope;
  fetchedAt: number;
}

interface CachedChain {
  ids: string[];
  fetchedAt: number;
}

const scopeCache = new Map<string, CachedScope>();
const chainCache = new Map<string, CachedChain>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Threshold: roles with ≥ this many viewable pages are considered broad-access */
const BROAD_ACCESS_PAGE_THRESHOLD = 5;

// ─── Service ────────────────────────────────────────────────

@Injectable()
export class DataScopeService {
  private readonly logger = new Logger(DataScopeService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Resolve the data scope for a user within a tenant.
   *
   * Returns a Prisma `EmployeeWhereInput` that consuming services
   * can spread into their queries to enforce row-level visibility.
   */
  async resolveScope(tenantId: string, userId: string, role: string): Promise<DataScope> {
    // PLATFORM_ADMIN and ADMIN always get full access
    if (role === 'PLATFORM_ADMIN' || role === 'ADMIN') {
      return { tier: 'FULL', employeeFilter: { tenantId } };
    }

    // Check cache
    const cacheKey = `${tenantId}:${userId}`;
    const cached = scopeCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.scope;
    }

    // Check if role has broad permissions (≥ N pages with canView)
    const hasBroadAccess = await this.checkBroadAccess(tenantId, role);
    if (hasBroadAccess) {
      const scope: DataScope = { tier: 'FULL', employeeFilter: { tenantId } };
      scopeCache.set(cacheKey, { scope, fetchedAt: Date.now() });
      return scope;
    }

    // Find the user's linked employee
    const user = await this.db.forTenant(tenantId, (tx) =>
      tx.user.findUnique({
        where: { id: userId },
        select: { employeeId: true },
      }),
    );

    if (!user?.employeeId) {
      // No linked employee — SELF scope with no visible employees
      this.logger.warn(`User ${userId} has no linked employee — SELF scope (empty)`);
      const scope: DataScope = {
        tier: 'SELF',
        employeeFilter: { tenantId, id: '__none__' },
        visibleEmployeeIds: [],
      };
      scopeCache.set(cacheKey, { scope, fetchedAt: Date.now() });
      return scope;
    }

    // Check if user is a manager (has direct reports)
    const directReportCount = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.count({ where: { tenantId, managerId: user.employeeId! } }),
    );

    if (directReportCount > 0) {
      // MANAGER tier: collect full reporting chain
      const reportIds = await this.getReportingChain(tenantId, user.employeeId);
      const visibleIds = [user.employeeId, ...reportIds];
      const scope: DataScope = {
        tier: 'MANAGER',
        employeeFilter: { tenantId, id: { in: visibleIds } },
        visibleEmployeeIds: visibleIds,
      };
      scopeCache.set(cacheKey, { scope, fetchedAt: Date.now() });
      return scope;
    }

    // SELF tier: can only see own record
    const scope: DataScope = {
      tier: 'SELF',
      employeeFilter: { tenantId, id: user.employeeId },
      visibleEmployeeIds: [user.employeeId],
    };
    scopeCache.set(cacheKey, { scope, fetchedAt: Date.now() });
    return scope;
  }

  /**
   * Recursively collect all direct + indirect report employee IDs.
   * Uses BFS with a depth limit to prevent infinite loops.
   */
  async getReportingChain(tenantId: string, employeeId: string): Promise<string[]> {
    const cacheKey = `${tenantId}:${employeeId}`;
    const cached = chainCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.ids;
    }

    const allReportIds: string[] = [];
    const queue: string[] = [employeeId];
    const visited = new Set<string>([employeeId]);
    const MAX_DEPTH = 10;
    let depth = 0;

    while (queue.length > 0 && depth < MAX_DEPTH) {
      const currentBatch = [...queue];
      queue.length = 0;
      depth++;

      const directReports = await this.db.forTenant(tenantId, (tx) =>
        tx.employee.findMany({
          where: { tenantId, managerId: { in: currentBatch } },
          select: { id: true },
        }),
      );

      for (const r of directReports) {
        if (!visited.has(r.id)) {
          visited.add(r.id);
          allReportIds.push(r.id);
          queue.push(r.id);
        }
      }
    }

    chainCache.set(cacheKey, { ids: allReportIds, fetchedAt: Date.now() });
    return allReportIds;
  }

  /**
   * Check if a Compport role has broad access (many viewable pages).
   * Roles like "HR Admin" typically have access to most/all pages.
   */
  private async checkBroadAccess(tenantId: string, compportRoleId: string): Promise<boolean> {
    const tenantRole = await this.db.forTenant(tenantId, (tx) =>
      tx.tenantRole.findFirst({
        where: { tenantId, compportRoleId, isActive: true },
        select: { id: true },
      }),
    );

    if (!tenantRole) {
      // Role not synced yet — treat as not broad (graceful degradation)
      return false;
    }

    const viewablePageCount = await this.db.forTenant(tenantId, (tx) =>
      tx.tenantRolePermission.count({
        where: { tenantId, roleId: tenantRole.id, canView: true },
      }),
    );

    return viewablePageCount >= BROAD_ACCESS_PAGE_THRESHOLD;
  }
}

/** Clear the data scope cache (useful after sync or in tests). */
export function clearDataScopeCache(): void {
  scopeCache.clear();
  chainCache.clear();
}
