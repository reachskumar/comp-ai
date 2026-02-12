"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeft, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  mainNavItems,
  navGroups,
  settingsGroup,
  type NavGroup,
} from "@/lib/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function NavGroupSection({ group, collapsed }: { group: NavGroup; collapsed?: boolean }) {
  const pathname = usePathname();
  const isActive = group.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"));
  const [open, setOpen] = useState(isActive);

  if (collapsed) {
    return (
      <div className="relative group/nav">
        <Link
          href={group.items[0]?.href || "#"}
          aria-label={group.title}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground mx-auto",
            isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground"
          )}
        >
          <group.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${group.title} navigation group`}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground"
        )}
      >
        <group.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">{group.title}</span>
        {group.badge && (
          <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            {group.badge}
          </span>
        )}
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-in-out",
          open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div role="group" aria-label={`${group.title} links`} className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.title}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                pathname === item.href || pathname.startsWith(item.href + "/")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground"
              )}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {item.title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ collapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r bg-sidebar transition-all duration-300 ease-in-out",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo header */}
      <div className="flex h-14 items-center border-b px-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 font-semibold text-sidebar-foreground overflow-hidden"
          aria-label="Compport home"
        >
          {collapsed ? (
            <Image
              src="/compport-icon.svg"
              alt="Compport"
              width={28}
              height={34}
              className="shrink-0 mx-auto"
              priority
            />
          ) : (
            <Image
              src="/compport-logo.svg"
              alt="Compport"
              width={120}
              height={32}
              className="shrink-0"
              priority
            />
          )}
        </Link>
      </div>

      <ScrollArea className={cn("flex-1 py-3", collapsed ? "px-1.5" : "px-3")}>
        <nav aria-label="Main navigation" className="space-y-1">
          {mainNavItems.map((item) =>
            collapsed ? (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.title}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground mx-auto",
                  pathname === item.href
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.title}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  pathname === item.href
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.title}
              </Link>
            )
          )}

          <Separator className="my-3" />

          {navGroups.map((group) => (
            <NavGroupSection key={group.title} group={group} collapsed={collapsed} />
          ))}

          <Separator className="my-3" />

          <NavGroupSection group={settingsGroup} collapsed={collapsed} />
        </nav>
      </ScrollArea>

      {/* Collapse toggle */}
      {onToggleCollapse && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed ? "mx-auto" : "ml-auto"
            )}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

