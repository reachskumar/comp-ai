"use client";

import * as React from "react";
import {
  HeartPulse,
  Shield,
  Eye,
  Users,
  FileText,
  Calendar,
  CheckCircle,
  Clock,
  ChevronRight,
  Plus,
  DollarSign,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  useBenefitPlans,
  usePlanDetail,
  useEnrollments,
  useDependents,
  useLifeEvents,
  useEnrollmentWindows,
  useCreateEnrollmentMutation,
  useCreateDependentMutation,
  useFileLifeEventMutation,
  type BenefitPlan,
  type BenefitTier,
  type BenefitPlanType,
  type DependentRelationship,
  type LifeEventType,
} from "@/hooks/use-benefits";

// ─── Helpers ──────────────────────────────────────────────

const PLAN_TYPE_ICONS: Record<string, React.ElementType> = {
  MEDICAL: HeartPulse,
  DENTAL: Shield,
  VISION: Eye,
  LIFE: FileText,
  DISABILITY: FileText,
};

const PLAN_TYPE_LABELS: Record<string, string> = {
  MEDICAL: "Medical",
  DENTAL: "Dental",
  VISION: "Vision",
  LIFE: "Life Insurance",
  DISABILITY: "Disability",
};

const TIER_LABELS: Record<string, string> = {
  EMPLOYEE: "Employee Only",
  EMPLOYEE_SPOUSE: "Employee + Spouse",
  EMPLOYEE_CHILDREN: "Employee + Children",
  FAMILY: "Family",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "default",
  PENDING: "secondary",
  TERMINATED: "destructive",
  WAIVED: "outline",
  APPROVED: "default",
  DENIED: "destructive",
};

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Enrollment Wizard Steps ──────────────────────────────
const WIZARD_STEPS = [
  { label: "Select Plan", icon: HeartPulse },
  { label: "Choose Tier", icon: Users },
  { label: "Add Dependents", icon: Plus },
  { label: "Review & Confirm", icon: CheckCircle },
];

// ─── Main Page ────────────────────────────────────────────

export default function HealthInsurancePage() {
  const [tab, setTab] = React.useState("plans");
  const [enrollDialogOpen, setEnrollDialogOpen] = React.useState(false);
  const [lifeEventDialogOpen, setLifeEventDialogOpen] = React.useState(false);
  const [selectedPlanId, setSelectedPlanId] = React.useState<string | null>(null);

  // Data hooks
  const { data: plans, isLoading: plansLoading } = useBenefitPlans();
  const { data: enrollments } = useEnrollments();
  const { data: lifeEvents } = useLifeEvents();
  const { data: windows } = useEnrollmentWindows();

  const activeWindow = windows?.find((w) => w.status === "OPEN");
  const daysLeft = activeWindow
    ? Math.max(0, Math.ceil((new Date(activeWindow.endDate).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Health &amp; Insurance
          </h1>
          <p className="text-muted-foreground">
            Manage benefit plans, enrollment, dependents, and life events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeWindow && (
            <Badge variant="default" className="text-xs">
              <Calendar className="mr-1 h-3 w-3" />
              Open Enrollment · {daysLeft} days left
            </Badge>
          )}
          <Button size="sm" onClick={() => setEnrollDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Enroll
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Enrollments</CardDescription>
            <CardTitle className="text-2xl">
              {enrollments?.data.filter((e) => e.status === "ACTIVE").length ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {enrollments?.total ?? 0} total enrollments
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Available Plans</CardDescription>
            <CardTitle className="text-2xl">
              {plans?.length ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Across all benefit types</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending Life Events</CardDescription>
            <CardTitle className="text-2xl">
              {lifeEvents?.filter((e) => e.status === "PENDING").length ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Awaiting review</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Enrollment Window</CardDescription>
            <CardTitle className="text-2xl">
              {activeWindow ? "Open" : "Closed"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeWindow ? (
              <Progress value={Math.max(0, 100 - (daysLeft ?? 0) * (100 / 30))} className="h-2" />
            ) : (
              <p className="text-xs text-muted-foreground">No active window</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="plans">Plan Catalog</TabsTrigger>
          <TabsTrigger value="enrollment">My Enrollments</TabsTrigger>
          <TabsTrigger value="dependents">Dependents</TabsTrigger>
          <TabsTrigger value="life-events">Life Events</TabsTrigger>
        </TabsList>

        {/* ─── Plan Catalog Tab ─── */}
        <TabsContent value="plans" className="space-y-4">
          {plansLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((k) => (
                <Card key={k}>
                  <CardContent className="py-8">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                    <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : plans && plans.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => {
                const Icon = PLAN_TYPE_ICONS[plan.planType] ?? HeartPulse;
                const employeePremium = plan.premiums?.EMPLOYEE ?? 0;
                return (
                  <Card
                    key={plan.id}
                    className="cursor-pointer transition-shadow hover:shadow-md"
                    onClick={() => setSelectedPlanId(plan.id)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                            <Icon className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <CardTitle className="text-base">{plan.name}</CardTitle>
                            <CardDescription className="text-xs">
                              {plan.carrier} · {plan.network ?? "N/A"}
                            </CardDescription>
                          </div>
                        </div>
                        <Badge variant="secondary">
                          {PLAN_TYPE_LABELS[plan.planType] ?? plan.planType}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {plan.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {plan.description}
                        </p>
                      )}
                      <Separator />
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-muted-foreground text-xs">Employee Monthly</p>
                          <p className="font-semibold">{fmtCurrency(employeePremium * 0.2)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">Deductible</p>
                          <p className="font-semibold">
                            {fmtCurrency(plan.deductibles?.INDIVIDUAL ?? 0)}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPlanId(plan.id);
                          setEnrollDialogOpen(true);
                        }}
                      >
                        Enroll in Plan <ChevronRight className="ml-1 h-3 w-3" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <HeartPulse className="h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Plans Available</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Benefit plans will appear here once configured by your administrator.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Enrollments Tab ─── */}
        <TabsContent value="enrollment" className="space-y-4">
          {enrollments && enrollments.data.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Current Enrollments</CardTitle>
                <CardDescription>Your active and pending benefit enrollments</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Employee Premium</TableHead>
                      <TableHead>Effective Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollments.data.map((enrollment) => (
                      <TableRow key={enrollment.id}>
                        <TableCell className="font-medium">
                          {enrollment.plan?.name ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {PLAN_TYPE_LABELS[enrollment.plan?.planType ?? ""] ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell>{TIER_LABELS[enrollment.tier] ?? enrollment.tier}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[enrollment.status] ?? "secondary"}>
                            {enrollment.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{fmtCurrency(enrollment.employeePremium)}/mo</TableCell>
                        <TableCell>{fmtDate(enrollment.effectiveDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <DollarSign className="h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Enrollments Yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enroll in a benefit plan to get started.
                </p>
                <Button className="mt-4" onClick={() => setEnrollDialogOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Start Enrollment
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Dependents Tab ─── */}
        <TabsContent value="dependents">
          <DependentsSection />
        </TabsContent>

        {/* ─── Life Events Tab ─── */}
        <TabsContent value="life-events" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Life Events</h3>
              <p className="text-sm text-muted-foreground">
                Report qualifying life events for special enrollment periods.
              </p>
            </div>
            <Button size="sm" onClick={() => setLifeEventDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> File Life Event
            </Button>
          </div>
          {lifeEvents && lifeEvents.length > 0 ? (
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event Type</TableHead>
                      <TableHead>Event Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lifeEvents.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="font-medium">
                          {event.eventType.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell>{fmtDate(event.eventDate)}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[event.status] ?? "secondary"}>
                            {event.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {event.description ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Calendar className="h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Life Events</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  File a life event to qualify for a special enrollment period.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Enrollment Wizard Dialog */}
      <EnrollmentWizardDialog
        open={enrollDialogOpen}
        onOpenChange={setEnrollDialogOpen}
        plans={plans ?? []}
        initialPlanId={selectedPlanId}
      />

      {/* Life Event Dialog */}
      <LifeEventDialog
        open={lifeEventDialogOpen}
        onOpenChange={setLifeEventDialogOpen}
      />
    </div>
  );
}

// ─── Dependents Section ──────────────────────────────────

function DependentsSection() {
  const [addOpen, setAddOpen] = React.useState(false);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [relationship, setRelationship] = React.useState<DependentRelationship>("SPOUSE");
  const [dob, setDob] = React.useState("");
  const [ssn, setSsn] = React.useState("");
  const { toast } = useToast();
  const createDependent = useCreateDependentMutation();

  // In a real app, employeeId would come from auth context
  const employeeId = "current-employee";
  const { data: dependents } = useDependents(employeeId);

  const handleAdd = () => {
    if (!firstName || !lastName || !dob) return;
    createDependent.mutate(
      {
        employeeId,
        firstName,
        lastName,
        relationship,
        dateOfBirth: new Date(dob).toISOString(),
        ssn: ssn || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "Dependent added", description: `${firstName} ${lastName} was added successfully.` });
          setAddOpen(false);
          setFirstName("");
          setLastName("");
          setSsn("");
          setDob("");
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Dependents</h3>
          <p className="text-sm text-muted-foreground">Manage dependents covered under your plans.</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add Dependent
        </Button>
      </div>

      {dependents && dependents.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Date of Birth</TableHead>
                  <TableHead>SSN</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dependents.map((dep) => (
                  <TableRow key={dep.id}>
                    <TableCell className="font-medium">
                      {dep.firstName} {dep.lastName}
                    </TableCell>
                    <TableCell>{dep.relationship}</TableCell>
                    <TableCell>{fmtDate(dep.dateOfBirth)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {dep.ssnMasked ?? "Not provided"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">No Dependents</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Add dependents to include them in your benefit coverage.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Add Dependent Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Dependent</DialogTitle>
            <DialogDescription>
              Add a family member to your benefits coverage. SSN is encrypted and stored securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dep-first">First Name</Label>
                <Input id="dep-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dep-last">Last Name</Label>
                <Input id="dep-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dep-rel">Relationship</Label>
              <Select
                id="dep-rel"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value as DependentRelationship)}
                options={[
                  { value: "SPOUSE", label: "Spouse" },
                  { value: "CHILD", label: "Child" },
                  { value: "DOMESTIC_PARTNER", label: "Domestic Partner" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dep-dob">Date of Birth</Label>
              <Input id="dep-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dep-ssn">SSN (optional)</Label>
              <Input
                id="dep-ssn"
                placeholder="XXX-XX-XXXX"
                value={ssn}
                onChange={(e) => setSsn(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                <Shield className="mr-1 inline h-3 w-3" />
                Encrypted with AES-256-GCM. Never stored in plain text.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={createDependent.isPending}>
              {createDependent.isPending ? "Adding..." : "Add Dependent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// ─── Enrollment Wizard Dialog ─────────────────────────────

function EnrollmentWizardDialog({
  open,
  onOpenChange,
  plans,
  initialPlanId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: BenefitPlan[];
  initialPlanId: string | null;
}) {
  const [step, setStep] = React.useState(0);
  const [planId, setPlanId] = React.useState<string>("");
  const [tier, setTier] = React.useState<BenefitTier>("EMPLOYEE");
  const [selectedDeps, setSelectedDeps] = React.useState<string[]>([]);
  const { toast } = useToast();
  const createEnrollment = useCreateEnrollmentMutation();
  const employeeId = "current-employee";
  const { data: dependents } = useDependents(employeeId);

  React.useEffect(() => {
    if (open && initialPlanId) {
      setPlanId(initialPlanId);
      setStep(1); // Skip to tier selection
    } else if (open) {
      setStep(0);
      setPlanId("");
    }
  }, [open, initialPlanId]);

  const selectedPlan = plans.find((p) => p.id === planId);
  const premiums = selectedPlan?.premiums ?? {};
  const tierPremium = premiums[tier] ?? 0;
  const employeeCost = Math.round(tierPremium * 0.2 * 100) / 100;
  const employerCost = Math.round(tierPremium * 0.8 * 100) / 100;

  const handleSubmit = () => {
    if (!planId || !tier) return;
    createEnrollment.mutate(
      {
        employeeId,
        planId,
        tier,
        effectiveDate: new Date().toISOString(),
        dependentIds: selectedDeps.length > 0 ? selectedDeps : undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "Enrollment submitted", description: "Your enrollment is pending approval." });
          onOpenChange(false);
          setStep(0);
          setPlanId("");
          setTier("EMPLOYEE");
          setSelectedDeps([]);
        },
        onError: (err) => {
          toast({ title: "Enrollment failed", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const canNext =
    (step === 0 && !!planId) ||
    (step === 1 && !!tier) ||
    step === 2 ||
    step === 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Benefit Enrollment</DialogTitle>
          <DialogDescription>
            Complete the steps below to enroll in a benefit plan.
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 py-2">
          {WIZARD_STEPS.map((s, i) => (
            <React.Fragment key={s.label}>
              <div
                className={`flex items-center gap-1.5 text-xs font-medium ${
                  i <= step ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    i < step
                      ? "bg-primary text-primary-foreground"
                      : i === step
                        ? "border-2 border-primary text-primary"
                        : "border border-muted-foreground text-muted-foreground"
                  }`}
                >
                  {i < step ? <CheckCircle className="h-3 w-3" /> : i + 1}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < WIZARD_STEPS.length - 1 && (
                <div className={`h-px flex-1 ${i < step ? "bg-primary" : "bg-muted"}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        <Separator />

        {/* Step Content */}
        <div className="min-h-[200px] py-4">
          {step === 0 && (
            <div className="space-y-3">
              <Label>Select a Plan</Label>
              <div className="grid gap-2">
                {plans.map((plan) => {
                  const Icon = PLAN_TYPE_ICONS[plan.planType] ?? HeartPulse;
                  return (
                    <div
                      key={plan.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                        planId === plan.id
                          ? "border-primary bg-primary/5"
                          : "hover:border-primary/50"
                      }`}
                      onClick={() => setPlanId(plan.id)}
                    >
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{plan.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {plan.carrier} · {PLAN_TYPE_LABELS[plan.planType]}
                        </p>
                      </div>
                      <Badge variant="outline">{fmtCurrency(plan.premiums?.EMPLOYEE ?? 0)}/mo</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <Label>Choose Coverage Tier</Label>
              <p className="text-sm text-muted-foreground">
                Select who will be covered under <strong>{selectedPlan?.name}</strong>.
              </p>
              <div className="grid gap-2">
                {(Object.keys(TIER_LABELS) as BenefitTier[]).map((t) => {
                  const tPremium = premiums[t] ?? 0;
                  const eCost = Math.round(tPremium * 0.2 * 100) / 100;
                  return (
                    <div
                      key={t}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
                        tier === t ? "border-primary bg-primary/5" : "hover:border-primary/50"
                      }`}
                      onClick={() => setTier(t)}
                    >
                      <div>
                        <p className="text-sm font-medium">{TIER_LABELS[t]}</p>
                        <p className="text-xs text-muted-foreground">
                          Total: {fmtCurrency(tPremium)}/mo
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-primary">{fmtCurrency(eCost)}/mo</p>
                        <p className="text-xs text-muted-foreground">Your cost</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Label>Add Dependents (Optional)</Label>
              <p className="text-sm text-muted-foreground">
                Select dependents to include in your coverage.
              </p>
              {dependents && dependents.length > 0 ? (
                <div className="grid gap-2">
                  {dependents.map((dep) => {
                    const isSelected = selectedDeps.includes(dep.id);
                    return (
                      <div
                        key={dep.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                          isSelected ? "border-primary bg-primary/5" : "hover:border-primary/50"
                        }`}
                        onClick={() =>
                          setSelectedDeps((prev) =>
                            isSelected ? prev.filter((id) => id !== dep.id) : [...prev, dep.id]
                          )
                        }
                      >
                        <div className={`flex h-5 w-5 items-center justify-center rounded border ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"}`}>
                          {isSelected && <CheckCircle className="h-3 w-3" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{dep.firstName} {dep.lastName}</p>
                          <p className="text-xs text-muted-foreground">{dep.relationship}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <Users className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    No dependents added yet. You can skip this step or add dependents from the Dependents tab.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Label>Review &amp; Confirm</Label>
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Plan</span>
                    <span className="text-sm font-medium">{selectedPlan?.name}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Carrier</span>
                    <span className="text-sm">{selectedPlan?.carrier}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Coverage Tier</span>
                    <span className="text-sm">{TIER_LABELS[tier]}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Dependents</span>
                    <span className="text-sm">{selectedDeps.length || "None"}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Your Monthly Cost</span>
                    <span className="text-lg font-bold text-primary">{fmtCurrency(employeeCost)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Employer Contribution</span>
                    <span className="text-sm font-medium text-green-600">{fmtCurrency(employerCost)}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Annual Cost (You)</span>
                    <span className="text-sm font-semibold">{fmtCurrency(employeeCost * 12)}/yr</span>
                  </div>
                </CardContent>
              </Card>
              <div className="flex items-start gap-2 rounded-lg bg-muted p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  By confirming, you agree to enroll in this plan. Your enrollment will be reviewed
                  and you will be notified once approved.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => (step > 0 ? setStep(step - 1) : onOpenChange(false))}
          >
            {step > 0 ? "Back" : "Cancel"}
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={createEnrollment.isPending}>
              {createEnrollment.isPending ? "Submitting..." : "Confirm Enrollment"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Life Event Dialog ────────────────────────────────────

function LifeEventDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [eventType, setEventType] = React.useState<LifeEventType>("MARRIAGE");
  const [eventDate, setEventDate] = React.useState("");
  const [description, setDescription] = React.useState("");
  const { toast } = useToast();
  const fileEvent = useFileLifeEventMutation();
  const employeeId = "current-employee";

  const handleSubmit = () => {
    if (!eventDate) return;
    fileEvent.mutate(
      {
        employeeId,
        eventType,
        eventDate: new Date(eventDate).toISOString(),
        qualifyingDate: new Date(eventDate).toISOString(),
        description: description || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "Life event filed", description: "Your life event has been submitted for review." });
          onOpenChange(false);
          setEventDate("");
          setDescription("");
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File a Life Event</DialogTitle>
          <DialogDescription>
            Report a qualifying life event to request a special enrollment period.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="le-type">Event Type</Label>
            <Select
              id="le-type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as LifeEventType)}
              options={[
                { value: "MARRIAGE", label: "Marriage" },
                { value: "BIRTH", label: "Birth of Child" },
                { value: "ADOPTION", label: "Adoption" },
                { value: "DIVORCE", label: "Divorce" },
                { value: "LOSS_OF_COVERAGE", label: "Loss of Coverage" },
                { value: "ADDRESS_CHANGE", label: "Address Change" },
              ]}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="le-date">Event Date</Label>
            <Input
              id="le-date"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="le-desc">Description (optional)</Label>
            <Input
              id="le-desc"
              placeholder="Provide additional details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!eventDate || fileEvent.isPending}>
            {fileEvent.isPending ? "Submitting..." : "Submit Life Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}