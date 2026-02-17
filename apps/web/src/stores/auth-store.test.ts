import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuthStore } from "./auth-store";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    login: vi.fn(),
    register: vi.fn(),
    clearTokens: vi.fn(),
    fetch: vi.fn(),
  },
}));

import { apiClient } from "@/lib/api-client";

const mockUser = { id: "user-1", email: "test@example.com", name: "Test User", role: "admin" };
const mockTenant = { id: "tenant-1", name: "Test Corp", slug: "test-corp" };

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, tenant: null, isAuthenticated: false, isLoading: true });
    localStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true, configurable: true });
  });

  describe("initial state", () => {
    it("should have correct initial state", () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.tenant).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(true);
    });
  });

  describe("login", () => {
    it("should set user and tokens on successful login", async () => {
      vi.mocked(apiClient.login).mockResolvedValue({
        accessToken: "access-123",
        refreshToken: "refresh-123",
        user: mockUser,
      });

      await useAuthStore.getState().login("test@example.com", "password");

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(localStorage.getItem("accessToken")).toBe("access-123");
      expect(localStorage.getItem("refreshToken")).toBe("refresh-123");
      expect(localStorage.getItem("user")).toBe(JSON.stringify(mockUser));
    });

    it("should propagate errors from apiClient.login", async () => {
      vi.mocked(apiClient.login).mockRejectedValue(new Error("Invalid credentials"));
      await expect(useAuthStore.getState().login("bad@example.com", "wrong")).rejects.toThrow("Invalid credentials");
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe("register", () => {
    it("should set user, tenant, and tokens on successful registration", async () => {
      vi.mocked(apiClient.register).mockResolvedValue({
        accessToken: "access-456",
        refreshToken: "refresh-456",
        user: mockUser,
        tenant: mockTenant,
      });

      await useAuthStore.getState().register({
        email: "test@example.com",
        password: "password",
        name: "Test User",
        tenantName: "Test Corp",
      });

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.tenant).toEqual(mockTenant);
      expect(state.isAuthenticated).toBe(true);
      expect(localStorage.getItem("accessToken")).toBe("access-456");
      expect(localStorage.getItem("tenant")).toBe(JSON.stringify(mockTenant));
    });
  });

  describe("logout", () => {
    it("should clear state and tokens on logout", () => {
      useAuthStore.setState({ user: mockUser, tenant: mockTenant, isAuthenticated: true, isLoading: false });
      localStorage.setItem("accessToken", "token");
      localStorage.setItem("user", JSON.stringify(mockUser));

      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.tenant).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(apiClient.clearTokens).toHaveBeenCalled();
      expect(localStorage.getItem("user")).toBeNull();
      expect(localStorage.getItem("tenant")).toBeNull();
    });

    it("should redirect to /login", () => {
      useAuthStore.getState().logout();
      expect(window.location.href).toBe("/login");
    });
  });

  describe("hydrate", () => {
    it("should restore user from localStorage when token exists", () => {
      localStorage.setItem("accessToken", "token-abc");
      localStorage.setItem("user", JSON.stringify(mockUser));
      localStorage.setItem("tenant", JSON.stringify(mockTenant));

      useAuthStore.getState().hydrate();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.tenant).toEqual(mockTenant);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it("should set isLoading false when no token exists", () => {
      useAuthStore.getState().hydrate();
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it("should handle invalid JSON in localStorage gracefully", () => {
      localStorage.setItem("accessToken", "token-abc");
      localStorage.setItem("user", "not-valid-json");

      useAuthStore.getState().hydrate();

      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isAuthenticated).toBe(false);
    });
  });
});

