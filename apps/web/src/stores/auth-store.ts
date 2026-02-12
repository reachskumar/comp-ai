import { create } from "zustand";
import { apiClient } from "@/lib/api-client";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
}

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name: string; tenantName: string }) => Promise<void>;
  logout: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email, password) => {
    const data = await apiClient.login(email, password);
    localStorage.setItem("accessToken", data.accessToken);
    localStorage.setItem("refreshToken", data.refreshToken);
    localStorage.setItem("user", JSON.stringify(data.user));
    set({ user: data.user, isAuthenticated: true, isLoading: false });
  },

  register: async (input) => {
    const data = await apiClient.register(input);
    localStorage.setItem("accessToken", data.accessToken);
    localStorage.setItem("refreshToken", data.refreshToken);
    localStorage.setItem("user", JSON.stringify(data.user));
    if (data.tenant) {
      localStorage.setItem("tenant", JSON.stringify(data.tenant));
    }
    set({ user: data.user, tenant: data.tenant, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    apiClient.clearTokens();
    localStorage.removeItem("user");
    localStorage.removeItem("tenant");
    set({ user: null, tenant: null, isAuthenticated: false, isLoading: false });
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  },

  hydrate: () => {
    if (typeof window === "undefined") {
      set({ isLoading: false });
      return;
    }
    const token = localStorage.getItem("accessToken");
    const userStr = localStorage.getItem("user");
    const tenantStr = localStorage.getItem("tenant");

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        const tenant = tenantStr ? (JSON.parse(tenantStr) as Tenant) : null;
        set({ user, tenant, isAuthenticated: true, isLoading: false });
      } catch {
        set({ isLoading: false });
      }
    } else {
      set({ isLoading: false });
    }
  },
}));

