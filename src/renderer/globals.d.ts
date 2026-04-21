import type { VicodeApi } from '../shared/ipc';

declare global {
  interface Window {
    vicode: VicodeApi;
  }
}

export {};
