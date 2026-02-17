import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProtectedRoute } from "./protected-route";
import { useAuthStore } from "@/stores/auth-store";

// Mock next/navigation
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock the api-client (needed by auth-store)
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    login: vi.fn(),
    register: vi.fn(),
    clearTokens: vi.fn(),
    fetch: vi.fn(),
  },
}));

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show loading spinner when isLoading is true", () => {
    useAuthStore.setState({ isLoading: true, isAuthenticated: false, user: null, tenant: null });

    const { container } = render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    // Check for the spinner element
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("should render children when authenticated", () => {
    useAuthStore.setState({ isLoading: false, isAuthenticated: true, user: { id: "1", email: "a@b.com", name: "A", role: "admin" }, tenant: null });

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("should redirect to /login when not authenticated and not loading", () => {
    useAuthStore.setState({ isLoading: false, isAuthenticated: false, user: null, tenant: null });

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });
});

