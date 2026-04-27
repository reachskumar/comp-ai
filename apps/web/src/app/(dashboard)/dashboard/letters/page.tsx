'use client';

import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  useLetters,
  readApproval,
  type LetterType,
  type CompensationLetter,
  type GenerateLetterInput,
  type BatchProgress,
  type ApprovalState,
} from '@/hooks/use-letters';
import { useAuthStore } from '@/stores/auth-store';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Progress } from '@/components/ui/progress';

const LETTER_TYPES: { value: LetterType; label: string }[] = [
  { value: 'offer', label: 'Offer Letter' },
  { value: 'raise', label: 'Salary Raise' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'bonus', label: 'Bonus Notification' },
  { value: 'total_comp_summary', label: 'Total Rewards Statement' },
];

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'warm', label: 'Warm & Friendly' },
  { value: 'formal', label: 'Formal' },
  { value: 'celebratory', label: 'Celebratory' },
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'secondary',
  GENERATING: 'outline',
  REVIEW: 'default',
  APPROVED: 'default',
  SENT: 'default',
  FAILED: 'destructive',
};

function getStatusIcon(status: string) {
  switch (status) {
    case 'GENERATING':
      return <Loader2 className="h-3 w-3 animate-spin" />;
    case 'REVIEW':
      return <Eye className="h-3 w-3" />;
    case 'APPROVED':
      return <CheckCircle2 className="h-3 w-3" />;
    case 'SENT':
      return <Send className="h-3 w-3" />;
    case 'FAILED':
      return <AlertCircle className="h-3 w-3" />;
    default:
      return <Clock className="h-3 w-3" />;
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
    enqueueBatch,
    fetchBatchProgress,
    fetchLetters,
    submitForApproval,
    approveCurrentStep,
    rejectCurrentStep,
    clearCurrentLetter,
  } = useLetters();
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState('generate');
  const [previewLetter, setPreviewLetter] = useState<CompensationLetter | null>(null);
  // Form state
  const [form, setForm] = useState<GenerateLetterInput>({
    employeeId: '',
    letterType: 'raise',
    tone: 'professional',
    language: 'en',
  });

  // Load history when switching to history tab
  useEffect(() => {
    if (activeTab === 'history') {
      void fetchLetters();
    }
  }, [activeTab, fetchLetters]);

  // When a letter is generated, show preview
  useEffect(() => {
    if (currentLetter && !isGenerating) {
      setPreviewLetter(currentLetter);
      setActiveTab('preview');
    }
  }, [currentLetter, isGenerating]);

  const handleGenerate = useCallback(async () => {
    if (!form.employeeId.trim()) return;
    await generateLetter(form);
  }, [form, generateLetter]);

  const handleSubmit = useCallback(async () => {
    if (!previewLetter) return;
    await submitForApproval(previewLetter.id);
  }, [previewLetter, submitForApproval]);

  const handleApproveStep = useCallback(
    async (comment?: string) => {
      if (!previewLetter) return;
      await approveCurrentStep(previewLetter.id, comment);
    },
    [previewLetter, approveCurrentStep],
  );

  const handleRejectStep = useCallback(
    async (reason?: string) => {
      if (!previewLetter) return;
      await rejectCurrentStep(previewLetter.id, reason);
    },
    [previewLetter, rejectCurrentStep],
  );

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
            <h1 className="text-lg font-semibold">Letters</h1>
            <p className="text-xs text-muted-foreground">
              {isGenerating
                ? 'Generating letter…'
                : 'Generate beautiful, AI-powered compensation letters'}
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
            <TabsTrigger value="batch">
              <Users className="mr-1 h-4 w-4" />
              Batch
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

          {/* Batch Tab */}
          <TabsContent value="batch" className="flex-1 overflow-auto">
            <BatchPanel
              enqueueBatch={enqueueBatch}
              fetchBatchProgress={fetchBatchProgress}
              onJumpToHistory={(batchId) => {
                setActiveTab('history');
                void fetchLetters({ batchId });
              }}
            />
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="flex-1 overflow-auto">
            <LetterHistory
              letters={letters}
              isLoading={isLoading}
              pagination={pagination}
              onView={(letter) => {
                setPreviewLetter(letter);
                setActiveTab('preview');
              }}
              onPageChange={(page) => void fetchLetters({ page })}
            />
          </TabsContent>

          {/* Preview Tab */}
          <TabsContent value="preview" className="flex-1 overflow-auto">
            {previewLetter && (
              <LetterPreview
                letter={previewLetter}
                currentUserId={user?.id}
                currentUserRole={user?.role}
                onBack={() => {
                  setPreviewLetter(null);
                  clearCurrentLetter();
                  setActiveTab('generate');
                }}
                onSubmit={handleSubmit}
                onApprove={handleApproveStep}
                onReject={handleRejectStep}
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
  const [empSearch, setEmpSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');

  // Load employees on search (min 2 chars)
  const { data: searchResults } = useQuery({
    queryKey: ['emp-search', empSearch],
    queryFn: () =>
      apiClient.fetch<{
        data: Array<{
          id: string;
          firstName: string;
          lastName: string;
          department: string;
          level: string;
          employeeCode: string;
        }>;
      }>(`/api/v1/settings/employees?search=${encodeURIComponent(empSearch)}&limit=10`),
    enabled: empSearch.length >= 2,
    staleTime: 10000,
  });

  const employees = searchResults?.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Letter Details</CardTitle>
          <CardDescription>Search for an employee and configure the letter</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 relative">
            <Label>Employee</Label>
            <Input
              placeholder="Type a name to search (e.g. James, Sarah, Engineering...)"
              value={selectedLabel || empSearch}
              onChange={(e) => {
                setEmpSearch(e.target.value);
                setSelectedLabel('');
                setShowDropdown(true);
                if (!e.target.value) onChange('employeeId', '');
              }}
              onFocus={() => empSearch.length >= 2 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            />
            {showDropdown && employees.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto">
                {employees.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex justify-between"
                    onClick={() => {
                      onChange('employeeId', emp.id);
                      setSelectedLabel(
                        `${emp.firstName} ${emp.lastName} — ${emp.department} (${emp.level})`,
                      );
                      setShowDropdown(false);
                      setEmpSearch('');
                    }}
                  >
                    <span className="font-medium">
                      {emp.firstName} {emp.lastName}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {emp.department} · {emp.level}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {selectedLabel && <p className="text-xs text-green-600">✓ {selectedLabel}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="letterType">Letter Type</Label>
              <Select
                id="letterType"
                options={LETTER_TYPES}
                value={form.letterType}
                onChange={(e) => onChange('letterType', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tone">Tone</Label>
              <Select
                id="tone"
                options={TONE_OPTIONS}
                value={form.tone ?? 'professional'}
                onChange={(e) => onChange('tone', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">What should the letter say?</Label>
            <Textarea
              id="prompt"
              placeholder={
                'Describe what this letter should include. Examples:\n\n• "Salary raise of 15% to $180,000, effective May 1, 2026. Mention their outstanding Q1 performance and leadership on the data migration project."\n\n• "Total rewards statement showing base salary $150K, bonus $25K, RSU grant of 500 shares. Include a warm message from the CEO recognizing 5 years of service."\n\n• "Promotion to Senior Manager with 20% salary increase. Highlight their mentorship of 3 junior engineers."'
              }
              rows={6}
              value={form.additionalNotes ?? ''}
              onChange={(e) => {
                onChange('additionalNotes', e.target.value || undefined);
                // Auto-extract salary if mentioned
                const salaryMatch = e.target.value.match(/\$([0-9,]+)/);
                if (salaryMatch)
                  onChange('newSalary', parseInt(salaryMatch[1]!.replace(/,/g, ''), 10));
                const pctMatch = e.target.value.match(/(\d+)%/);
                if (pctMatch) onChange('salaryIncreasePercent', parseInt(pctMatch[1]!, 10));
              }}
            />
            <p className="text-xs text-muted-foreground">
              The AI will generate a beautifully formatted letter with company branding based on
              your instructions
            </p>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button
        onClick={() => void onGenerate()}
        disabled={isGenerating || !form.employeeId.trim()}
        className="w-full"
      >
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

function LetterHistory({
  letters,
  isLoading,
  pagination,
  onView,
  onPageChange,
}: LetterHistoryProps) {
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
        <p className="text-xs text-muted-foreground">
          Generate your first compensation letter to get started
        </p>
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
                <span className="block text-xs text-muted-foreground">
                  {letter.employee.department}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {letter.letterType.toLowerCase().replace(/_/g, ' ')}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[200px] truncate">{letter.subject}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    STATUS_COLORS[letter.status] as
                      | 'default'
                      | 'secondary'
                      | 'destructive'
                      | 'outline'
                  }
                >
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
  currentUserId?: string;
  currentUserRole?: string;
  onBack: () => void;
  onSubmit: () => Promise<void>;
  onApprove: (comment?: string) => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

function LetterPreview({
  letter,
  currentUserId,
  currentUserRole,
  onBack,
  onSubmit,
  onApprove,
  onReject,
}: LetterPreviewProps) {
  const approval = readApproval(letter);
  const [busy, setBusy] = useState<'submit' | 'approve' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const isAuthor = currentUserId === letter.userId;
  const inApprovalFlow =
    letter.status === 'REVIEW' &&
    approval &&
    !approval.rejected &&
    approval.currentStep < approval.chain.length;
  const currentStep = inApprovalFlow ? approval!.chain[approval!.currentStep] : null;
  const canActOnCurrentStep =
    !!currentStep &&
    !isAuthor &&
    (currentUserRole === 'PLATFORM_ADMIN' ||
      currentUserRole?.toLowerCase() === currentStep.role.toLowerCase());

  const runAction = async (kind: 'submit' | 'approve' | 'reject', op: () => Promise<void>) => {
    setBusy(kind);
    setActionError(null);
    try {
      await op();
      setShowRejectInput(false);
      setRejectReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Preview Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void (async () => {
                try {
                  const { blob, fileName } = await apiClient.fetchBlob(
                    `/api/v1/letters/${letter.id}/pdf`,
                  );
                  const empF = letter.employee?.firstName ?? '';
                  const empL = letter.employee?.lastName ?? '';
                  const lt = letter.letterType?.toLowerCase().replace(/_/g, '-') ?? 'letter';
                  const fallback = `${empF}_${empL}_${lt}.pdf`;
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = fileName ?? fallback;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  console.error('PDF download failed', err);
                  alert(err instanceof Error ? err.message : 'PDF download failed');
                }
              })();
            }}
          >
            <Download className="mr-1 h-4 w-4" />
            Download PDF
          </Button>
          {letter.status === 'REVIEW' && !approval && (
            <Button
              size="sm"
              disabled={busy !== null || isAuthor === false}
              onClick={() => void runAction('submit', () => onSubmit())}
            >
              {busy === 'submit' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              Submit for approval
            </Button>
          )}
          {letter.status === 'REVIEW' && approval?.rejected && isAuthor && (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => void runAction('submit', () => onSubmit())}
            >
              {busy === 'submit' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              Resubmit
            </Button>
          )}
          {inApprovalFlow && canActOnCurrentStep && (
            <>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => void runAction('approve', () => onApprove())}
              >
                {busy === 'approve' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                )}
                Approve step
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setShowRejectInput((v) => !v)}
              >
                <AlertCircle className="mr-1 h-4 w-4" />
                Reject…
              </Button>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <Card className="border-destructive">
          <CardContent className="py-3 text-sm text-destructive">{actionError}</CardContent>
        </Card>
      )}

      {showRejectInput && inApprovalFlow && canActOnCurrentStep && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <Label htmlFor="reject-reason">Rejection reason</Label>
            <Textarea
              id="reject-reason"
              rows={2}
              placeholder="Explain why you're rejecting this step (recommended)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={2000}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowRejectInput(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy !== null}
                onClick={() => void runAction('reject', () => onReject(rejectReason || undefined))}
              >
                {busy === 'reject' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <AlertCircle className="mr-1 h-4 w-4" />
                )}
                Confirm reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {approval && approval.chain.length > 0 && (
        <ApprovalChainCard approval={approval} letterApproved={letter.status === 'APPROVED'} />
      )}

      {/* Letter Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{letter.subject}</CardTitle>
              <CardDescription>
                To: {letter.employee.firstName} {letter.employee.lastName} (
                {letter.employee.department})
              </CardDescription>
            </div>
            <Badge
              variant={
                STATUS_COLORS[letter.status] as 'default' | 'secondary' | 'destructive' | 'outline'
              }
            >
              <span className="mr-1">{getStatusIcon(letter.status)}</span>
              {letter.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {letter.content.includes('<div') || letter.content.includes('<p') ? (
              <div dangerouslySetInnerHTML={{ __html: letter.content }} />
            ) : (
              <div className="prose prose-sm max-w-none whitespace-pre-wrap">{letter.content}</div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Type:</span>{' '}
              <span className="capitalize">
                {letter.letterType.toLowerCase().replace(/_/g, ' ')}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Tone:</span>{' '}
              <span className="capitalize">{letter.tone}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Generated:</span>{' '}
              {letter.generatedAt ? new Date(letter.generatedAt).toLocaleString() : 'N/A'}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Batch Panel ──────────────────────────────────────────────────────────

interface BatchPanelProps {
  enqueueBatch: (input: {
    employeeIds: string[];
    letterType: LetterType;
    salaryIncreasePercent?: number;
    bonusAmount?: number;
    effectiveDate?: string;
    tone?: string;
    language?: string;
    additionalNotes?: string;
  }) => Promise<{ batchId: string; total: number }>;
  fetchBatchProgress: (batchId: string) => Promise<BatchProgress>;
  onJumpToHistory: (batchId: string) => void;
}

const BATCH_POLL_MS = 2000;

function parseEmployeeIds(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

function BatchPanel({ enqueueBatch, fetchBatchProgress, onJumpToHistory }: BatchPanelProps) {
  const [employeeIdsText, setEmployeeIdsText] = useState('');
  const [letterType, setLetterType] = useState<LetterType>('raise');
  const [tone, setTone] = useState('professional');
  const [percent, setPercent] = useState<string>('');
  const [bonus, setBonus] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState<BatchProgress | null>(null);

  const employeeIds = parseEmployeeIds(employeeIdsText);
  const canSubmit = employeeIds.length > 0 && employeeIds.length <= 100 && !submitting;

  const startBatch = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await enqueueBatch({
        employeeIds,
        letterType,
        salaryIncreasePercent: percent ? Number(percent) : undefined,
        bonusAmount: bonus ? Number(bonus) : undefined,
        effectiveDate: effectiveDate || undefined,
        tone,
        additionalNotes: notes || undefined,
      });
      setBatchId(res.batchId);
      setProgress(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to enqueue batch');
    } finally {
      setSubmitting(false);
    }
  };

  // Poll progress while a batch is in flight.
  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchBatchProgress(batchId);
        if (cancelled) return;
        setProgress(next);
        if (!next.done) {
          setTimeout(() => void tick(), BATCH_POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setSubmitError(err instanceof Error ? err.message : 'Progress check failed');
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [batchId, fetchBatchProgress]);

  const reset = () => {
    setBatchId(null);
    setProgress(null);
    setSubmitError(null);
  };

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.seen / progress.total) * 100))
      : (progress?.progress ?? 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Batch Letter Generation
          </CardTitle>
          <CardDescription>
            Generate letters for up to 100 employees at once. The job runs in the background — you
            can navigate away and come back.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="batch-emp-ids">
              Employee IDs (one per line, or comma-separated)
              <span className="ml-2 text-xs text-muted-foreground">
                {employeeIds.length} parsed
                {employeeIds.length > 100 && (
                  <span className="ml-2 text-destructive">— max 100 per batch</span>
                )}
              </span>
            </Label>
            <Textarea
              id="batch-emp-ids"
              rows={5}
              placeholder="emp-001&#10;emp-002&#10;emp-003"
              value={employeeIdsText}
              onChange={(e) => setEmployeeIdsText(e.target.value)}
              disabled={Boolean(batchId)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="batch-type">Letter type</Label>
              <Select
                id="batch-type"
                value={letterType}
                onChange={(e) => setLetterType(e.target.value as LetterType)}
                disabled={Boolean(batchId)}
                options={LETTER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-tone">Tone</Label>
              <Select
                id="batch-tone"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                disabled={Boolean(batchId)}
                options={TONE_OPTIONS}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-pct">Increase %</Label>
              <Input
                id="batch-pct"
                type="number"
                step="0.1"
                placeholder="e.g. 5"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                disabled={Boolean(batchId)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-bonus">Bonus amount</Label>
              <Input
                id="batch-bonus"
                type="number"
                placeholder="e.g. 5000"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
                disabled={Boolean(batchId)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="batch-eff">Effective date</Label>
              <Input
                id="batch-eff"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                disabled={Boolean(batchId)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="batch-notes">Additional notes (applied to every letter)</Label>
              <Textarea
                id="batch-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={Boolean(batchId)}
              />
            </div>
          </div>

          {submitError && (
            <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {submitError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            {batchId && (
              <Button variant="outline" onClick={reset} disabled={progress?.done === false}>
                Start another
              </Button>
            )}
            <Button onClick={() => void startBatch()} disabled={!canSubmit || Boolean(batchId)}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enqueuing…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Enqueue {employeeIds.length || ''} letter{employeeIds.length === 1 ? '' : 's'}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {batchId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {progress?.done ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              Batch <span className="font-mono text-xs text-muted-foreground">{batchId}</span>
            </CardTitle>
            <CardDescription>
              {progress?.done
                ? `Done. ${progress.succeeded} succeeded, ${progress.failed} failed.`
                : `Job state: ${progress?.jobState ?? 'queued'}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={pct} />
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-xs text-muted-foreground">Succeeded</div>
                <div className="text-lg font-semibold text-emerald-600">
                  {progress?.succeeded ?? 0}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-xs text-muted-foreground">In flight</div>
                <div className="text-lg font-semibold">{progress?.inFlight ?? 0}</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-xs text-muted-foreground">Failed</div>
                <div className="text-lg font-semibold text-destructive">
                  {progress?.failed ?? 0}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => onJumpToHistory(batchId)}>
                View letters
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Approval Chain Card ──────────────────────────────────

interface ApprovalChainCardProps {
  approval: ApprovalState;
  letterApproved: boolean;
}

function ApprovalChainCard({ approval, letterApproved }: ApprovalChainCardProps) {
  const decisionByStep = new Map(approval.decisions.map((d) => [d.stepIndex, d]));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Approval chain</CardTitle>
        <CardDescription>
          {approval.rejected
            ? 'Rejected — author must resubmit to restart the chain.'
            : letterApproved
              ? 'All steps approved.'
              : `Step ${Math.min(approval.currentStep + 1, approval.chain.length)} of ${approval.chain.length}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {approval.chain.map((step, idx) => {
          const decision = decisionByStep.get(idx);
          const isCurrent = !approval.rejected && !letterApproved && idx === approval.currentStep;
          const isDone = !!decision || (letterApproved && idx < approval.chain.length);
          const isRejected = decision?.decision === 'REJECTED';
          return (
            <div
              key={idx}
              className={
                'flex items-start gap-3 rounded-md border p-3 ' +
                (isCurrent ? 'border-primary bg-primary/5' : '')
              }
            >
              <div
                className={
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ' +
                  (isRejected
                    ? 'bg-destructive/10 text-destructive'
                    : isDone
                      ? 'bg-emerald-100 text-emerald-700'
                      : isCurrent
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground')
                }
              >
                {isRejected ? (
                  <AlertCircle className="h-4 w-4" />
                ) : isDone ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  idx + 1
                )}
              </div>
              <div className="flex-1 space-y-0.5">
                <div className="text-sm font-medium">{step.label}</div>
                <div className="text-xs text-muted-foreground">Role: {step.role}</div>
                {decision && (
                  <div className="mt-1 text-xs">
                    <span
                      className={
                        decision.decision === 'APPROVED' ? 'text-emerald-600' : 'text-destructive'
                      }
                    >
                      {decision.decision === 'APPROVED' ? 'Approved' : 'Rejected'}
                    </span>{' '}
                    by {decision.decidedByName} · {new Date(decision.decidedAt).toLocaleString()}
                    {decision.comment && (
                      <div className="mt-1 italic text-muted-foreground">
                        &ldquo;{decision.comment}&rdquo;
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
