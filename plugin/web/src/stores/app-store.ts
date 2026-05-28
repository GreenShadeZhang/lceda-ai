import { create } from 'zustand';

export type AppTab = 'chat' | 'settings';

interface AppState {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'chat',
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
