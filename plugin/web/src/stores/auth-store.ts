import { create } from 'zustand';

const AT_KEY = 'ai_sch_access_token';
const RT_KEY = 'ai_sch_refresh_token';

function readToken(key: string): string | null {
  try {
    const val = eda.sys_Storage.getExtensionUserConfig(key);
    return val || null;
  } catch { /* not in EDA */ }
  return localStorage.getItem(key);
}

function writeToken(key: string, value: string) {
  try { eda.sys_Storage.setExtensionUserConfig(key, value); return; } catch { /* not in EDA */ }
  localStorage.setItem(key, value);
}

function clearToken(key: string) {
  try { eda.sys_Storage.setExtensionUserConfig(key, ''); return; } catch { /* not in EDA */ }
  localStorage.removeItem(key);
}

function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    return payload.exp ? payload.exp * 1000 : null;
  } catch { return null; }
}

interface AuthState {
  accessToken:  string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setTokens: (at: string, rt: string | null) => void;
  clearTokens: () => void;
  loadFromStorage: () => void;
  isTokenValid: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken:  null,
  refreshToken: null,
  isAuthenticated: false,

  loadFromStorage() {
    const at = readToken(AT_KEY);
    const rt = readToken(RT_KEY);
    const valid = at ? (getTokenExpiry(at) ?? Infinity) > Date.now() + 5000 : false;
    set({ accessToken: at, refreshToken: rt, isAuthenticated: valid });
  },

  setTokens(at, rt) {
    writeToken(AT_KEY, at);
    writeToken(RT_KEY, rt ?? '');
    set({ accessToken: at, refreshToken: rt, isAuthenticated: true });
  },

  clearTokens() {
    clearToken(AT_KEY);
    clearToken(RT_KEY);
    set({ accessToken: null, refreshToken: null, isAuthenticated: false });
  },

  isTokenValid() {
    const { accessToken } = get();
    if (!accessToken) return false;
    const exp = getTokenExpiry(accessToken);
    return exp ? exp > Date.now() + 5000 : true;
  },
}));
