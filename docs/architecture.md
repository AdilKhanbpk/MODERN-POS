# System Architecture Documentation — Modern Retail POS

## 1. Executive Summary & Design Principles

The **Modern Retail POS** is an enterprise-grade desktop point-of-sale system engineered for **100% offline, local-first retail operations**, with built-in multi-mode support for multi-counter local servers and multi-branch central PostgreSQL servers.

No internet connection, cloud infrastructure, or external telemetry is required for standalone retail operation including authentication, barcode scanning, sales, stock adjustments, financial reporting, thermal receipt printing, or database backups.

### Architectural Invariants:
1. **Strict Layered Separation**: Presentation $\rightarrow$ Application $\rightarrow$ Domain $\rightarrow$ Infrastructure / Integration. No layer may skip boundaries or access lower-level primitives directly.
2. **Deterministic Calculation Truth**: React components never calculate prices, taxes, stock levels, or customer balances as authoritative sources of truth. All calculations are executed exclusively by pure, tested Domain functions.
3. **No Float for Money**: Monetary amounts are stored and calculated strictly as integer minor units (PKR Paisa / Cents).
4. **Canonical Fixed-Point Stock Quantities**: Quantities are stored in base units scaled by `QUANTITY_SCALE = 10,000`. Unrepresentable fractions are rejected rather than silently rounded.
5. **Double-Entry Financial Integrity**: Every financial transaction (sale, purchase, customer payment, expense, payroll) posts balanced debit and credit entries to the general ledger (`sum(Debits) === sum(Credits)`).
6. **Relational Constraints & Atomicity**: SQLite WAL mode with foreign key enforcement (`PRAGMA foreign_keys = ON`) and transactional rollbacks protect inventory and ledger consistency.
7. **Secure Electron Isolation**: Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and strict Content Security Policy. The `window.posApi` object exposes only approved, typed contracts through Electron's `contextBridge`.
8. **No Live SQLite Over Network Shares**: Multi-user operations use server-managed databases with typed repository interfaces, never placing a live SQLite file on SMB/NFS network folders.

---

## 2. Complete 5-Layer System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ELECTRON DESKTOP RUNTIME                     │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │             1. PRESENTATION LAYER (RENDERER)              │  │
│  │                                                           │  │
│  │  React 18 + TypeScript + Modern Component Architecture    │  │
│  │  Dashboard, POS Terminal (F1), Inventory (F2), Purchases, │  │
│  │  Customers, Suppliers, Accounts, Expenses, Reports        │  │
│  └─────────────────────────────┬─────────────────────────────┘  │
│                                │                                │
│                     Typed Preload API                           │
│                     (window.posApi)                             │
│                                │                                │
│                     Secure Electron IPC                         │
│                     (ContextBridge, Strict CSP)                 │
│                                │                                │
│  ┌─────────────────────────────▼─────────────────────────────┐  │
│  │                2. APPLICATION LAYER                       │  │
│  │                                                           │  │
│  │  Use Cases, Workflows, RBAC Permissions, Payload Zod      │  │
│  │  Validation, Idempotency Guard, Orchestration             │  │
│  └──────────────────────┬──────────────┬─────────────────────┘  │
│                         │              │                        │
│  ┌──────────────────────▼──┐        ┌──▼─────────────────────┐  │
│  │     3. DOMAIN LAYER     │        │  5. INTEGRATION LAYER  │  │
│  │                         │        │                        │  │
│  │  Money (Paisa), Units,  │        │  PostgreSQL Adapter,   │  │
│  │  Rational Conversions,  │        │  Hardware Scale COM,   │  │
│  │  Pricing, Cash Drawer,  │        │  Branch Sync Engine,   │  │
│  │  MAC Costing, Ledger    │        │  Outbox CDC Replicator │  │
│  └──────────────────────┬──┘        └──┬─────────────────────┘  │
│                         │              │                        │
│  ┌──────────────────────▼──────────────▼─────────────────────┐  │
│  │              4. INFRASTRUCTURE LAYER                      │  │
│  │                                                           │  │
│  │  Repository Interfaces (IProductRepo, ISaleRepo, etc.)    │  │
│  │  SQLite WAL Repositories, Versioned Migrations,           │  │
│  │  Thermal Printer (ESC/POS), Structured Local Logger       │  │
│  └─────────────────────────────┬─────────────────────────────┘  │
└────────────────────────────────┼────────────────────────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   │                           │
           ┌───────▼───────┐           ┌───────▼───────┐
           │ Local SQLite  │           │  PostgreSQL   │
           │ (Single-User) │           │ (Multi-Branch)│
           └───────────────┘           └───────────────┘
```

---

## 3. Layer Responsibilities & Boundaries

### 3.1. Presentation Layer (`src/renderer/`)
- Pure React/TypeScript UI for cashiers, store managers, and accountants.
- Responsive keyboard shortcuts (F1 POS, F2 Inventory, F3 Sales History, F4 Customers).
- **Boundary Invariant**: Zero direct database or filesystem access. All data fetches and commands flow through `window.posApi`.

### 3.2. Application Layer (`src/application/`)
- Encapsulates system use cases and business workflows.
- Enforces role-based permissions (`RBACEnforcer`), validates incoming IPC payloads with Zod schemas, manages idempotency keys, and orchestrates atomic multi-repository updates.

### 3.3. Domain Layer (`src/domain/`)
- Contains pure, dependency-free business logic and calculation rules.
- **Submodules**:
  - `money/money.ts`: Integer minor units (paisa), currency formatting, precision enforcement.
  - `units/scaled-quantity.ts`: Fixed-point `QUANTITY_SCALE = 10,000`, unit precision enforcement.
  - `units/rational-conversion.ts`: Exact numerator/denominator conversions for packs, dozens, gross, and mass.
  - `sales/pricing-calculator.ts`: Single authoritative line formula, allocated bill discounts, tax inclusive/exclusive, immutable line snapshots.
  - `accounting/customer-statement.ts`: Chronological running balance calculation, open bill linking.
  - `accounting/cash-drawer.ts`: Cash register closing formula with strict non-cash separation.
  - `costing/moving-average.ts`: Moving weighted-average cost (MAC), gross vs. operating profit reports.
  - `configuration/business-config.ts`: Universal business configuration and profile presets.

### 3.4. Infrastructure Layer (`src/infrastructure/`)
- Implements repository interfaces for SQLite (`src/infrastructure/sqlite/repositories/`).
- Manages database connection, WAL mode, foreign key enforcement, and versioned migrations (`migration-runner.ts`).
- Provides thermal printing service (`electron/main/printing/`) and structured local logger (`src/infrastructure/logging/`).

### 3.5. Integration Layer (`src/integration/`)
- **PostgreSQL Adapter (`src/integration/postgres/`)**: Connects multi-counter LAN servers or central enterprise databases using identical repository interfaces.
- **Hardware Integrations (`src/integration/hardware/`)**: Serial RS-232 / USB scale communication for retail weighing.
- **Branch Synchronization (`src/integration/sync/`)**: Outbox CDC change replication between offline branches and central server.

---

## 4. Operational Modes & Database Topology

The application supports four distinct operating topologies without rewriting business logic:

1. **Mode 1: Single-Computer Offline (Default)**
   - Engine: SQLite with Write-Ahead Logging (`WAL`) mode.
   - Storage: Local SSD (`data/pos-database.sqlite` or `%APPDATA%/Modern Retail POS/data/`).
   - Network: Completely standalone; zero internet or LAN required.

2. **Mode 2: Local LAN Multi-Counter Server**
   - Main counter runs the POS application with a local server process.
   - Secondary cash registers connect via local LAN HTTP/WebSocket API.
   - **Architectural Invariant**: Never place a live SQLite database file on an SMB, NFS, or mapped network folder. Shared disk access causes lock corruption. Multi-writer setups always use a dedicated server process.

3. **Mode 3: Multi-Branch Central PostgreSQL Server**
   - Each retail branch operates with its local database for 100% offline survivability during internet outages.
   - Changes are queued via `BranchSyncManager` and replicated to central PostgreSQL when connected.
   - Central headquarters queries consolidated sales, stock, and ledger data across all branches.

4. **Mode 4: Optional Cloud Services**
   - Cloud backup snapshots, automated email/SMS receipt dispatch, and consolidated analytics.
   - Completely optional: Disabling cloud services has zero impact on local operations.

---

## 5. Universal Business Configuration System

A single unified application supports multiple retail verticals via modular feature flags (`BusinessModuleFlags`):

| Feature Flag | Grocery / Mart | Pharmacy | Apparel / Boutique | Electronics | Laboratory | General Retail |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `enableWeighingScale` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `enableBatchTracking` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `enableExpiryTracking` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `enableFefoSelection` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `enableVariants` (Size/Color) | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| `enableSerialTracking` | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| `enableWarrantyManagement` | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| `enableServiceHistory` | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| `enableMultiUnitConversions`| ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `enableCustomerCreditLedger`| ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `enablePrescriptionManagement`| ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |

**Modular Independence Invariant**:
Disabling an optional feature in the business profile hides its UI controls and prevents new records from being created, but **NEVER** deletes, cascades, or alters historical records already stored in the database.

---

## 6. Security, Error Handling & Logging Strategy

### 6.1. Electron Security Hardening
- `contextIsolation: true` and `nodeIntegration: false`.
- Strict Content Security Policy enforced on both HTML meta tags and Electron session headers:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'`
- Typed, validated IPC channels in `electron/preload/index.ts`.
- Backend permission enforcement via `RBACEnforcer.assertPermission(role, permission)` regardless of UI button visibility.

### 6.2. Error Handling Hierarchy
- Standardized `AppError` hierarchy in `src/shared/errors/`:
  - `ValidationError` (400)
  - `UnauthorizedError` (401)
  - `ForbiddenError` (403)
  - `NotFoundError` (404)
  - `InsufficientStockError` (409)
  - `IdempotencyConflictError` (409)
  - `BusinessRuleViolationError` (422)
- Structured error serialization passes clean error codes and user messages across IPC without leaking internal stack traces.

### 6.3. Structured Offline Logging
- Implemented in `LoggerService` (`src/infrastructure/logging/logger.ts`).
- Writes structured JSON log entries (`[timestamp] [level] [context]: message meta`) to `logs/pos.log`.
- Local disk safety: Automatic directory verification and size management.
