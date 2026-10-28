import { SettingsRepository } from '../../infrastructure/sqlite/repositories/SettingsRepository';
import { SystemSettings } from '../../shared/types';

export class SettingsService {
  constructor(private settingsRepo: SettingsRepository = new SettingsRepository()) {}

  public getSettings(): SystemSettings {
    return this.settingsRepo.getSettings();
  }

  public saveSettings(settings: Partial<SystemSettings>): SystemSettings {
    this.settingsRepo.saveSettings(settings);
    return this.settingsRepo.getSettings();
  }
}

