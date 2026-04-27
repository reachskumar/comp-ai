const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';

/** HTTP methods that mutate state and require CSRF protection. */
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface ApiError {
  message: string;
  statusCode: number;
}

class ApiClient {
  private csrfToken: string | null = null;

  private getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('accessToken');
  }

  private getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('refreshToken');
  }

  private setTokens(accessToken: string, refreshToken: string) {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  }

  clearTokens() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    this.csrfToken = null;
  }

  /** Fetch a CSRF token from the API (requires authentication). */
  private async fetchCsrfToken(): Promise<string | null> {
    const token = this.getToken();
    if (!token) return null;

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/csrf/token`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      this.csrfToken = data.csrfToken;
      return this.csrfToken;
    } catch {
      return null;
    }
  }

  /** Get a cached CSRF token, or fetch a new one. */
  private async getCsrfToken(): Promise<string | null> {
    if (this.csrfToken) return this.csrfToken;
    return this.fetchCsrfToken();
  }

  private async refreshAccessToken(): Promise<boolean> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${path}`;
    const token = this.getToken();

    const headers: Record<string, string> = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // CSRF tokens are only needed for cookie-based auth (no Bearer token).
    // The backend CsrfGuard skips validation when a Bearer token is present,
    // so we skip the extra network roundtrip when authenticated.
    const method = (options.method || 'GET').toUpperCase();
    if (MUTATION_METHODS.has(method) && !token) {
      const csrf = await this.getCsrfToken();
      if (csrf) {
        headers['x-csrf-token'] = csrf;
      }
    }

    let res = await fetch(url, { ...options, headers, credentials: 'include' });

    // If 401, try refreshing the token
    if (res.status === 401 && token) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        const newToken = this.getToken();
        headers['Authorization'] = `Bearer ${newToken}`;
        res = await fetch(url, { ...options, headers, credentials: 'include' });
      } else {
        this.clearTokens();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        throw new Error('Session expired. Please log in again.');
      }
    }

    // Handle tenant suspension
    if (res.status === 403) {
      const errorData = (await res.json().catch(() => ({}))) as Partial<ApiError>;
      if (errorData.message?.includes('suspended')) {
        this.clearTokens();
        if (typeof window !== 'undefined') {
          window.location.href = '/suspended';
        }
        throw new Error('Tenant is suspended.');
      }
      throw new Error(errorData.message || 'Forbidden');
    }

    if (!res.ok) {
      const errorData = (await res.json().catch(() => ({}))) as Partial<ApiError>;
      throw new Error(errorData.message || `Request failed with status ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Download a binary response (e.g. a PDF). Honors token refresh and the same
   * 401/403 handling as `fetch()`. Returns the blob plus the server-provided
   * filename if any (parsed from Content-Disposition).
   */
  async fetchBlob(path: string): Promise<{ blob: Blob; fileName: string | null }> {
    const url = `${API_BASE_URL}${path}`;
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res = await fetch(url, { headers, credentials: 'include' });
    if (res.status === 401 && token) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        const newToken = this.getToken();
        if (newToken) headers['Authorization'] = `Bearer ${newToken}`;
        res = await fetch(url, { headers, credentials: 'include' });
      } else {
        this.clearTokens();
        if (typeof window !== 'undefined') window.location.href = '/login';
        throw new Error('Session expired. Please log in again.');
      }
    }
    if (!res.ok) {
      const errorData = (await res.json().catch(() => ({}))) as Partial<ApiError>;
      throw new Error(errorData.message || `Download failed with status ${res.status}`);
    }
    const cd = res.headers.get('Content-Disposition') ?? '';
    const match = cd.match(/filename="?([^"]+)"?/);
    const fileName = match?.[1] ?? null;
    return { blob: await res.blob(), fileName };
  }

  // Auth endpoints
  async login(email: string, password: string, tenantSlug?: string) {
    // Detect tenant from subdomain if not provided
    const slug =
      tenantSlug ??
      (typeof window !== 'undefined' ? window.location.hostname.split('.')[0] : undefined);
    // Only send tenantSlug if it looks like a real subdomain (not "compportiq", "localhost", etc.)
    const isSubdomain = slug && !['compportiq', 'localhost', 'www', 'app'].includes(slug);

    const result = await this.fetch<{
      accessToken: string;
      refreshToken: string;
      user: { id: string; email: string; name: string; role: string };
      tenant?: {
        id: string;
        name: string;
        slug: string;
        settings?: Record<string, unknown>;
      } | null;
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(isSubdomain ? { tenantSlug: slug } : {}) }),
    });
    // Fetch CSRF token now that we're authenticated
    await this.fetchCsrfToken();
    return result;
  }

  async register(data: { email: string; password: string; name: string; tenantName: string }) {
    const result = await this.fetch<{
      accessToken: string;
      refreshToken: string;
      user: { id: string; email: string; name: string; role: string };
      tenant: { id: string; name: string; slug: string };
    }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    // Fetch CSRF token now that we're authenticated
    await this.fetchCsrfToken();
    return result;
  }

  /**
   * Resolve tenant branding from hostname (public, no auth required).
   */
  async getTenantBranding(domain: string) {
    return this.fetch<{
      found: boolean;
      name?: string;
      slug?: string;
      logoUrl?: string | null;
      primaryColor?: string | null;
      azureAdEnabled?: boolean;
    }>(`/api/v1/auth/tenant-branding?domain=${encodeURIComponent(domain)}`);
  }

  async getMe() {
    return this.fetch<{ userId: string; tenantId: string; email: string; role: string }>(
      '/api/v1/auth/me',
    );
  }

  // Settings endpoints
  async getTenantInfo() {
    return this.fetch<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      settings: Record<string, unknown> | null;
      createdAt: string;
      updatedAt: string;
      _count: { users: number; employees: number };
    }>('/api/v1/settings/tenant');
  }

  async updateLetterSignature(data: { name?: string; title?: string }) {
    return this.fetch<{ letterSignature: { name: string; title: string } }>(
      '/api/v1/settings/letter-signature',
      {
        method: 'PUT',
        body: JSON.stringify(data),
      },
    );
  }

  async listUsers() {
    return this.fetch<{
      data: Array<{
        id: string;
        email: string;
        name: string;
        role: string;
        avatarUrl: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
      total: number;
    }>('/api/v1/settings/users');
  }

  async listAuditLogs(params?: {
    page?: number;
    limit?: number;
    action?: string;
    userId?: string;
    entityType?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.action) searchParams.set('action', params.action);
    if (params?.userId) searchParams.set('userId', params.userId);
    if (params?.entityType) searchParams.set('entityType', params.entityType);
    const qs = searchParams.toString();
    return this.fetch<{
      data: Array<{
        id: string;
        tenantId: string;
        userId: string | null;
        action: string;
        entityType: string;
        entityId: string;
        changes: Record<string, unknown>;
        ipAddress: string | null;
        createdAt: string;
        user: { id: string; name: string; email: string } | null;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/api/v1/settings/audit-logs${qs ? `?${qs}` : ''}`);
  }
  // ─── Platform Admin endpoints ──────────────────────────

  async adminListTenants(params?: { page?: number; limit?: number; search?: string }) {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.search) sp.set('search', params.search);
    const qs = sp.toString();
    return this.fetch<{
      data: Array<{
        id: string;
        name: string;
        slug: string;
        subdomain: string | null;
        customDomain: string | null;
        logoUrl: string | null;
        primaryColor: string | null;
        isActive: boolean;
        plan: string;
        compportSchema: string | null;
        createdAt: string;
        updatedAt: string;
        _count: { users: number; employees: number };
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/api/v1/platform-admin/tenants${qs ? `?${qs}` : ''}`);
  }

  async adminGetTenant(id: string) {
    return this.fetch<Record<string, unknown>>(`/api/v1/platform-admin/tenants/${id}`);
  }

  async adminGetTenantOverview(id: string) {
    return this.fetch<{
      tenant: {
        id: string;
        name: string;
        slug: string;
        isActive: boolean;
        plan: string;
        compportSchema: string | null;
      };
      counts: { users: number; employees: number };
      syncedEntities: { roles: number; pages: number; permissions: number };
      roleDistribution: { compportRoleId: string; name: string; userCount: number }[];
      lastSync: Record<string, unknown> | null;
    }>(`/api/v1/platform-admin/tenants/${id}/overview`);
  }

  async adminGetTenantRoles(id: string) {
    const res = await this.fetch<{
      tenantId: string;
      roles: {
        compportRoleId: string;
        name: string;
        module: string;
        isActive: boolean;
        userCount: number;
      }[];
      total: number;
    }>(`/api/v1/platform-admin/tenants/${id}/roles`);
    // Backend wraps in { tenantId, roles, total } – unwrap for consumers
    return res.roles ?? [];
  }

  async adminGetTenantPermissions(id: string) {
    return this.fetch<{
      tenantId: string;
      roles: Array<{
        compportRoleId: string;
        roleName: string;
        pages: Array<{
          pageName: string;
          canView: boolean;
          canInsert: boolean;
          canUpdate: boolean;
          canDelete: boolean;
        }>;
      }>;
      totalPermissions: number;
    }>(`/api/v1/platform-admin/tenants/${id}/permissions`);
  }

  async adminCreateTenant(data: {
    name: string;
    slug?: string;
    subdomain?: string;
    plan?: string;
    compportSchema?: string;
  }) {
    return this.fetch<Record<string, unknown>>('/api/v1/platform-admin/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async adminUpdateTenant(id: string, data: Record<string, unknown>) {
    return this.fetch<Record<string, unknown>>(`/api/v1/platform-admin/tenants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async adminSuspendTenant(id: string) {
    return this.fetch<Record<string, unknown>>(`/api/v1/platform-admin/tenants/${id}/suspend`, {
      method: 'POST',
    });
  }

  async adminActivateTenant(id: string) {
    return this.fetch<Record<string, unknown>>(`/api/v1/platform-admin/tenants/${id}/activate`, {
      method: 'POST',
    });
  }

  async adminDeleteTenant(id: string) {
    return this.fetch<{ deleted: boolean; id: string; name: string }>(
      `/api/v1/platform-admin/tenants/${id}`,
      { method: 'DELETE' },
    );
  }

  async adminListTenantUsers(tenantId: string) {
    return this.fetch<{
      data: Array<{
        id: string;
        email: string;
        name: string;
        role: string;
        avatarUrl: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
      total: number;
    }>(`/api/v1/platform-admin/tenants/${tenantId}/users`);
  }

  async adminCreateTenantUser(
    tenantId: string,
    data: { email: string; name: string; role?: string; password?: string },
  ) {
    return this.fetch<{ user: Record<string, unknown>; inviteLink: string }>(
      `/api/v1/platform-admin/tenants/${tenantId}/users`,
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  async adminRemoveTenantUser(tenantId: string, userId: string) {
    return this.fetch<{ deleted: boolean }>(
      `/api/v1/platform-admin/tenants/${tenantId}/users/${userId}`,
      { method: 'DELETE' },
    );
  }

  async adminListCompportTenants() {
    return this.fetch<{
      tenants: Array<{
        schemaName: string;
        companyName: string;
        status: string;
        createdAt: string | null;
        employeeCount: number | null;
      }>;
      count: number;
    }>('/api/v1/platform-admin/compport-tenants');
  }

  async adminOnboard(data: {
    companyName: string;
    compportSchema: string;
    subdomain?: string;
    adminEmail?: string;
    adminName?: string;
    adminPassword?: string;
    adminRole?: string;
    enabledFeatures?: string[];
  }) {
    return this.fetch<Record<string, unknown>>('/api/v1/platform-admin/onboard', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async adminGetStats() {
    return this.fetch<{
      totalTenants: number;
      activeTenants: number;
      suspendedTenants: number;
      totalUsers: number;
      totalEmployees: number;
    }>('/api/v1/platform-admin/stats');
  }

  async adminSyncTenantRoles(id: string) {
    return this.fetch<{
      tenantId: string;
      tenantName: string;
      compportSchema: string;
      result: {
        roles: { synced: number; errors: number };
        pages: { synced: number; errors: number };
        permissions: { synced: number; errors: number };
        users: { synced: number; linked: number; errors: number };
        durationMs: number;
      };
    }>(`/api/v1/platform-admin/tenants/${id}/sync-roles`, { method: 'POST' });
  }

  async adminSyncTenantFull(id: string) {
    // Fire-and-forget. Returns a jobId immediately; the UI polls
    // adminGetSyncJob() to track progress. Avoids long-running HTTP requests
    // that hit Cloud Run's 900s timeout or get killed by browser buffering.
    return this.fetch<{ jobId: string; status: string }>(
      `/api/v1/platform-admin/tenants/${id}/sync-full`,
      { method: 'POST' },
    );
  }

  async adminGetSyncJob(tenantId: string, jobId: string) {
    return this.fetch<{
      id: string;
      status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
      entityType: string;
      totalRecords: number;
      processedRecords: number;
      failedRecords: number;
      startedAt: string | null;
      completedAt: string | null;
      errorMessage: string | null;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>(`/api/v1/platform-admin/tenants/${tenantId}/sync-jobs/${jobId}`);
  }

  async adminAuditTenantData(id: string) {
    return this.fetch<{
      tenantId: string;
      tenantName: string;
      compportSchema: string | null;
      totalTables: number;
      totalRowsInSchema: number;
      tables: Array<{
        name: string;
        rowCount: number;
        isSynced: boolean;
        syncedTo: string | null;
        syncedCount: number | null;
        coveragePercent: number | null;
      }>;
      coverage: {
        employees: { source: number; synced: number; percent: number };
        users: { source: number; synced: number; percent: number };
        roles: { source: number; synced: number; percent: number };
        pages: { source: number; synced: number; percent: number };
        permissions: { source: number; synced: number; percent: number };
      };
    }>(`/api/v1/platform-admin/tenants/${id}/data-audit`);
  }

  async adminTestTenantConnection(id: string) {
    return this.fetch<{
      ok: boolean;
      durationMs: number;
      schema: string;
      error?: string;
    }>(`/api/v1/platform-admin/tenants/${id}/test-connection`, { method: 'POST' });
  }

  // ─── Compport Bridge Query Endpoints ─────────────────────

  async bridgeQueryTable(
    schemaName: string,
    tableName: string,
    params?: {
      limit?: number;
      offset?: number;
      columns?: string;
      orderBy?: string;
      orderDir?: string;
    },
  ) {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.columns) qs.set('columns', params.columns);
    if (params?.orderBy) qs.set('orderBy', params.orderBy);
    if (params?.orderDir) qs.set('orderDir', params.orderDir);
    const q = qs.toString();
    return this.fetch<{
      schemaName: string;
      tableName: string;
      rows: Record<string, unknown>[];
      totalCount: number;
      limit: number;
      offset: number;
    }>(`/api/v1/compport-bridge/query/${schemaName}/${tableName}${q ? `?${q}` : ''}`);
  }

  async bridgeQueryTableCount(schemaName: string, tableName: string) {
    return this.fetch<{ schemaName: string; tableName: string; count: number }>(
      `/api/v1/compport-bridge/query/${schemaName}/${tableName}/count`,
    );
  }

  async bridgeMyDataTables() {
    return this.fetch<{ schemaName: string; tables: string[]; count: number }>(
      '/api/v1/compport-bridge/my-data/tables',
    );
  }

  async bridgeMyDataQuery(
    tableName: string,
    params?: {
      limit?: number;
      offset?: number;
      columns?: string;
      orderBy?: string;
      orderDir?: string;
    },
  ) {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.columns) qs.set('columns', params.columns);
    if (params?.orderBy) qs.set('orderBy', params.orderBy);
    if (params?.orderDir) qs.set('orderDir', params.orderDir);
    const q = qs.toString();
    return this.fetch<{
      tableName: string;
      rows: Record<string, unknown>[];
      totalCount: number;
      limit: number;
      offset: number;
    }>(`/api/v1/compport-bridge/my-data/${tableName}${q ? `?${q}` : ''}`);
  }

  async bridgeDiscoveryTables(schemaName: string) {
    return this.fetch<{ schemaName: string; tables: string[] }>(
      `/api/v1/compport-bridge/discovery/schemas/${schemaName}/tables`,
    );
  }

  async bridgeSyncHealth() {
    return this.fetch<{
      status: 'healthy' | 'degraded' | 'idle';
      scheduler: { intervalSeconds: number };
      connections: { total: number; healthy: number; degraded: number; disconnected: number };
      tenants: Array<{
        tenantId: string;
        connected: boolean;
        paused: boolean;
        lastHealthCheck: string | null;
        lastError: string | null;
        consecutiveFailures: number;
        connectedSince: string | null;
        schemaName: string | null;
      }>;
    }>('/api/v1/compport-bridge/sync/health');
  }

  async bridgePauseSync(tenantId: string) {
    return this.fetch<{ tenantId: string; paused: boolean; message: string }>(
      `/api/v1/compport-bridge/sync/pause/${tenantId}`,
      { method: 'POST' },
    );
  }

  async bridgeResumeSync(tenantId: string) {
    return this.fetch<{ tenantId: string; paused: boolean; message: string }>(
      `/api/v1/compport-bridge/sync/resume/${tenantId}`,
      { method: 'POST' },
    );
  }

  // ─── Platform Config ──────────────────────────────────────

  async adminGetConfigCategories() {
    return this.fetch<{ categories: string[] }>('/api/v1/platform-admin/config/categories');
  }

  async adminGetConfig(category: string) {
    return this.fetch<{
      category: string;
      settings: Array<{
        key: string;
        value: string;
        isSecret: boolean;
        description: string | null;
        updatedAt: string;
        updatedBy: string | null;
      }>;
    }>(`/api/v1/platform-admin/config/${category}`);
  }

  async adminSetConfig(
    category: string,
    key: string,
    value: string,
    isSecret?: boolean,
    description?: string,
  ) {
    return this.fetch<{ updated: boolean }>(`/api/v1/platform-admin/config/${category}/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, isSecret, description }),
    });
  }

  async adminDeleteConfig(category: string, key: string) {
    return this.fetch<{ deleted: boolean }>(`/api/v1/platform-admin/config/${category}/${key}`, {
      method: 'DELETE',
    });
  }

  async adminGetAIPresets() {
    return this.fetch<Record<string, unknown>>('/api/v1/platform-admin/config/presets/ai');
  }

  async adminGetMarketDataPresets() {
    return this.fetch<Record<string, unknown>>('/api/v1/platform-admin/config/presets/market-data');
  }

  async adminGetFeaturePresets() {
    return this.fetch<Record<string, unknown>>('/api/v1/platform-admin/config/presets/features');
  }

  async adminValidateAI() {
    return this.fetch<{ valid: boolean; errors: string[] }>(
      '/api/v1/platform-admin/config/validate/ai',
    );
  }

  // ─── Integration Dashboard ────────────────────────────────

  async adminGetIntegrationStats() {
    return this.fetch<Record<string, unknown>>('/api/v1/platform-admin/integrations/stats');
  }

  async adminGetConnectionStatus() {
    return this.fetch<Record<string, unknown>>(
      '/api/v1/platform-admin/integrations/connection-status',
    );
  }

  async adminGetOnboardingStatus() {
    return this.fetch<Record<string, unknown>>(
      '/api/v1/platform-admin/integrations/onboarding-status',
    );
  }
}

export const apiClient = new ApiClient();
