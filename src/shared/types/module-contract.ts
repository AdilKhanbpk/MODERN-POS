import Database from 'better-sqlite3';

export type ModuleClassification = 'CORE' | 'OPTIONAL';

export type ModuleCategory =
  | 'INVENTORY'
  | 'SALES'
  | 'ACCOUNTING'
  | 'SETTINGS'
  | 'HR'
  | 'HARDWARE'
  | 'INTEGRATION'
  | 'ANALYTICS';

export type ModuleHardwareType = 'SCALE' | 'PRINTER' | 'SCANNER' | 'DISPLAY' | 'BIOMETRIC';

export interface ModuleHardwareRequirement {
  hardwareType: ModuleHardwareType;
  description: string;
  required: boolean;
}

export interface ModulePermissionDef {
  key: string;
  name: string;
  description: string;
  category?: string;
}

export interface ModuleNavigationEntry {
  id: string;
  label: string;
  path: string;
  icon?: string;
  order: number;
  requiredPermission?: string;
  parentId?: string;
}

export interface ModuleSettingsField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'select';
  options?: Array<{ label: string; value: any }>;
  defaultValue?: any;
  required?: boolean;
}

export interface ModuleSettingsSchema {
  fields: ModuleSettingsField[];
}

export interface IModuleLifecycleContext {
  db: Database.Database;
  businessId?: string;
  userId?: string;
  options?: Record<string, any>;
}

export interface IModuleContract {
  code: string;
  name: string;
  description: string;
  category: ModuleCategory;
  classification: ModuleClassification;
  version: string;
  dependencies: string[]; // Codes of prerequisite modules
  permissions?: ModulePermissionDef[];
  navigation?: ModuleNavigationEntry[];
  routes?: Array<{ path: string; title: string }>;
  settingsSchema?: ModuleSettingsSchema;
  hardware?: ModuleHardwareRequirement[];
  eventSubscriptions?: string[];

  // Lifecycle Hooks
  install?(context: IModuleLifecycleContext): Promise<void> | void;
  enable?(context: IModuleLifecycleContext): Promise<void> | void;
  disable?(context: IModuleLifecycleContext): Promise<void> | void;
  upgrade?(fromVersion: string, toVersion: string, context: IModuleLifecycleContext): Promise<void> | void;
  validateDependencies?(enabledModuleCodes: string[]): { valid: boolean; errors: string[] };
  validateConfiguration?(config: Record<string, any>): { valid: boolean; errors: string[] };
  healthCheck?(context: IModuleLifecycleContext): { healthy: boolean; details?: string };
}

