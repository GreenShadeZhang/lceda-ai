import { create } from 'zustand';

interface SettingsState {
  apiBaseUrl: string;
  theme: 'dark' | 'light';
  setApiBaseUrl: (url: string) => void;
  setTheme: (t: 'dark' | 'light') => void;
}

const STORAGE_KEY = 'ai_sch_settings';

function loadSettings(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveSettings(state: Partial<SettingsState>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      apiBaseUrl: state.apiBaseUrl,
      theme: state.theme,
    }));
  } catch { /* ignore */ }
}

const saved = loadSettings();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  apiBaseUrl: saved.apiBaseUrl ?? 'https://lceda-ai.verdure-hiro.cn',
  theme:      saved.theme ?? 'dark',

  setApiBaseUrl(url) {
    set({ apiBaseUrl: url });
    saveSettings({ ...get(), apiBaseUrl: url });
  },

  setTheme(t) {
    set({ theme: t });
    saveSettings({ ...get(), theme: t });
  },
}));
