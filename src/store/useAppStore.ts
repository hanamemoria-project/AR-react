import { create } from 'zustand';

interface AppState {
  hasStarted: boolean;
  envelopeDismissed: boolean;
  isARReady: boolean;
  isAdmin: boolean;
  currentLang: 'id' | 'en';
  loadingProgress: number;
  loadingStep: 'init' | 'ai' | 'ar' | 'done';
  orderData: any;
  setHasStarted: (val: boolean) => void;
  setEnvelopeDismissed: (val: boolean) => void;
  setIsARReady: (val: boolean) => void;
  setIsAdmin: (val: boolean) => void;
  setCurrentLang: (lang: 'id' | 'en') => void;
  setLoadingProgress: (val: number) => void;
  setLoadingStep: (step: 'init' | 'ai' | 'ar' | 'done') => void;
  setOrderData: (data: any) => void;
}

export const useAppStore = create<AppState>((set) => ({
  hasStarted: false,
  envelopeDismissed: false,
  isARReady: false,
  isAdmin: false,
  currentLang: 'id',
  loadingProgress: 0,
  loadingStep: 'init',
  orderData: null,
  setHasStarted: (val) => set({ hasStarted: val }),
  setEnvelopeDismissed: (val) => set({ envelopeDismissed: val }),
  setIsARReady: (val) => set({ isARReady: val }),
  setIsAdmin: (val) => set({ isAdmin: val }),
  setCurrentLang: (lang) => set({ currentLang: lang }),
  setLoadingProgress: (val) => set({ loadingProgress: val }),
  setLoadingStep: (step) => set({ loadingStep: step }),
  setOrderData: (data) => set({ orderData: data }),
}));
