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
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Include CSRF token on state-changing requests
    const method = (options.method || 'GET').toUpperCase();
    if (MUTATION_METHODS.has(method)) {
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
        // Refresh CSRF token after auth token refresh
        if (MUTATION_METHODS.has(method)) {
          this.csrfToken = null;
          const csrf = await this.getCsrfToken();
          if (csrf) {
            headers['x-csrf-token'] = csrf;
          }
        }
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

  // Auth endpoints
  async login(email: string, password: string) {
    const result = await this.fetch<{
      accessToken: string;
      refreshToken: string;
      user: { id: string; email: string; name: string; role: string };
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
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
      createdAt: string;
      updatedAt: string;
      _count: { users: number; employees: number };
    }>('/api/v1/settings/tenant');
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

  async adminOnboard(data: {
    companyName: string;
    compportSchema: string;
    subdomain?: string;
    adminEmail?: string;
    adminName?: string;
    adminPassword?: string;
    adminRole?: string;
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
}

export const apiClient = new ApiClient();
