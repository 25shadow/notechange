/// <reference types="vite/client" />

import type { NoteChangeApi } from '../shared/ipc';

declare global {
  interface Window {
    notechange: NoteChangeApi;
  }
}

export {};
