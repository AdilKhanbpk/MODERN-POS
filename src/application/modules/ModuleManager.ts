import Database from 'better-sqlite3';
import crypto from 'crypto';
import { IModuleContract, ModuleNavigationEntry } from '../../shared/types/module-contract';
import { ModuleRegistry, defaultModuleRegistry } from './ModuleRegistry';
import { AppError, NotFoundError, ValidationError, ForbiddenError } from '../../shared/errors/AppError';

export interface ModuleStatus {
  code: string;
  name: string;
  category: string;
  classification: 'CORE' | 'OPTIONAL';
  version: string;
  isInstalled: boolean;
  isEnabled: boolean;
  enabledAt?: string | null;
  disabledAt?: string | null;
  installationStatus?: string;
  dependencies: string[];
}

export class ModuleManager {
  constructor(
    private db: Database.Database,
    private registry: ModuleRegistry = defaultModuleRegistry
  ) {}

  /**
   * Returns a module definition row ID from the database, or creates one if not yet seeded.
   */
  private getOrCreateModuleDefId(mod: IModuleContract): string {
    const row = this.db.prepare('SELECT id FROM module_definitions WHERE module_code = ?').get(mod.code) as { id: string } | undefined;
    if (row) return row.id;

    const newId = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO module_definitions (id, module_code, module_name, description, is_core, dependencies)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newId,
      mod.code,
      mod.name,
      mod.description,
      mod.classification === 'CORE' ? 1 : 0,
      JSON.stringify(mod.dependencies || [])
    );
    return newId;
  }

  /**
   * Installs a module. If install lifecycle hook throws, changes are rolled back
   * and the failure is logged to module_installations.
   */
  public installModule(businessId: string, moduleCode: string, options: Record<string, any> = {}): void {
    const mod = this.registry.getModule(moduleCode);
    if (!mod) {
      throw new NotFoundError('Module', moduleCode);
    }

    const moduleId = this.getOrCreateModuleDefId(mod);

    try {
      const tx = this.db.transaction(() => {
        if (mod.install) {
          mod.install({ db: this.db, businessId, options });
        }

        const installId = crypto.randomUUID();
        this.db.prepare(`
          INSERT INTO module_installations (id, module_id, installed_version, installation_status, error_message)
          VALUES (?, ?, ?, 'INSTALLED', NULL)
          ON CONFLICT(module_id) DO UPDATE SET
            installed_version = excluded.installed_version,
            installation_status = 'INSTALLED',
            error_message = NULL
        `).run(installId, moduleId, mod.version);

        this.logModuleEvent(businessId, moduleCode, 'MODULE_INSTALLED', {
          version: mod.version,
          timestamp: new Date().toISOString()
        });
      });

      tx();
    } catch (err: any) {
      // Record failure outside of rolled back transaction
      this.db.prepare(`
        INSERT INTO module_installations (id, module_id, installed_version, installation_status, error_message)
        VALUES (?, ?, ?, 'FAILED', ?)
        ON CONFLICT(module_id) DO UPDATE SET
          installation_status = 'FAILED',
          error_message = excluded.error_message
      `).run(crypto.randomUUID(), moduleId, mod.version, err.message);

      throw err;
    }
  }

  /**
   * Enables an optional or core module for a business.
   * Validates prerequisites and fires lifecycle hooks.
   */
  public enableModule(
    businessId: string,
    moduleCode: string,
    userId?: string,
    options: Record<string, any> = {}
  ): void {
    const mod = this.registry.getModule(moduleCode);
    if (!mod) {
      throw new NotFoundError('Module', moduleCode);
    }

    // Core modules are always enabled
    if (mod.classification === 'CORE') {
      return;
    }

    // Dependency check: All prerequisites must be enabled
    const currentlyEnabled = this.getEnabledModuleCodes(businessId);
    if (!currentlyEnabled.includes(moduleCode)) {
      const depCheck = this.registry.validateDependencies([...currentlyEnabled, moduleCode]);
      if (!depCheck.valid) {
        throw new ValidationError(
          `Cannot enable module "${mod.name}": ${depCheck.errors.join('; ')}`
        );
      }
    }

    const moduleId = this.getOrCreateModuleDefId(mod);

    const tx = this.db.transaction(() => {
      if (mod.enable) {
        mod.enable({ db: this.db, businessId, userId, options });
      }

      this.db.prepare(`
        INSERT INTO business_modules (id, business_id, module_id, is_enabled, enabled_at, disabled_at)
        VALUES (?, ?, ?, 1, (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')), NULL)
        ON CONFLICT(business_id, module_id) DO UPDATE SET
          is_enabled = 1,
          enabled_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
          disabled_at = NULL
      `).run(crypto.randomUUID(), businessId, moduleId);

      this.logModuleEvent(businessId, moduleCode, 'MODULE_ENABLED', {
        userId,
        timestamp: new Date().toISOString()
      });
    });

    tx();
  }

  /**
   * Non-destructively disables an optional module.
   * Core modules CANNOT be disabled.
   * Dependent modules block disabling.
   * Tables, columns, and historical records are NEVER dropped or altered.
   */
  public disableModule(
    businessId: string,
    moduleCode: string,
    userId?: string,
    options: Record<string, any> = {}
  ): void {
    const mod = this.registry.getModule(moduleCode);
    if (!mod) {
      throw new NotFoundError('Module', moduleCode);
    }

    if (mod.classification === 'CORE') {
      throw new ForbiddenError(`Core module "${mod.name}" cannot be disabled.`);
    }

    // Check if any currently enabled module depends on this module
    const currentlyEnabled = this.getEnabledModuleCodes(businessId);
    const disableCheck = this.registry.canDisable(moduleCode, currentlyEnabled);
    if (!disableCheck.canDisable) {
      throw new AppError(
        `Cannot disable module "${mod.name}" because it is required by: ${disableCheck.blockedBy.join(', ')}`,
        'BUSINESS_RULE_ERROR'
      );
    }

    const moduleId = this.getOrCreateModuleDefId(mod);

    const tx = this.db.transaction(() => {
      if (mod.disable) {
        mod.disable({ db: this.db, businessId, userId, options });
      }

      // Non-destructive update: marks is_enabled = 0 and sets disabled_at
      this.db.prepare(`
        UPDATE business_modules
        SET is_enabled = 0, disabled_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
        WHERE business_id = ? AND module_id = ?
      `).run(businessId, moduleId);

      this.logModuleEvent(businessId, moduleCode, 'MODULE_DISABLED', {
        userId,
        timestamp: new Date().toISOString()
      });
    });

    tx();
  }

  /**
   * Upgrades a module to a target version and runs upgrade lifecycle hooks.
   */
  public upgradeModule(
    businessId: string,
    moduleCode: string,
    targetVersion: string,
    options: Record<string, any> = {}
  ): void {
    const mod = this.registry.getModule(moduleCode);
    if (!mod) {
      throw new NotFoundError('Module', moduleCode);
    }

    const moduleId = this.getOrCreateModuleDefId(mod);
    const currentInstall = this.db.prepare(
      'SELECT installed_version FROM module_installations WHERE module_id = ?'
    ).get(moduleId) as { installed_version: string } | undefined;

    const fromVersion = currentInstall?.installed_version || '1.0.0';

    const tx = this.db.transaction(() => {
      if (mod.upgrade) {
        mod.upgrade(fromVersion, targetVersion, { db: this.db, businessId, options });
      }

      this.db.prepare(`
        INSERT INTO module_installations (id, module_id, installed_version, last_migration_at, installation_status, error_message)
        VALUES (?, ?, ?, (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')), 'INSTALLED', NULL)
        ON CONFLICT(module_id) DO UPDATE SET
          installed_version = excluded.installed_version,
          last_migration_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
          installation_status = 'INSTALLED',
          error_message = NULL
      `).run(crypto.randomUUID(), moduleId, targetVersion);

      this.logModuleEvent(businessId, moduleCode, 'MODULE_UPGRADED', {
        fromVersion,
        toVersion: targetVersion,
        timestamp: new Date().toISOString()
      });
    });

    tx();
  }

  /**
   * Checks whether a module is active and enabled for the given business.
   * Core modules are always enabled.
   */
  public isModuleEnabled(businessId: string, moduleCode: string): boolean {
    const mod = this.registry.getModule(moduleCode);
    if (mod && mod.classification === 'CORE') {
      return true;
    }

    const row = this.db.prepare(`
      SELECT bm.is_enabled
      FROM business_modules bm
      JOIN module_definitions md ON md.id = bm.module_id
      WHERE bm.business_id = ? AND md.module_code = ?
    `).get(businessId, moduleCode) as { is_enabled: number } | undefined;

    return row ? row.is_enabled === 1 : false;
  }

  /**
   * Authoritative backend guard: Throws if the target module is not enabled for the business.
   * Direct API/IPC calls must invoke this guard before executing domain actions.
   */
  public assertModuleEnabled(businessId: string, moduleCode: string, actionDescription: string): void {
    if (!this.isModuleEnabled(businessId, moduleCode)) {
      throw new AppError(
        `Action rejected: "${actionDescription}" requires module "${moduleCode}" to be enabled. Current business configuration has disabled this module.`,
        'MODULE_DISABLED',
        403
      );
    }
  }

  /**
   * Returns a list of all currently active module codes (Core + Enabled Optionals) for a business.
   */
  public getEnabledModuleCodes(businessId: string): string[] {
    const coreCodes = this.registry.getCoreModules().map(m => m.code);

    const rows = this.db.prepare(`
      SELECT md.module_code
      FROM business_modules bm
      JOIN module_definitions md ON md.id = bm.module_id
      WHERE bm.business_id = ? AND bm.is_enabled = 1
    `).all(businessId) as Array<{ module_code: string }>;

    const enabledSet = new Set<string>([...coreCodes, ...rows.map(r => r.module_code)]);
    return Array.from(enabledSet);
  }

  /**
   * Dynamically generates the UI navigation menu strictly for enabled modules,
   * filtered by user permissions and ordered correctly.
   */
  public getNavigation(businessId: string, userPermissions: string[] = []): ModuleNavigationEntry[] {
    const enabledCodes = new Set(this.getEnabledModuleCodes(businessId));
    const isSuperAdmin = userPermissions.includes('*') || userPermissions.includes('admin');
    const entries: ModuleNavigationEntry[] = [];

    for (const code of enabledCodes) {
      const mod = this.registry.getModule(code);
      if (mod && mod.navigation) {
        for (const nav of mod.navigation) {
          if (!nav.requiredPermission || isSuperAdmin || userPermissions.includes(nav.requiredPermission)) {
            entries.push(nav);
          }
        }
      }
    }

    return entries.sort((a, b) => a.order - b.order);
  }

  /**
   * Returns detailed status for all registered modules in the business.
   */
  public getModuleStatusList(businessId: string): ModuleStatus[] {
    const allModules = this.registry.getAllModules();
    const enabledCodes = new Set(this.getEnabledModuleCodes(businessId));

    const installations = this.db.prepare(`
      SELECT md.module_code, mi.installed_version, mi.installation_status
      FROM module_installations mi
      JOIN module_definitions md ON md.id = mi.module_id
    `).all() as Array<{ module_code: string; installed_version: string; installation_status: string }>;

    const installMap = new Map(installations.map(i => [i.module_code, i]));

    const bizModules = this.db.prepare(`
      SELECT md.module_code, bm.is_enabled, bm.enabled_at, bm.disabled_at
      FROM business_modules bm
      JOIN module_definitions md ON md.id = bm.module_id
      WHERE bm.business_id = ?
    `).all(businessId) as Array<{ module_code: string; is_enabled: number; enabled_at: string | null; disabled_at: string | null }>;

    const bizMap = new Map(bizModules.map(b => [b.module_code, b]));

    return allModules.map(mod => {
      const isCore = mod.classification === 'CORE';
      const inst = installMap.get(mod.code);
      const biz = bizMap.get(mod.code);

      const isEnabled = isCore || enabledCodes.has(mod.code);

      return {
        code: mod.code,
        name: mod.name,
        category: mod.category,
        classification: mod.classification,
        version: inst?.installed_version || mod.version,
        isInstalled: !!inst && inst.installation_status === 'INSTALLED',
        isEnabled,
        enabledAt: biz?.enabled_at || null,
        disabledAt: biz?.disabled_at || null,
        installationStatus: inst?.installation_status || 'NOT_INSTALLED',
        dependencies: mod.dependencies || []
      };
    });
  }

  /**
   * Logs an idempotent module lifecycle event.
   */
  public logModuleEvent(
    businessId: string,
    moduleCode: string,
    eventCode: string,
    payload: any,
    idempotencyKey?: string
  ): string {
    if (idempotencyKey) {
      const existing = this.db.prepare(
        'SELECT id FROM module_events WHERE idempotency_key = ?'
      ).get(idempotencyKey) as { id: string } | undefined;
      if (existing) {
        return existing.id;
      }
    }

    const eventId = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO module_events (id, business_id, module_code, event_code, payload, idempotency_key, processing_status)
      VALUES (?, ?, ?, ?, ?, ?, 'PROCESSED')
    `).run(
      eventId,
      businessId,
      moduleCode,
      eventCode,
      JSON.stringify(payload),
      idempotencyKey || null
    );

    return eventId;
  }

  /**
   * Retrieves all logged events for a given business and optional module.
   */
  public getModuleEvents(businessId: string, moduleCode?: string): any[] {
    if (moduleCode) {
      return this.db.prepare(`
        SELECT * FROM module_events
        WHERE business_id = ? AND module_code = ?
        ORDER BY created_at DESC
      `).all(businessId, moduleCode);
    }

    return this.db.prepare(`
      SELECT * FROM module_events
      WHERE business_id = ?
      ORDER BY created_at DESC
    `).all(businessId);
  }
}

