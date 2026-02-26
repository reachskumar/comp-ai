'use client';

import * as React from 'react';
import { Grid3X3, Plus, Save, Trash2, Play, Link, Loader2, Star, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import {
  useMeritMatrixList,
  useMeritMatrixDetail,
  useCreateMeritMatrixMutation,
  useUpdateMeritMatrixMutation,
  useDeleteMeritMatrixMutation,
  useSimulateMeritMatrixMutation,
  useApplyToCycleMutation,
  type MatrixCell,
  type SimulationResult,
} from '@/hooks/use-merit-matrix';
import { useCycleList } from '@/hooks/use-cycles';

const PERF_RATINGS = [5, 4, 3, 2, 1];
const PERF_LABELS: Record<number, string> = {
  5: 'Exceptional',
  4: 'Exceeds',
  3: 'Meets',
  2: 'Below',
  1: 'Unsatisfactory',
};
const COMPA_RANGES = ['<0.80', '0.80-0.90', '0.90-1.00', '1.00-1.10', '1.10-1.20', '>1.20'];

function buildDefaultMatrix(): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const perfRating of PERF_RATINGS) {
    for (const compaRatioRange of COMPA_RANGES) {
      let base = perfRating * 1.0;
      base -= COMPA_RANGES.indexOf(compaRatioRange) * 0.5;
      cells.push({
        perfRating,
        compaRatioRange,
        increasePercent: Math.max(0, Math.round(base * 10) / 10),
      });
    }
  }
  return cells;
}

function getCellColor(value: number): string {
  if (value >= 5) return 'bg-green-600 text-white';
  if (value >= 4) return 'bg-green-500 text-white';
  if (value >= 3) return 'bg-green-400 text-white';
  if (value >= 2) return 'bg-yellow-400 text-gray-900';
  if (value >= 1) return 'bg-yellow-300 text-gray-900';
  if (value > 0) return 'bg-orange-300 text-gray-900';
  return 'bg-gray-200 text-gray-500';
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function MeritMatrixPage() {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const { data: matrices, isLoading } = useMeritMatrixList();
  if (selectedId) return <MatrixEditor matrixId={selectedId} onBack={() => setSelectedId(null)} />;
  return (
    <MatrixListView
      matrices={matrices ?? []}
      isLoading={isLoading}
      onSelect={setSelectedId}
      createOpen={createOpen}
      onCreateOpen={() => setCreateOpen(true)}
      onCreateClose={() => setCreateOpen(false)}
    />
  );
}

function MatrixListView({
  matrices,
  isLoading,
  onSelect,
  createOpen,
  onCreateOpen,
  onCreateClose,
}: {
  matrices: {
    id: string;
    name: string;
    isDefault: boolean;
    createdAt: string;
    _count?: { cycles: number };
  }[];
  isLoading: boolean;
  onSelect: (id: string) => void;
  createOpen: boolean;
  onCreateOpen: () => void;
  onCreateClose: () => void;
}) {
  const { toast } = useToast();
  const createMut = useCreateMeritMatrixMutation();
  const deleteMut = useDeleteMeritMatrixMutation();
  const [newName, setNewName] = React.useState('');
  const handleCreate = () => {
    if (!newName.trim()) return;
    createMut.mutate(
      { name: newName, isDefault: matrices.length === 0, matrix: buildDefaultMatrix() },
      {
        onSuccess: (d) => {
          toast({ title: 'Created' });
          onCreateClose();
          setNewName('');
          onSelect(d.id);
        },
        onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
      },
    );
  };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Merit Matrix</h1>
          <p className="text-muted-foreground">
            Configure performance × compa-ratio increase grids.
          </p>
        </div>
        <Button onClick={onCreateOpen}>
          <Plus className="mr-2 h-4 w-4" />
          New Matrix
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Grid3X3 className="h-5 w-5" />
            Merit Matrices
          </CardTitle>
          <CardDescription>Select a matrix to edit or simulate.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : matrices.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Grid3X3 className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No merit matrices</p>
              <p className="text-sm text-muted-foreground mb-4">
                Create one to define increase percentages.
              </p>
              <Button onClick={onCreateOpen}>
                <Plus className="mr-2 h-4 w-4" />
                Create Matrix
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Cycles</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrices.map((m) => (
                  <TableRow key={m.id} className="cursor-pointer" onClick={() => onSelect(m.id)}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>
                      {m.isDefault && (
                        <Badge variant="default">
                          <Star className="mr-1 h-3 w-3" />
                          Default
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{m._count?.cycles ?? 0}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMut.mutate(m.id, {
                            onSuccess: () => toast({ title: 'Deleted' }),
                            onError: (e2) =>
                              toast({
                                title: 'Error',
                                description: e2.message,
                                variant: 'destructive',
                              }),
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Dialog open={createOpen} onOpenChange={onCreateClose}>
        <DialogContent onClose={onCreateClose}>
          <DialogHeader>
            <DialogTitle>Create Merit Matrix</DialogTitle>
            <DialogDescription>Create a new matrix with default values.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="matrix-name">Matrix Name</Label>
              <Input
                id="matrix-name"
                placeholder="e.g., FY2026 Merit Matrix"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCreateClose}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createMut.isPending}>
              {createMut.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MatrixEditor({ matrixId, onBack }: { matrixId: string; onBack: () => void }) {
  const { toast } = useToast();
  const { data: matrix, isLoading } = useMeritMatrixDetail(matrixId);
  const updateMut = useUpdateMeritMatrixMutation();
  const simMut = useSimulateMeritMatrixMutation();
  const applyMut = useApplyToCycleMutation();
  const { data: cyclesData } = useCycleList(1, 50);
  const cycles = cyclesData?.data ?? [];
  const [cells, setCells] = React.useState<MatrixCell[]>([]);
  const [editingCell, setEditingCell] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const [simulation, setSimulation] = React.useState<SimulationResult | null>(null);
  const [linkCycleId, setLinkCycleId] = React.useState('');
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (matrix?.matrix) {
      setCells(matrix.matrix as MatrixCell[]);
      setDirty(false);
    }
  }, [matrix]);

  const getCellValue = (pr: number, cr: string) =>
    cells.find((c) => c.perfRating === pr && c.compaRatioRange === cr)?.increasePercent ?? 0;

  const handleCellClick = (pr: number, cr: string) => {
    setEditingCell(`${pr}_${cr}`);
    setEditValue(String(getCellValue(pr, cr)));
  };

  const handleCellSave = (pr: number, cr: string) => {
    const v = parseFloat(editValue);
    if (isNaN(v) || v < 0) {
      setEditingCell(null);
      return;
    }
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.perfRating === pr && c.compaRatioRange === cr);
      const u = [...prev];
      if (idx >= 0) u[idx] = { perfRating: pr, compaRatioRange: cr, increasePercent: v };
      else u.push({ perfRating: pr, compaRatioRange: cr, increasePercent: v });
      return u;
    });
    setEditingCell(null);
    setDirty(true);
  };

  const handleSave = () => {
    updateMut.mutate(
      { id: matrixId, matrix: cells },
      {
        onSuccess: () => {
          toast({ title: 'Saved' });
          setDirty(false);
        },
        onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
      },
    );
  };

  const handleSimulate = () => {
    if (dirty) handleSave();
    simMut.mutate(matrixId, {
      onSuccess: (d) => setSimulation(d),
      onError: (e) =>
        toast({ title: 'Simulation failed', description: e.message, variant: 'destructive' }),
    });
  };

  const handleApply = () => {
    if (!linkCycleId) return;
    applyMut.mutate(
      { matrixId, cycleId: linkCycleId },
      {
        onSuccess: (d) => {
          toast({ title: 'Applied', description: `${d.total} recommendations generated.` });
          setLinkOpen(false);
        },
        onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
      },
    );
  };

  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{matrix?.name ?? 'Merit Matrix'}</h1>
          <p className="text-sm text-muted-foreground">
            Click any cell to edit the increase percentage.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setLinkOpen(true)}>
            <Link className="mr-2 h-4 w-4" />
            Link to Cycle
          </Button>
          <Button variant="outline" onClick={handleSimulate} disabled={simMut.isPending}>
            {simMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Simulate
          </Button>
          <Button onClick={handleSave} disabled={!dirty || updateMut.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {updateMut.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Increase % Grid</CardTitle>
          <CardDescription>Rows = Performance Rating, Columns = Compa-Ratio Range</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="p-2 text-left text-sm font-medium text-muted-foreground border-b">
                    Rating
                  </th>
                  {COMPA_RANGES.map((r) => (
                    <th
                      key={r}
                      className="p-2 text-center text-sm font-medium text-muted-foreground border-b"
                    >
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERF_RATINGS.map((rating) => (
                  <tr key={rating}>
                    <td className="p-2 text-sm font-medium border-b">
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{rating}</span>
                        <span className="text-muted-foreground text-xs">{PERF_LABELS[rating]}</span>
                      </div>
                    </td>
                    {COMPA_RANGES.map((range) => {
                      const val = getCellValue(rating, range);
                      const key = `${rating}_${range}`;
                      const isEd = editingCell === key;
                      const dist = simulation?.cellDistribution[key];
                      return (
                        <td key={range} className="p-1 border-b">
                          {isEd ? (
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="20"
                              autoFocus
                              className="w-full h-14 text-center text-lg font-bold border-2 border-primary rounded"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => handleCellSave(rating, range)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCellSave(rating, range);
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                            />
                          ) : (
                            <button
                              className={`w-full h-14 rounded cursor-pointer transition-all hover:ring-2 hover:ring-primary flex flex-col items-center justify-center ${getCellColor(val)}`}
                              onClick={() => handleCellClick(rating, range)}
                            >
                              <span className="text-lg font-bold">{val}%</span>
                              {dist && (
                                <span className="text-[10px] opacity-80">{dist.count} emp</span>
                              )}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {simulation && <SimulationPanel simulation={simulation} />}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent onClose={() => setLinkOpen(false)}>
          <DialogHeader>
            <DialogTitle>Link to Compensation Cycle</DialogTitle>
            <DialogDescription>
              Apply this matrix to a cycle to auto-generate recommendations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select Cycle</Label>
              <Select
                value={linkCycleId}
                onChange={(e) => setLinkCycleId(e.target.value)}
                options={cycles.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Select cycle..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={!linkCycleId || applyMut.isPending}>
              {applyMut.isPending ? 'Applying...' : 'Apply & Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SimulationPanel({ simulation }: { simulation: SimulationResult }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Employees</CardDescription>
            <CardTitle className="text-2xl">{simulation.totalEmployees}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Total Cost</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(simulation.totalCurrentCost)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Projected Total Cost</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(simulation.totalProjectedCost)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost Impact</CardDescription>
            <CardTitle
              className={`text-2xl ${simulation.totalCostDelta > 0 ? 'text-red-600' : 'text-green-600'}`}
            >
              {simulation.totalCostDelta >= 0 ? '+' : ''}
              {formatCurrency(simulation.totalCostDelta)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Employee Distribution</CardTitle>
          <CardDescription>How employees map to matrix cells</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Level</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-center">Rating</TableHead>
                <TableHead className="text-center">CR</TableHead>
                <TableHead className="text-center">Increase</TableHead>
                <TableHead className="text-right">Projected</TableHead>
                <TableHead className="text-right">Delta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {simulation.employees.slice(0, 50).map((emp) => (
                <TableRow key={emp.employeeId}>
                  <TableCell className="font-medium">{emp.name}</TableCell>
                  <TableCell className="text-sm">{emp.department}</TableCell>
                  <TableCell className="text-sm">{emp.level}</TableCell>
                  <TableCell className="text-right text-sm">
                    {formatCurrency(emp.currentSalary)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">{emp.performanceRating}</Badge>
                  </TableCell>
                  <TableCell className="text-center text-sm">{emp.compaRatio.toFixed(2)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={emp.increasePercent > 0 ? 'default' : 'secondary'}>
                      {emp.increasePercent}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {formatCurrency(emp.projectedSalary)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <span className={emp.costDelta > 0 ? 'text-red-600' : ''}>
                      {emp.costDelta >= 0 ? '+' : ''}
                      {formatCurrency(emp.costDelta)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {simulation.employees.length > 50 && (
            <p className="text-sm text-muted-foreground text-center mt-4">
              Showing first 50 of {simulation.employees.length} employees
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
