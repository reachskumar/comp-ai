'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Users,
  Briefcase,
  Building2,
  UserPlus,
  Trash2,
  Loader2,
  Ban,
  CheckCircle2,
  Shield,
  FileText,
  Key,
  Check,
  X as XIcon,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import {
  useAdminTenant,
  useAdminTenantUsers,
  useAdminTenantOverview,
  useAdminTenantRoles,
  useAdminTenantPermissions,
  useAdminUpdateTenant,
  useAdminSuspendTenant,
  useAdminActivateTenant,
  useAdminCreateTenantUser,
  useAdminRemoveTenantUser,
  useAdminDeleteTenant,
  useCompportTenants,
  useAdminSyncTenantRoles,
  useAdminSyncTenantFull,
  useAdminTestTenantConnection,
} from '@/hooks/use-admin';
import Link from 'next/link';

/** Inline error banner for a failed section */
function SectionError({ label, error }: { label: string; error: unknown }) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="py-3">
        <p className="text-sm text-destructive">
          Failed to load {label}: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </CardContent>
    </Card>
  );
}

export default function AdminCustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: tenant, isLoading, error: tenantError } = useAdminTenant(id);
  const { data: usersData, error: usersError, isLoading: usersLoading } = useAdminTenantUsers(id);
  const {
    data: overview,
    error: overviewError,
    isLoading: overviewLoading,
  } = useAdminTenantOverview(id);
  const { data: tenantRoles, error: rolesError } = useAdminTenantRoles(id);
  const {
    data: permissionsData,
    isLoading: permissionsLoading,
    error: permissionsError,
  } = useAdminTenantPermissions(id);
  const updateTenant = useAdminUpdateTenant();
  const suspendTenant = useAdminSuspendTenant();
  const activateTenant = useAdminActivateTenant();
  const createUser = useAdminCreateTenantUser();
  const removeUser = useAdminRemoveTenantUser();

  const router = useRouter();
  const deleteTenant = useAdminDeleteTenant();
  const { data: compportData } = useCompportTenants();
  const syncRoles = useAdminSyncTenantRoles();
  const syncFull = useAdminSyncTenantFull();
  const testConnection = useAdminTestTenantConnection();

  const [branding, setBranding] = useState({ subdomain: '', logoUrl: '', primaryColor: '' });
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'ADMIN', password: '' });
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedSchema, setSelectedSchema] = useState('');
  const [showSchemaConfirm, setShowSchemaConfirm] = useState(false);
  const [schemaChanged, setSchemaChanged] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    roles: number;
    pages: number;
    permissions: number;
    users: number;
  } | null>(null);
  const [connectionResult, setConnectionResult] = useState<{
    ok: boolean;
    durationMs: number;
    schema: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (tenant) {
      setBranding({
        subdomain: (tenant.subdomain as string) || '',
        logoUrl: (tenant.logoUrl as string) || '',
        primaryColor: (tenant.primaryColor as string) || '',
      });
    }
  }, [tenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading)
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((k) => (
          <Skeleton key={k} className="h-32 w-full" />
        ))}
      </div>
    );
  if (tenantError) return <SectionError label="tenant" error={tenantError} />;
  if (!tenant) return <p className="text-muted-foreground">Tenant not found.</p>;

  const handleSaveBranding = async () => {
    try {
      await updateTenant.mutateAsync({ id, data: branding });
      toast({ title: 'Branding updated' });
    } catch {
      toast({ title: 'Failed to update branding', variant: 'destructive' });
    }
  };

  const handleToggleSuspend = async () => {
    try {
      if (tenant.isActive) {
        await suspendTenant.mutateAsync(id);
        toast({ title: 'Tenant suspended' });
      } else {
        await activateTenant.mutateAsync(id);
        toast({ title: 'Tenant activated' });
      }
    } catch {
      toast({ title: 'Action failed', variant: 'destructive' });
    }
  };

  const handleDeleteTenant = async () => {
    if (deleteConfirmName.trim().toLowerCase() !== (tenant.name as string).trim().toLowerCase()) return;
    try {
      await deleteTenant.mutateAsync(id);
      toast({ title: 'Tenant deleted successfully' });
      router.push('/dashboard/admin/customers');
    } catch (e) {
      toast({
        title: 'Failed to delete tenant',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleChangeSchema = async () => {
    if (!selectedSchema) return;
    try {
      await updateTenant.mutateAsync({ id, data: { compportSchema: selectedSchema } });
      toast({ title: `Schema updated to "${selectedSchema}"` });
      setShowSchemaConfirm(false);
      setSelectedSchema('');
      setSchemaChanged(true);
      setSyncResult(null);
    } catch {
      toast({ title: 'Failed to update schema', variant: 'destructive' });
    }
  };

  const handleSyncRoles = async () => {
    try {
      const result = await syncRoles.mutateAsync(id);
      toast({
        title: 'Roles & Permissions synced',
        description: `${result.result.roles.synced} roles, ${result.result.pages.synced} pages, ${result.result.permissions.synced} permissions`,
      });
      setSyncResult({
        roles: result.result.roles.synced,
        pages: result.result.pages.synced,
        permissions: result.result.permissions.synced,
        users: result.result.users.synced,
      });
      setSchemaChanged(false);
    } catch {
      toast({ title: 'Failed to sync roles', variant: 'destructive' });
    }
  };

  const handleTestConnection = async () => {
    setConnectionResult(null);
    try {
      const result = await testConnection.mutateAsync(id);
      setConnectionResult(result);
    } catch {
      setConnectionResult({
        ok: false,
        durationMs: 0,
        schema: (tenant?.compportSchema as string) || '',
        error: 'Request failed — check network or API',
      });
    }
  };

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.name) return;
    try {
      await createUser.mutateAsync({ tenantId: id, data: newUser });
      toast({ title: 'User created successfully.' });
      setNewUser({ email: '', name: '', role: 'ADMIN', password: '' });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
    }
  };

  const counts = tenant._count as Record<string, number> | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/admin/customers">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{tenant.name as string}</h1>
          <p className="text-sm text-muted-foreground">{tenant.slug as string}</p>
        </div>
        <Badge variant={tenant.isActive ? 'default' : 'destructive'}>
          {tenant.isActive ? 'Active' : 'Suspended'}
        </Badge>
        <Badge variant="outline">{tenant.plan as string}</Badge>
      </div>

      {overviewError && <SectionError label="overview" error={overviewError} />}

      {overviewLoading ? (
        <div className="grid grid-cols-7 gap-3">
          {[1, 2, 3, 4, 5, 6, 7].map((k) => (
            <Skeleton key={k} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-3">
          {(
            [
              ['Users', overview?.counts?.users ?? counts?.users ?? 0, Users],
              ['Employees', overview?.counts?.employees ?? counts?.employees ?? 0, Briefcase],
              ['Roles', overview?.syncedEntities?.roles ?? 0, Shield],
              ['Pages', overview?.syncedEntities?.pages ?? 0, FileText],
              ['Permissions', overview?.syncedEntities?.permissions ?? 0, Key],
              ['Cycles', counts?.compCycles ?? 0, Building2],
              ['Imports', counts?.importJobs ?? 0, Building2],
            ] as const
          ).map(([label, value, Icon]) => (
            <Card key={label}>
              <CardContent className="pt-4 text-center">
                <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Branding &amp; Subdomain</CardTitle>
          <CardDescription>Configure branded URL access</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Subdomain</Label>
              <div className="flex items-center gap-1">
                <Input
                  value={branding.subdomain}
                  onChange={(e) => setBranding((b) => ({ ...b, subdomain: e.target.value }))}
                  placeholder="standardbank"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  .compportiq.ai
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Logo URL</Label>
              <Input
                value={branding.logoUrl}
                onChange={(e) => setBranding((b) => ({ ...b, logoUrl: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div className="space-y-1">
              <Label>Brand Color</Label>
              <Input
                value={branding.primaryColor}
                onChange={(e) => setBranding((b) => ({ ...b, primaryColor: e.target.value }))}
                placeholder="#0066FF"
              />
            </div>
          </div>
          <Button onClick={handleSaveBranding} disabled={updateTenant.isPending}>
            {updateTenant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            Branding
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compport Schema Mapping</CardTitle>
          <CardDescription>
            The Compport schema determines which dataset this tenant reads from Cloud SQL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="space-y-1 flex-1">
              <Label>Current Schema</Label>
              <p className="text-sm font-mono bg-muted px-3 py-2 rounded-md">
                {(tenant.compportSchema as string) || (
                  <span className="text-muted-foreground italic">Not mapped</span>
                )}
              </p>
            </div>
            <div className="space-y-1 flex-1">
              <Label>Change To</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={selectedSchema}
                onChange={(e) => {
                  setSelectedSchema(e.target.value);
                  setShowSchemaConfirm(false);
                }}
              >
                <option value="">Select a schema...</option>
                {compportData?.tenants?.map((ct) => (
                  <option key={ct.schemaName} value={ct.schemaName}>
                    {ct.companyName} ({ct.schemaName})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedSchema && selectedSchema !== tenant.compportSchema && !showSchemaConfirm && (
            <Button variant="outline" onClick={() => setShowSchemaConfirm(true)}>
              Change Schema Mapping
            </Button>
          )}

          {showSchemaConfirm && selectedSchema && selectedSchema !== tenant.compportSchema && (
            <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                ⚠️ Changing the schema will make this tenant read data from a different Compport
                dataset. This does not migrate any data.
              </p>
              <p className="text-sm">
                <span className="font-mono">{(tenant.compportSchema as string) || 'none'}</span>
                {' → '}
                <span className="font-mono font-bold">{selectedSchema}</span>
              </p>
              <div className="flex gap-2">
                <Button onClick={handleChangeSchema} disabled={updateTenant.isPending}>
                  {updateTenant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm Change
                </Button>
                <Button variant="ghost" onClick={() => setShowSchemaConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <Separator />

          {/* Test Cloud SQL Connection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Connection Test</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Verify Cloud SQL connectivity before syncing
                </p>
              </div>
              <Button
                onClick={handleTestConnection}
                disabled={testConnection.isPending || !tenant.compportSchema}
                variant="outline"
                size="sm"
              >
                {testConnection.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Test Connection
              </Button>
            </div>

            {connectionResult && connectionResult.ok && (
              <div className="rounded-md border border-green-500/50 bg-green-50 dark:bg-green-950/20 p-3">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  ✅ Connected to <span className="font-mono">{connectionResult.schema}</span> in{' '}
                  {connectionResult.durationMs}ms
                </p>
              </div>
            )}

            {connectionResult && !connectionResult.ok && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-1">
                <p className="text-sm font-medium text-destructive">❌ Connection failed</p>
                <p className="text-xs text-muted-foreground">
                  Schema: <span className="font-mono">{connectionResult.schema}</span>
                  {connectionResult.durationMs > 0 && ` · ${connectionResult.durationMs}ms`}
                </p>
                {connectionResult.error && (
                  <p className="text-xs text-destructive/80 font-mono break-all">
                    {connectionResult.error}
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Re-sync Roles & Permissions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Roles & Permissions</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sync roles, pages, and permissions from the Compport Cloud SQL schema
                </p>
              </div>
              <Button
                onClick={handleSyncRoles}
                disabled={syncRoles.isPending || !tenant.compportSchema}
                variant="outline"
                size="sm"
              >
                {syncRoles.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Re-sync
              </Button>
            </div>

            {schemaChanged && (
              <div className="rounded-md border border-blue-500/50 bg-blue-50 dark:bg-blue-950/20 p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  💡 Schema has been changed. Click "Re-sync" to update roles and permissions from
                  the new schema.
                </p>
              </div>
            )}

            {syncResult && (
              <div className="rounded-md border border-green-500/50 bg-green-50 dark:bg-green-950/20 p-3 space-y-1">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  ✅ Sync completed successfully
                </p>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Roles:</span>{' '}
                    <span className="font-semibold">{syncResult.roles}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Pages:</span>{' '}
                    <span className="font-semibold">{syncResult.pages}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Permissions:</span>{' '}
                    <span className="font-semibold">{syncResult.permissions}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Users:</span>{' '}
                    <span className="font-semibold">{syncResult.users}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Full Data Sync — roles + permissions + employees */}
          <FullSyncSection
            tenantId={id}
            hasSchema={!!tenant.compportSchema}
            syncFull={syncFull}
            toast={toast}
          />
        </CardContent>
      </Card>

      {usersError && <SectionError label="users" error={usersError} />}
      {rolesError && <SectionError label="roles" error={rolesError} />}

      <CustomerUsersCard
        users={usersData?.data}
        syncedRoles={Array.isArray(tenantRoles) ? tenantRoles : []}
        isLoadingUsers={usersLoading}
        onRemove={async (userId: string) => {
          try {
            await removeUser.mutateAsync({ tenantId: id, userId });
            toast({ title: 'User removed' });
          } catch {
            toast({ title: 'Failed', variant: 'destructive' });
          }
        }}
        newUser={newUser}
        setNewUser={setNewUser}
        onAddUser={handleAddUser}
        isAdding={createUser.isPending}
      />

      {permissionsError && <SectionError label="permissions" error={permissionsError} />}
      <RolePermissionsCard permissionsData={permissionsData} isLoading={permissionsLoading} />

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{tenant.isActive ? 'Suspend' : 'Activate'} this tenant</p>
              <p className="text-sm text-muted-foreground">
                {tenant.isActive
                  ? 'Suspending will prevent all users from accessing the tenant.'
                  : 'Re-activate this tenant to restore access for all users.'}
              </p>
            </div>
            <Button
              variant={tenant.isActive ? 'destructive' : 'default'}
              onClick={handleToggleSuspend}
            >
              {tenant.isActive ? (
                <>
                  <Ban className="mr-2 h-4 w-4" />
                  Suspend Tenant
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Activate Tenant
                </>
              )}
            </Button>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Delete this tenant</p>
                <p className="text-sm text-muted-foreground">
                  Permanently delete this tenant and all associated data. This action cannot be
                  undone.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Tenant
              </Button>
            </div>

            {showDeleteConfirm && (
              <div className="mt-4 rounded-md border border-destructive/50 p-4 space-y-3">
                <p className="text-sm">
                  Type <span className="font-bold">{tenant.name as string}</span> to confirm
                  deletion:
                </p>
                <Input
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder="Type tenant name to confirm"
                />
                <Button
                  variant="destructive"
                  disabled={deleteConfirmName.trim().toLowerCase() !== (tenant.name as string).trim().toLowerCase() || deleteTenant.isPending}
                  onClick={handleDeleteTenant}
                >
                  {deleteTenant.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Permanently Delete
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const FALLBACK_ROLES = ['ADMIN', 'HR_MANAGER', 'MANAGER', 'ANALYST', 'EMPLOYEE'];

function CustomerUsersCard({
  users,
  syncedRoles,
  isLoadingUsers,
  onRemove,
  newUser,
  setNewUser,
  onAddUser,
  isAdding,
}: {
  users?: any[];
  syncedRoles?: { compportRoleId: string; name: string; isActive: boolean }[];
  isLoadingUsers?: boolean;
  onRemove: (id: string) => void;
  newUser: { email: string; name: string; role: string; password: string };
  setNewUser: (fn: (n: any) => any) => void;
  onAddUser: () => void;
  isAdding: boolean;
}) {
  const activeRoles = syncedRoles?.filter((r) => r.isActive);
  const hasRoles = activeRoles && activeRoles.length > 0;
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordMismatch =
    newUser.password.length > 0 &&
    confirmPassword.length > 0 &&
    newUser.password !== confirmPassword;

  const handleAdd = () => {
    if (passwordMismatch) return;
    onAddUser();
    setConfirmPassword('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>Manage users for this tenant</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoadingUsers ? (
          <div className="space-y-2">
            {[1, 2].map((k) => (
              <Skeleton key={k} className="h-12 w-full" />
            ))}
          </div>
        ) : null}
        {users?.map((u: any) => (
          <div key={u.id} className="flex items-center gap-3 py-2 border-b last:border-0">
            <div className="flex-1">
              <p className="font-medium">{u.name}</p>
              <p className="text-sm text-muted-foreground">{u.email}</p>
            </div>
            <Badge variant="outline">{u.role}</Badge>
            <Button variant="ghost" size="icon" onClick={() => onRemove(u.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Separator />
        <div className="grid grid-cols-3 gap-2 items-end">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              value={newUser.name}
              onChange={(e) => setNewUser((n: any) => ({ ...n, name: e.target.value }))}
              placeholder="John Doe"
            />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              value={newUser.email}
              onChange={(e) => setNewUser((n: any) => ({ ...n, email: e.target.value }))}
              placeholder="john@company.com"
            />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <select
              className="w-full h-9 rounded-md border px-3 text-sm"
              value={newUser.role}
              onChange={(e) => setNewUser((n: any) => ({ ...n, role: e.target.value }))}
            >
              {hasRoles ? (
                <>
                  <option value="" disabled>
                    Select a role…
                  </option>
                  {activeRoles.map((r) => (
                    <option key={r.compportRoleId} value={r.compportRoleId}>
                      {r.name}
                    </option>
                  ))}
                </>
              ) : (
                FALLBACK_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace('_', ' ')}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 items-end">
          <div className="space-y-1">
            <Label>Password</Label>
            <Input
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser((n: any) => ({ ...n, password: e.target.value }))}
              placeholder="Min 8 chars"
              minLength={8}
            />
            <p className="text-xs text-muted-foreground">Upper, lower, number &amp; special</p>
          </div>
          <div className="space-y-1">
            <Label>Confirm Password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
            />
            {passwordMismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
          </div>
          <Button onClick={handleAdd} disabled={isAdding || passwordMismatch}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RolePermissionsCard({
  permissionsData,
  isLoading,
}: {
  permissionsData?: {
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
  };
  isLoading: boolean;
}) {
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

  const toggleRole = (roleId: string) => {
    setExpandedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) {
        next.delete(roleId);
      } else {
        next.add(roleId);
      }
      return next;
    });
  };

  const PermBadge = ({ allowed }: { allowed: boolean }) =>
    allowed ? (
      <Check className="h-4 w-4 text-green-600" />
    ) : (
      <XIcon className="h-4 w-4 text-muted-foreground/30" />
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Role Permissions
        </CardTitle>
        <CardDescription>
          Synced Compport role→page permission matrix
          {permissionsData && ` (${permissionsData.totalPermissions} permission rules)`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((k) => (
              <Skeleton key={k} className="h-10 w-full" />
            ))}
          </div>
        ) : !permissionsData?.roles?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No permissions synced yet. Permissions will be available after a sync runs.
          </p>
        ) : (
          <div className="space-y-2">
            {permissionsData.roles.map((role) => {
              const isExpanded = expandedRoles.has(role.compportRoleId);
              return (
                <div key={role.compportRoleId} className="rounded-lg border">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => toggleRole(role.compportRoleId)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="font-medium flex-1">{role.roleName}</span>
                    <Badge variant="secondary" className="text-xs">
                      {role.pages.length} pages
                    </Badge>
                  </button>
                  {isExpanded && (
                    <div className="border-t px-4 pb-3">
                      <table className="w-full text-sm mt-2">
                        <thead>
                          <tr className="text-xs text-muted-foreground border-b">
                            <th className="text-left py-2 font-medium">Page</th>
                            <th className="text-center py-2 font-medium w-16">View</th>
                            <th className="text-center py-2 font-medium w-16">Insert</th>
                            <th className="text-center py-2 font-medium w-16">Update</th>
                            <th className="text-center py-2 font-medium w-16">Delete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {role.pages.map((page) => (
                            <tr key={page.pageName} className="border-b last:border-0">
                              <td className="py-2 text-left">{page.pageName}</td>
                              <td className="py-2 text-center">
                                <PermBadge allowed={page.canView} />
                              </td>
                              <td className="py-2 text-center">
                                <PermBadge allowed={page.canInsert} />
                              </td>
                              <td className="py-2 text-center">
                                <PermBadge allowed={page.canUpdate} />
                              </td>
                              <td className="py-2 text-center">
                                <PermBadge allowed={page.canDelete} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FullSyncSection({
  tenantId,
  hasSchema,
  syncFull,
  toast,
}: {
  tenantId: string;
  hasSchema: boolean;
  syncFull: ReturnType<typeof useAdminSyncTenantFull>;
  toast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
}) {
  const [fullSyncResult, setFullSyncResult] = useState<Record<string, unknown> | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = async () => {
    setFullSyncResult(null);
    setSyncError(null);
    try {
      const result = await syncFull.mutateAsync(tenantId);
      setFullSyncResult(result);
      toast({ title: 'Full sync completed successfully' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setSyncError(msg);
      toast({ title: 'Full sync failed', description: msg, variant: 'destructive' });
    }
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const roles = fullSyncResult?.roles as Record<string, any> | undefined;
  const employees = fullSyncResult?.employees as Record<string, any> | undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Full Data Sync</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sync all data: roles, permissions, users, and employees from Compport Cloud SQL.
          </p>
        </div>
        <Button
          onClick={handleSync}
          disabled={syncFull.isPending || !hasSchema}
          variant="default"
          size="sm"
        >
          {syncFull.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {syncFull.isPending ? 'Syncing...' : 'Sync All Data'}
        </Button>
      </div>

      {syncFull.isPending && (
        <div className="rounded-md border border-blue-500/50 bg-blue-50 dark:bg-blue-950/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              Syncing data from Compport Cloud SQL...
            </p>
          </div>
          <p className="text-xs text-blue-600 dark:text-blue-400">
            This may take a few minutes for large datasets. Please wait.
          </p>
        </div>
      )}

      {syncError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Sync failed</p>
          <p className="text-xs text-destructive/80 mt-1 font-mono break-all">{syncError}</p>
        </div>
      )}

      {fullSyncResult && !syncError && (
        <div className="rounded-md border border-green-500/50 bg-green-50 dark:bg-green-950/20 p-4 space-y-3">
          <p className="text-sm font-medium text-green-800 dark:text-green-200">
            Sync completed successfully
          </p>
          <div className="grid grid-cols-3 gap-3">
            {([
              [roles?.roles?.synced ?? 0, 'Roles'],
              [roles?.pages?.synced ?? 0, 'Pages'],
              [roles?.permissions?.synced ?? 0, 'Permissions'],
              [roles?.users?.synced ?? 0, 'Users Synced'],
              [roles?.users?.linked ?? 0, 'Users Linked'],
              [employees?.synced ?? 0, 'Employees'],
            ] as [number, string][]).map(([value, label]) => (
              <div key={label} className="rounded-lg bg-white dark:bg-slate-900 p-3 text-center border">
                <p className="text-xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          {employees?.durationMs > 0 && (
            <p className="text-xs text-muted-foreground">
              Employee sync: {(employees.durationMs / 1000).toFixed(1)}s
              {employees?.skipped > 0 && ` | ${employees.skipped} skipped`}
              {employees?.errors > 0 && ` | ${employees.errors} errors`}
            </p>
          )}
        </div>
      )}

      <div className="rounded-md bg-muted/50 p-3">
        <p className="text-xs text-muted-foreground">
          <strong>Auto-sync:</strong> Delta sync runs every 2 minutes automatically,
          pulling only changed records. Use this button for a full re-sync when data
          looks inconsistent or after schema changes.
        </p>
      </div>
    </div>
  );
}
