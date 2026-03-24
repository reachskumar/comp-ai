export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/40 to-violet-50/60 dark:from-slate-950 dark:via-indigo-950/30 dark:to-violet-950/20 px-4 overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-1/4 -right-1/4 w-1/2 h-1/2 rounded-full bg-indigo-400/10 dark:bg-indigo-500/5 blur-3xl" />
        <div className="absolute -bottom-1/4 -left-1/4 w-1/2 h-1/2 rounded-full bg-violet-400/10 dark:bg-violet-500/5 blur-3xl" />
        <div className="absolute top-1/3 left-1/3 w-1/3 h-1/3 rounded-full bg-primary/5 blur-3xl" />
      </div>
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
