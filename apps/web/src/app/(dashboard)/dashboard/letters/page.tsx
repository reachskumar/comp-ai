"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Send,
  Loader2,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronLeft,
  Download,
  Edit,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  useLetters,
  type LetterType,
  type CompensationLetter,
  type GenerateLetterInput,
} from "@/hooks/use-letters";

const LETTER_TYPES: { value: LetterType; label: string }[] = [
  { value: "offer", label: "Offer Letter" },
  { value: "raise", label: "Salary Raise" },
  { value: "promotion", label: "Promotion" },
  { value: "bonus", label: "Bonus Notification" },
  { value: "total_comp_summary", label: "Total Comp Summary" },
];

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "warm", label: "Warm & Friendly" },
  { value: "formal", label: "Formal" },
  { value: "celebratory", label: "Celebratory" },
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "secondary",
  GENERATING: "outline",
  REVIEW: "default",
  APPROVED: "default",
  SENT: "default",
  FAILED: "destructive",
};

function getStatusIcon(status: string) {
  switch (status) {
    case "GENERATING": return <Loader2 className="h-3 w-3 animate-spin" />;
    case "REVIEW": return <Eye className="h-3 w-3" />;
    case "APPROVED": return <CheckCircle2 className="h-3 w-3" />;
    case "SENT": return <Send className="h-3 w-3" />;
    case "FAILED": return <AlertCircle className="h-3 w-3" />;
    default: return <Clock className="h-3 w-3" />;
  }
}

export default function LettersPage() {
  const {
    letters,
    currentLetter,
    isGenerating,
    isLoading,
    error,
    pagination,
    generateLetter,
    fetchLetters,
    updateLetter,
    clearCurrentLetter,
  } = useLetters();

  const [activeTab, setActiveTab] = useState("generate");
  const [previewLetter, setPreviewLetter] = useState<CompensationLetter | null>(null);

  // Form state
  const [form, setForm] = useState<GenerateLetterInput>({
    employeeId: "",
    letterType: "raise",
    tone: "professional",
    language: "en",
  });

  // Load history when switching to history tab
  useEffect(() => {
    if (activeTab === "history") {
      void fetchLetters();
    }
  }, [activeTab, fetchLetters]);

  // When a letter is generated, show preview
  useEffect(() => {
    if (currentLetter && !isGenerating) {
      setPreviewLetter(currentLetter);
      setActiveTab("preview");
    }
  }, [currentLetter, isGenerating]);

  const handleGenerate = useCallback(async () => {
    if (!form.employeeId.trim()) return;
    await generateLetter(form);
  }, [form, generateLetter]);

  const handleApprove = useCallback(async () => {
    if (!previewLetter) return;
    await updateLetter(previewLetter.id, { status: "APPROVED" });
  }, [previewLetter, updateLetter]);

  const handleFormChange = useCallback((field: string, value: string | number | undefined) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Compensation Letters</h1>
            <p className="text-xs text-muted-foreground">
              {isGenerating ? "Generating letter…" : "Generate, review, and send AI-powered compensation letters"}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden px-4 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
          <TabsList className="mb-4">
            <TabsTrigger value="generate">
              <Plus className="mr-1 h-4 w-4" />
              Generate
            </TabsTrigger>
            <TabsTrigger value="history">
              <Clock className="mr-1 h-4 w-4" />
              History
            </TabsTrigger>
            {previewLetter && (
              <TabsTrigger value="preview">
                <Eye className="mr-1 h-4 w-4" />
                Preview
              </TabsTrigger>
            )}
          </TabsList>

          {/* Generate Tab */}
          <TabsContent value="generate" className="flex-1 overflow-auto">
            <GenerateForm
              form={form}
              onChange={handleFormChange}
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
              error={error}
            />
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="flex-1 overflow-auto">
            <LetterHistory
              letters={letters}
              isLoading={isLoading}
              pagination={pagination}
              onView={(letter) => { setPreviewLetter(letter); setActiveTab("preview"); }}
              onPageChange={(page) => void fetchLetters({ page })}
            />
          </TabsContent>

          {/* Preview Tab */}
          <TabsContent value="preview" className="flex-1 overflow-auto">
            {previewLetter && (
              <LetterPreview
                letter={previewLetter}
                onBack={() => { setPreviewLetter(null); clearCurrentLetter(); setActiveTab("generate"); }}
                onApprove={handleApprove}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Generate Form ──────────────────────────────────────

interface GenerateFormProps {
  form: GenerateLetterInput;
  onChange: (field: string, value: string | number | undefined) => void;
  onGenerate: () => Promise<void>;
  isGenerating: boolean;
  error: string | null;
}

function GenerateForm({ form, onChange, onGenerate, isGenerating, error }: GenerateFormProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Letter Details</CardTitle>
          <CardDescription>Configure the compensation letter parameters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="employeeId">Employee ID</Label>
            <Input
              id="employeeId"
              placeholder="Enter employee ID"
              value={form.employeeId}
              onChange={(e) => onChange("employeeId", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="letterType">Letter Type</Label>
              <Select
                id="letterType"
                options={LETTER_TYPES}
                value={form.letterType}
                onChange={(e) => onChange("letterType", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tone">Tone</Label>
              <Select
                id="tone"
                options={TONE_OPTIONS}
                value={form.tone ?? "professional"}
                onChange={(e) => onChange("tone", e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="newSalary">New Salary</Label>
              <Input
                id="newSalary"
                type="number"
                placeholder="e.g., 120000"
                value={form.newSalary ?? ""}
                onChange={(e) => onChange("newSalary", e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salaryIncreasePercent">Increase %</Label>
              <Input
                id="salaryIncreasePercent"
                type="number"
                placeholder="e.g., 10"
                value={form.salaryIncreasePercent ?? ""}
                onChange={(e) => onChange("salaryIncreasePercent", e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bonusAmount">Bonus Amount</Label>
              <Input
                id="bonusAmount"
                type="number"
                placeholder="e.g., 5000"
                value={form.bonusAmount ?? ""}
                onChange={(e) => onChange("bonusAmount", e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="effectiveDate">Effective Date</Label>
              <Input
                id="effectiveDate"
                type="date"
                value={form.effectiveDate ?? ""}
                onChange={(e) => onChange("effectiveDate", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="newTitle">New Title</Label>
              <Input
                id="newTitle"
                placeholder="e.g., Senior Engineer"
                value={form.newTitle ?? ""}
                onChange={(e) => onChange("newTitle", e.target.value || undefined)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newLevel">New Level</Label>
              <Input
                id="newLevel"
                placeholder="e.g., L5"
                value={form.newLevel ?? ""}
                onChange={(e) => onChange("newLevel", e.target.value || undefined)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="additionalNotes">Additional Notes</Label>
            <Textarea
              id="additionalNotes"
              placeholder="Any special notes for the AI to consider..."
              rows={3}
              value={form.additionalNotes ?? ""}
              onChange={(e) => onChange("additionalNotes", e.target.value || undefined)}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button onClick={() => void onGenerate()} disabled={isGenerating || !form.employeeId.trim()} className="w-full">
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Generating Letter…
          </>
        ) : (
          <>
            <FileText className="mr-2 h-4 w-4" />
            Generate Letter
          </>
        )}
      </Button>
    </div>
  );
}

// ─── Letter History ─────────────────────────────────────

interface LetterHistoryProps {
  letters: CompensationLetter[];
  isLoading: boolean;
  pagination: { total: number; page: number; totalPages: number };
  onView: (letter: CompensationLetter) => void;
  onPageChange: (page: number) => void;
}

function LetterHistory({ letters, isLoading, pagination, onView, onPageChange }: LetterHistoryProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (letters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <FileText className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No letters generated yet</p>
        <p className="text-xs text-muted-foreground">Generate your first compensation letter to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="w-[80px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {letters.map((letter) => (
            <TableRow key={letter.id}>
              <TableCell className="font-medium">
                {letter.employee.firstName} {letter.employee.lastName}
                <span className="block text-xs text-muted-foreground">{letter.employee.department}</span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {letter.letterType.toLowerCase().replace(/_/g, " ")}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[200px] truncate">{letter.subject}</TableCell>
              <TableCell>
                <Badge variant={STATUS_COLORS[letter.status] as "default" | "secondary" | "destructive" | "outline"}>
                  <span className="mr-1">{getStatusIcon(letter.status)}</span>
                  {letter.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(letter.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={() => onView(letter)}>
                  <Eye className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Letter Preview ─────────────────────────────────────

interface LetterPreviewProps {
  letter: CompensationLetter;
  onBack: () => void;
  onApprove: () => Promise<void>;
}

function LetterPreview({ letter, onBack, onApprove }: LetterPreviewProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Preview Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div className="flex gap-2">
          {letter.status === "REVIEW" && (
            <Button size="sm" onClick={() => void onApprove()}>
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Approve
            </Button>
          )}
        </div>
      </div>

      {/* Letter Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{letter.subject}</CardTitle>
              <CardDescription>
                To: {letter.employee.firstName} {letter.employee.lastName} ({letter.employee.department})
              </CardDescription>
            </div>
            <Badge variant={STATUS_COLORS[letter.status] as "default" | "secondary" | "destructive" | "outline"}>
              <span className="mr-1">{getStatusIcon(letter.status)}</span>
              {letter.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="prose prose-sm max-w-none whitespace-pre-wrap">
              {letter.content}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Type:</span>{" "}
              <span className="capitalize">{letter.letterType.toLowerCase().replace(/_/g, " ")}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Tone:</span> <span className="capitalize">{letter.tone}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Generated:</span>{" "}
              {letter.generatedAt ? new Date(letter.generatedAt).toLocaleString() : "N/A"}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

