'use client';

import { useState } from 'react';
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
} from '@/hooks/use-admin';
import Link from 'next/link';

export default function AdminCustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: tenant, isLoading } = useAdminTenant(id);
  const { data: usersData } = useAdminTenantUsers(id);
  const { data: overview } = useAdminTenantOverview(id);
  const { data: tenantRoles } = useAdminTenantRoles(id);
  const { data: permissionsData, isLoading: permissionsLoading } = useAdminTenantPermissions(id);
  const updateTenant = useAdminUpdateTenant();
  const suspendTenant = useAdminSuspendTenant();
  const activateTenant = useAdminActivateTenant();
  const createUser = useAdminCreateTenantUser();
  const removeUser = useAdminRemoveTenantUser();

  const router = useRouter();
  const deleteTenant = useAdminDeleteTenant();
  const { data: compportData } = useCompportTenants();

  const [branding, setBranding] = useState({ subdomain: '', logoUrl: '', primaryColor: '' });
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'ADMIN', password: '' });
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedSchema, setSelectedSchema] = useState('');
  const [showSchemaConfirm, setShowSchemaConfirm] = useState(false);
  const [brandingLoaded, setBrandingLoaded] = useState(false);

  if (tenant && !brandingLoaded) {
    setBranding({
      subdomain: (tenant.subdomain as string) || '',
      logoUrl: (tenant.logoUrl as string) || '',
      primaryColor: (tenant.primaryColor as string) || '',
    });
    setBrandingLoaded(true);
  }

  if (isLoading)
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((k) => (
          <Skeleton key={k} className="h-32 w-full" />
        ))}
      </div>
    );
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
    if (deleteConfirmName !== tenant.name) return;
    try {
      await deleteTenant.mutateAsync(id);
      toast({ title: 'Tenant deleted' });
      router.push('/dashboard/admin/customers');
    } catch {
      toast({ title: 'Failed to delete tenant', variant: 'destructive' });
    }
  };

  const handleChangeSchema = async () => {
    if (!selectedSchema) return;
    try {
      await updateTenant.mutateAsync({ id, data: { compportSchema: selectedSchema } });
      toast({ title: `Schema updated to "${selectedSchema}"` });
      setShowSchemaConfirm(false);
      setSelectedSchema('');
    } catch {
      toast({ title: 'Failed to update schema', variant: 'destructive' });
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
        </CardContent>
      </Card>

      <CustomerUsersCard
        users={usersData?.data}
        syncedRoles={tenantRoles}
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
                  disabled={deleteConfirmName !== tenant.name || deleteTenant.isPending}
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
  onRemove,
  newUser,
  setNewUser,
  onAddUser,
  isAdding,
}: {
  users?: any[];
  syncedRoles?: { compportRoleId: string; name: string; isActive: boolean }[];
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
