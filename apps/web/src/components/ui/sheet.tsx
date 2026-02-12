"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Sheet({ open, onOpenChange, children }: SheetProps) {
  return <>{open && <SheetContext.Provider value={{ onClose: () => onOpenChange?.(false) }}>{children}</SheetContext.Provider>}</>;
}

const SheetContext = React.createContext<{ onClose: () => void }>({ onClose: () => {} });

function SheetOverlay({ className }: { className?: string }) {
  const { onClose } = React.useContext(SheetContext);
  return (
    <div
      className={cn("fixed inset-0 z-50 bg-black/80 animate-in fade-in-0", className)}
      onClick={onClose}
    />
  );
}

interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: "left" | "right";
}

function SheetContent({ side = "left", className, children, ...props }: SheetContentProps) {
  const { onClose } = React.useContext(SheetContext);
  return (
    <>
      <SheetOverlay />
      <div
        className={cn(
          "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out",
          side === "left" && "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r",
          side === "right" && "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l",
          className
        )}
        {...props}
      >
        {children}
        <button
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
    </>
  );
}

export { Sheet, SheetContent };

