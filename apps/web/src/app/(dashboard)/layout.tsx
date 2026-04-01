'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { Sidebar } from '@/components/sidebar';
import { TopBar } from '@/components/top-bar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { CopilotPanel } from '@/components/copilot-panel';

// ─── Copilot Panel Context ─────────────────────────────────
// Lets any child component open the copilot panel (e.g., "Ask Copilot" buttons)

interface CopilotPanelContextType {
  isOpen: boolean;
  togglePanel: () => void;
  openPanel: (initialMessage?: string) => void;
  closePanel: () => void;
}

const CopilotPanelContext = createContext<CopilotPanelContextType>({
  isOpen: false,
  togglePanel: () => {},
  openPanel: () => {},
  closePanel: () => {},
});

export function useCopilotPanel() {
  return useContext(CopilotPanelContext);
}

const STORAGE_KEY_PANEL_OPEN = 'copilot:panelOpen';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copilotPanelOpen, setCopilotPanelOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY_PANEL_OPEN) === 'true';
  });
  const [copilotInitialMessage, setCopilotInitialMessage] = useState<string | undefined>();

  // Keyboard shortcut: Cmd/Ctrl + J
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        setCopilotPanelOpen((prev) => {
          const next = !prev;
          localStorage.setItem(STORAGE_KEY_PANEL_OPEN, String(next));
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const togglePanel = useCallback(() => {
    setCopilotPanelOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY_PANEL_OPEN, String(next));
      return next;
    });
  }, []);

  const openPanel = useCallback((initialMessage?: string) => {
    setCopilotInitialMessage(initialMessage);
    setCopilotPanelOpen(true);
    localStorage.setItem(STORAGE_KEY_PANEL_OPEN, 'true');
  }, []);

  const closePanel = useCallback(() => {
    setCopilotPanelOpen(false);
    setCopilotInitialMessage(undefined);
    localStorage.setItem(STORAGE_KEY_PANEL_OPEN, 'false');
  }, []);

  const panelContext: CopilotPanelContextType = {
    isOpen: copilotPanelOpen,
    togglePanel,
    openPanel,
    closePanel,
  };

  return (
    <ProtectedRoute>
      <CopilotPanelContext.Provider value={panelContext}>
        <div className="flex h-screen overflow-hidden">
          {/* Desktop sidebar */}
          <div className="hidden lg:block">
            <Sidebar
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
          </div>

          {/* Mobile sidebar */}
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent side="left" className="w-64 p-0">
              <Sidebar />
            </SheetContent>
          </Sheet>

          {/* Main content */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar
              onToggleMobileSidebar={() => setMobileSidebarOpen(true)}
              onToggleCopilotPanel={togglePanel}
              copilotPanelOpen={copilotPanelOpen}
            />
            <div className="flex flex-1 overflow-hidden">
              <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
              {/* Copilot side panel (desktop only) */}
              <div className="relative">
                <CopilotPanel
                  open={copilotPanelOpen}
                  onClose={closePanel}
                  initialMessage={copilotInitialMessage}
                />
              </div>
            </div>
          </div>
        </div>
      </CopilotPanelContext.Provider>
    </ProtectedRoute>
  );
}
