import { useSyncExternalStore } from 'react';
import type { Photo } from './engine/pipeline';
import type { DevelopParams } from './engine/film/types';
import type { ExportOptions } from './engine/export';

export type Tab = 'reading' | 'film' | 'tune' | 'print';
export interface CustomSlot { name: string; params: Partial<DevelopParams> }
export interface Toast { id: number; text: string; tone?: 'ok' | 'err' }

export interface State {
  photos: Photo[];
  activeId: string | null;
  queue: File[];
  developing: { name: string; index: number; total: number } | null;
  tab: Tab;
  split: number | null;
  showOriginal: boolean;
  zoom: number;
  pan: [number, number];
  sound: boolean;
  exportOpts: ExportOptions;
  customs: Array<CustomSlot | null>;
  toasts: Toast[];
  busy: string | null;
  help: boolean;
}

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const loadArr = <T,>(k: string, d: T[]): T[] => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };

let state: State = {
  photos: [], activeId: null, queue: [], developing: null, tab: 'reading',
  split: null, showOriginal: false, zoom: 1, pan: [0.5, 0.5],
  sound: false,
  exportOpts: load<ExportOptions>('myfuji.export', { frame: 'none', dateStamp: false, format: 'jpeg', quality: 0.93, size: 'full' }),
  customs: loadArr<CustomSlot | null>('myfuji.customs', Array(7).fill(null)),
  toasts: [], busy: null, help: false,
};
const subs = new Set<() => void>();

export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  if (p.exportOpts) try { localStorage.setItem('myfuji.export', JSON.stringify(state.exportOpts)); } catch { /* private mode */ }
  if (p.customs) try { localStorage.setItem('myfuji.customs', JSON.stringify(state.customs)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => sel(state));
}

export const activePhoto = (s: State = state) => s.photos.find((p) => p.id === s.activeId) ?? null;

export function updateParams(patch: Partial<DevelopParams>, id = state.activeId) {
  setState((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, params: { ...p.params, ...patch } } : p)) }));
}

let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800);
}
