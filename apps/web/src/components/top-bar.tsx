'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Menu,
  Moon,
  Sun,
  LogOut,
  Search,
  Bell,
  ChevronRight,
  CheckCheck,
  ExternalLink,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useNotifications,
  useUnreadCount,
  useMarkAsReadMutation,
  useMarkAllAsReadMutation,
} from '@/hooks/use-notifications';
import { cn } from '@/lib/utils';

interface TopBarProps {
  onToggleMobileSidebar: () => void;
}

function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length <= 1) return null;

  const crumbs = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const label = segment
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    return { label, href };
  });

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden md:flex items-center gap-1 text-sm text-muted-foreground"
    >
      {crumbs.map((crumb, index) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {index > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
          {index === crumbs.length - 1 ? (
            <span className="font-medium text-foreground">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-foreground transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

function NotificationBell() {
  const router = useRouter();
  const { data: unreadData } = useUnreadCount();
  const { data: recentData } = useNotifications({ limit: 5 });
  const markAsRead = useMarkAsReadMutation();
  const markAllAsRead = useMarkAllAsReadMutation();

  const unreadCount = unreadData?.count ?? 0;
  const notifications = recentData?.data ?? [];

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-4.5 w-4.5" aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[10px] leading-none flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                markAllAsRead.mutate();
              }}
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark all read
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          notifications.map((notif) => (
            <DropdownMenuItem
              key={notif.id}
              className={cn(
                'flex flex-col items-start gap-1 px-3 py-2 cursor-pointer',
                !notif.read && 'bg-primary/5',
              )}
              onClick={() => {
                if (!notif.read) markAsRead.mutate(notif.id);
              }}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <span
                  className={cn(
                    'text-sm font-medium leading-tight',
                    !notif.read && 'text-foreground',
                  )}
                >
                  {notif.title}
                </span>
                {!notif.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </div>
              {notif.body && (
                <span className="text-xs text-muted-foreground line-clamp-2">{notif.body}</span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {formatTime(notif.createdAt)}
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="justify-center text-sm text-primary cursor-pointer"
          onClick={() => router.push('/dashboard/notifications')}
        >
          <ExternalLink className="mr-1 h-3 w-3" />
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar({ onToggleMobileSidebar }: TopBarProps) {
  const { user, tenant, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const pathname = usePathname();

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  const isRootPath = pathname.split('/').filter(Boolean).length <= 1;

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background/80 backdrop-blur-sm px-4 lg:px-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onToggleMobileSidebar}
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>

        <Breadcrumbs />

        {tenant && isRootPath && (
          <span className="hidden lg:block text-sm text-muted-foreground">{tenant.name}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Global search */}
        <div className="hidden md:flex relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="Search..."
            aria-label="Search"
            className="w-56 pl-9 h-8 bg-muted/50 border-0 focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </div>

        {/* Notifications */}
        <NotificationBell />

        {/* Theme toggle */}
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle dark mode">
          {theme === 'dark' ? (
            <Sun className="h-4.5 w-4.5" aria-hidden="true" />
          ) : (
            <Moon className="h-4.5 w-4.5" aria-hidden="true" />
          )}
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-2 px-2" aria-label="User menu">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden lg:block text-sm font-medium">{user?.name || 'User'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{user?.name || 'User'}</span>
                <span className="text-xs text-muted-foreground">{user?.email}</span>
                {tenant && (
                  <span className="text-xs text-muted-foreground mt-0.5">{tenant.name}</span>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
