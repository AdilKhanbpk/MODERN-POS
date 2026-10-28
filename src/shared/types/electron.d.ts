import { PosApi } from '../../../electron/preload/index';

declare global {
  interface Window {
    posApi: PosApi;
  }
}

