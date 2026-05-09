import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  tenant: { id: string; name: string; plan: string } | null;
  setAuth: (token: string, tenant: AuthState['tenant']) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      tenant: null,
      setAuth: (token, tenant) => set({ token, tenant }),
      clearAuth: () => set({ token: null, tenant: null }),
    }),
    { name: 'ignis-auth' }
  )
);
