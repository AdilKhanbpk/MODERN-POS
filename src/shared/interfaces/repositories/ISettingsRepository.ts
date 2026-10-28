import { SystemSettings } from '../../types';

export interface ISettingsRepository {
  getSettings(): SystemSettings;
  saveSettings(settings: Partial<SystemSettings>): void;
  getAppSetting(key: string): string | null;
  setAppSetting(key: string, value: string): void;
}

