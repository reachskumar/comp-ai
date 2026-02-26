'use client';

import * as React from 'react';
import {
  Plus,
  Loader2,
  Network,
  Users,
  Layers,
  ArrowRight,
  Trash2,
  Wand2,
  Building2,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import {
  useJobArchitectureSummary,
  useJobFamilies,
  useJobLevels,
  useCareerLadders,
  useCreateJobFamilyMutation,
  useDeleteJobFamilyMutation,
  useCreateJobLevelMutation,
  useDeleteJobLevelMutation,
  useAutoAssignMutation,
  useCreateCareerLadderMutation,
  useDeleteCareerLadderMutation,
  type JobFamily,
  type JobLevel,
  type CareerLadder,
} from '@/hooks/use-job-architecture';

/* ─── Helpers ───────────────────────────────────────── */

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val);
}

/* ─── Summary Cards ─────────────────────────────────── */

function SummaryCards() {
  const { data: summary, isLoading } = useJobArchitectureSummary();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Job Families',
      value: summary?.families ?? 0,
      icon: Building2,
      color: 'text-blue-600',
    },
    { label: 'Job Levels', value: summary?.levels ?? 0, icon: Layers, color: 'text-purple-600' },
    {
      label: 'Assigned',
      value: summary?.assignedEmployees ?? 0,
      icon: Users,
      color: 'text-green-600',
    },
    {
      label: 'Unassigned',
      value: summary?.unassignedEmployees ?? 0,
      icon: Users,
      color: 'text-orange-600',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
            <c.icon className={`h-4 w-4 ${c.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{c.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── Job Families Tab ──────────────────────────────── */

function JobFamiliesTab() {
  const { data, isLoading } = useJobFamilies();
  const createMutation = useCreateJobFamilyMutation();
  const deleteMutation = useDeleteJobFamilyMutation();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', code: '', description: '' });

  const handleCreate = async () => {
    try {
      await createMutation.mutateAsync(form);
      toast({ title: 'Job family created' });
      setShowCreate(false);
      setForm({ name: '', code: '', description: '' });
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Job family deleted' });
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Organize roles into job families for structured compensation management.
        </p>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Family
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Levels</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.data ?? []).map((f: JobFamily) => (
            <TableRow key={f.id}>
              <TableCell className="font-medium">{f.name}</TableCell>
              <TableCell>
                <Badge variant="outline">{f.code}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground max-w-xs truncate">
                {f.description || '—'}
              </TableCell>
              <TableCell>{f._count?.jobLevels ?? 0}</TableCell>
              <TableCell>
                <Badge variant={f.isActive ? 'default' : 'secondary'}>
                  {f.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(f.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {(data?.data ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No job families yet. Create one to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Job Family</DialogTitle>
            <DialogDescription>Add a new job family to organize roles.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Engineering"
              />
            </div>
            <div>
              <Label>Code</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="ENG"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Software engineering roles"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !form.name || !form.code}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Job Levels Tab ────────────────────────────────── */

function JobLevelsTab() {
  const { data: families } = useJobFamilies();
  const { data: levels, isLoading } = useJobLevels({ limit: 200 });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  // Group levels by family
  const grouped = new Map<string, { family: string; levels: JobLevel[] }>();
  for (const level of levels?.data ?? []) {
    const familyName = level.jobFamily?.name ?? 'Unknown';
    if (!grouped.has(familyName)) grouped.set(familyName, { family: familyName, levels: [] });
    grouped.get(familyName)!.levels.push(level);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        View all job levels across families with grade banding and salary ranges.
      </p>

      {Array.from(grouped.entries()).map(([familyName, group]) => (
        <Card key={familyName}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-600" />
              {familyName}
            </CardTitle>
            <CardDescription>{group.levels.length} levels</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grade</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Min Salary</TableHead>
                  <TableHead>Mid Salary</TableHead>
                  <TableHead>Max Salary</TableHead>
                  <TableHead>Employees</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.levels
                  .sort((a, b) => a.grade - b.grade)
                  .map((level) => (
                    <TableRow key={level.id}>
                      <TableCell>
                        <Badge variant="outline">G{level.grade}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{level.name}</TableCell>
                      <TableCell className="text-muted-foreground">{level.code}</TableCell>
                      <TableCell>{formatCurrency(Number(level.minSalary))}</TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(Number(level.midSalary))}
                      </TableCell>
                      <TableCell>{formatCurrency(Number(level.maxSalary))}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{level._count?.employees ?? 0}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {grouped.size === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No job levels defined yet. Create job families first, then add levels.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Career Ladders Tab ────────────────────────────── */

function CareerLaddersTab() {
  const { data: ladders, isLoading } = useCareerLadders();
  const { data: levels } = useJobLevels({ limit: 200 });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  // Build a lookup for level details
  const levelMap = new Map<string, JobLevel>();
  for (const l of levels?.data ?? []) {
    levelMap.set(l.code, l);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Visualize career progression paths showing how employees can advance through levels.
      </p>

      {(ladders?.data ?? []).map((ladder: CareerLadder) => (
        <Card key={ladder.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5 text-purple-600" />
              {ladder.name}
            </CardTitle>
            {ladder.description && <CardDescription>{ladder.description}</CardDescription>}
          </CardHeader>
          <CardContent>
            {(ladder.tracks ?? []).map((track, idx) => (
              <div key={idx} className="mb-6 last:mb-0">
                <h4 className="text-sm font-semibold mb-3">{track.trackName}</h4>
                <div className="flex items-center gap-2 flex-wrap">
                  {track.levels.map((levelCode, i) => {
                    const levelInfo = levelMap.get(levelCode);
                    return (
                      <React.Fragment key={levelCode}>
                        <div className="flex flex-col items-center">
                          <div className="border rounded-lg px-4 py-3 bg-card hover:bg-accent transition-colors min-w-[120px] text-center">
                            <div className="font-medium text-sm">
                              {levelInfo?.name ?? levelCode}
                            </div>
                            <div className="text-xs text-muted-foreground">{levelCode}</div>
                            {levelInfo && (
                              <div className="text-xs text-muted-foreground mt-1">
                                {formatCurrency(Number(levelInfo.midSalary))}
                              </div>
                            )}
                          </div>
                        </div>
                        {i < track.levels.length - 1 && (
                          <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {(ladders?.data ?? []).length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No career ladders defined yet. Career ladders are created from seed data or via the API.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Assignment Tab ────────────────────────────────── */

function AssignmentTab() {
  const { data: summary } = useJobArchitectureSummary();
  const autoAssign = useAutoAssignMutation();
  const { toast } = useToast();

  const handleAutoAssign = async () => {
    try {
      const result = await autoAssign.mutateAsync();
      toast({
        title: `Auto-assigned ${result.assigned} employees across ${result.totalLevels} levels`,
      });
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-muted-foreground">
            Assign employees to job levels. Auto-assign matches employees by their job family and
            level strings.
          </p>
        </div>
        <Button onClick={handleAutoAssign} disabled={autoAssign.isPending}>
          {autoAssign.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="mr-2 h-4 w-4" />
          )}
          Auto-Assign Employees
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-green-600 flex items-center gap-2">
              <Users className="h-5 w-5" />
              Assigned Employees
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{summary?.assignedEmployees ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-1">
              Employees with a formal job level assignment
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-orange-600 flex items-center gap-2">
              <Users className="h-5 w-5" />
              Unassigned Employees
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{summary?.unassignedEmployees ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-1">
              Employees without a job level — use auto-assign to match them
            </p>
          </CardContent>
        </Card>
      </div>

      {summary && summary.totalEmployees > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Assignment Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full bg-secondary rounded-full h-4">
              <div
                className="bg-green-600 h-4 rounded-full transition-all"
                style={{
                  width: `${Math.round((summary.assignedEmployees / summary.totalEmployees) * 100)}%`,
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {Math.round((summary.assignedEmployees / summary.totalEmployees) * 100)}% of employees
              assigned to a job level
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────── */

export default function JobArchitecturePage() {
  const [activeTab, setActiveTab] = React.useState('families');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Job Architecture</h1>
        <p className="text-muted-foreground">
          Manage job families, career ladders, grade structures, and employee level assignments.
        </p>
      </div>

      <SummaryCards />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="families">Job Families</TabsTrigger>
          <TabsTrigger value="levels">Job Levels</TabsTrigger>
          <TabsTrigger value="ladders">Career Ladders</TabsTrigger>
          <TabsTrigger value="assignment">Assignment</TabsTrigger>
        </TabsList>

        <TabsContent value="families">
          <JobFamiliesTab />
        </TabsContent>
        <TabsContent value="levels">
          <JobLevelsTab />
        </TabsContent>
        <TabsContent value="ladders">
          <CareerLaddersTab />
        </TabsContent>
        <TabsContent value="assignment">
          <AssignmentTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
