"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, Plus, MoreHorizontal, Copy, Archive, Upload, FileText } from "lucide-react";

interface RuleSetSummary {
  id: string;
  name: string;
  description?: string;
  status: string;
  version: number;
  effectiveDate: string | null;
  ruleCount: number;
  createdAt: string;
  updatedAt: string;
}

interface RuleSetsResponse {
  data: RuleSetSummary[];
  total: number;
  page: number;
  limit: number;
}

const statusVariant = (status: string) => {
  switch (status) {
    case "active":
      return "default" as const;
    case "draft":
      return "secondary" as const;
    case "archived":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
};

export default function RuleSetsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newDescription, setNewDescription] = React.useState("");
  const [importOpen, setImportOpen] = React.useState(false);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [importText, setImportText] = React.useState("");
  const [dragActive, setDragActive] = React.useState(false);

  const { data, isLoading } = useQuery<RuleSetsResponse>({
    queryKey: ["rule-sets"],
    queryFn: () => apiClient.fetch<RuleSetsResponse>("/api/v1/rules/rule-sets?page=1&limit=50"),
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      apiClient.fetch("/api/v1/rules/rule-sets", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      toast({ title: "Rule set created", description: "Your new rule set is ready." });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.fetch(`/api/v1/rules/rule-sets/${id}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      toast({ title: "Rule set cloned" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.fetch(`/api/v1/rules/rule-sets/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      toast({ title: "Rule set archived" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (payload: { file?: File; text?: string }) => {
      if (payload.file) {
        const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
        const formData = new FormData();
        formData.append("file", payload.file);
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/v1/rules/convert-policy/upload`,
          {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { message?: string }).message || `Upload failed (${res.status})`);
        }
        return res.json();
      }
      return apiClient.fetch("/api/v1/rules/convert-policy", {
        method: "POST",
        body: JSON.stringify({ text: payload.text }),
      });
    },
    onSuccess: () => {
      toast({ title: "Policy converted", description: "Rules extracted successfully. Open a rule set to review." });
      setImportOpen(false);
      setImportFile(null);
      setImportText("");
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName, description: newDescription || undefined });
  };

  const handleImport = () => {
    if (importFile) {
      importMutation.mutate({ file: importFile });
    } else if (importText.trim().length >= 10) {
      importMutation.mutate({ text: importText });
    }
  };

  const handleImportDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) setImportFile(file);
    },
    [],
  );

  const ruleSets = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rule Sets</h1>
          <p className="text-muted-foreground">Manage compensation rules and policies.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import Policy
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Rule Set
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            All Rule Sets
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : ruleSets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No rule sets yet</p>
              <p className="text-sm text-muted-foreground mb-4">Create your first rule set to get started.</p>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Rule Set
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Rules</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ruleSets.map((rs) => (
                  <TableRow
                    key={rs.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/dashboard/rules/rule-sets/${rs.id}`)}
                  >
                    <TableCell className="font-medium">{rs.name}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(rs.status)}>{rs.status}</Badge>
                    </TableCell>
                    <TableCell>v{rs.version}</TableCell>
                    <TableCell>
                      {rs.effectiveDate
                        ? new Date(rs.effectiveDate).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>{rs.ruleCount}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              cloneMutation.mutate(rs.id);
                            }}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Clone
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              archiveMutation.mutate(rs.id);
                            }}
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Rule Set Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent onClose={() => setCreateOpen(false)}>
          <DialogHeader>
            <DialogTitle>Create New Rule Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., 2026 Merit Increase Rules"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                placeholder="Describe the purpose of this rule set"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Policy Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent onClose={() => setImportOpen(false)}>
          <DialogHeader>
            <DialogTitle>Import Policy Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleImportDrop}
            >
              {importFile ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <span className="font-medium">{importFile.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => setImportFile(null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground mb-2">
                    Drag &amp; drop a PDF or TXT file here
                  </p>
                  <label className="cursor-pointer">
                    <span className="text-sm text-primary underline">or browse files</span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.txt,application/pdf,text/plain"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setImportFile(file);
                      }}
                    />
                  </label>
                </>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or paste text</span>
              </div>
            </div>

            <Textarea
              placeholder="Paste your compensation policy text here..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={6}
              disabled={!!importFile}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setImportFile(null); setImportText(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={(!importFile && importText.trim().length < 10) || importMutation.isPending}
            >
              {importMutation.isPending ? "Converting..." : "Convert to Rules"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

