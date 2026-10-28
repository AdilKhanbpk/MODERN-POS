"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const SettingsRepository_1 = require("../../infrastructure/sqlite/repositories/SettingsRepository");
class SettingsService {
    settingsRepo;
    constructor(settingsRepo = new SettingsRepository_1.SettingsRepository()) {
        this.settingsRepo = settingsRepo;
    }
    getSettings() {
        return this.settingsRepo.getSettings();
    }
    saveSettings(settings) {
        this.settingsRepo.saveSettings(settings);
        return this.settingsRepo.getSettings();
    }
}
exports.SettingsService = SettingsService;
