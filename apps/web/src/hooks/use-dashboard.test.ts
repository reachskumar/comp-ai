import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useDashboardSummary, type DashboardSummary } from "./use-dashboard";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    fetch: vi.fn(),
  },
}));

import { apiClient } from "@/lib/api-client";

const mockSummary: DashboardSummary = {
  totalEmployees: 150,
  activeCycles: 3,
  complianceScore: 87,
  pendingAnomalies: 5,
  recentImports: 2,
  recentActivity: [
    {
      id: "act-1",
      action: "IMPORT_COMPLETED",
      entityType: "import",
      entityId: "imp-1",
      userName: "Admin",
      createdAt: "2026-01-15T10:00:00Z",
    },
  ],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useDashboardSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch dashboard summary successfully", async () => {
    vi.mocked(apiClient.fetch).mockResolvedValue(mockSummary);

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockSummary);
    expect(apiClient.fetch).toHaveBeenCalledWith("/api/v1/dashboard/summary");
  });

  it("should handle API errors", async () => {
    vi.mocked(apiClient.fetch).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("Network error");
  });
});

