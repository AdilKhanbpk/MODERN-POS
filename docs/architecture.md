# System Architecture Documentation — Modern Retail POS

## 1. Executive Summary & Design Principles

The **Modern Retail POS** is an enterprise-grade desktop point-of-sale system engineered for **100% offline, local-first retail operations**. No internet connection, cloud infrastructure, or external telemetry is required for any operation including authentication, barcode scanning, sales, stock adjustments, financial reporting, thermal receipt printing, or database backups.

### Architectural Invariants:
1. **Separation of Concerns**: Each architectural layer strictly executes its designated responsibilities.
2. **Deterministic Calculation Truth**: React components never calculate stock levels, profit margins, or customer balances as final source of truth. All calculations are executed exclusively by the shared backend Domain Layer.
3. **Double-Entry Integrity**: Every financial transaction (sale, purchase, customer payment, expense, payroll) posts balanced debit and credit entries to the general ledger (`sum(Debits) === sum(Credits)`).
4. **Relational Constraints & Atomicity**: SQLite WAL (Write-Ahead Logging) mode with foreign key enforcement (`PRAGMA foreign_keys = ON`) and transactional rollbacks protect inventory and ledger consistency.
5. **Secure IPC Isolation**: Renderer runs with `contextIsolation: true` and `nodeIntegration: false`. The `window.posApi` object exposes only approved, typed contracts through Electron's `contextBridge`.

---

## 2. Complete Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ELECTRON APPLICATION                         │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    REACT + TYPESCRIPT                     │  │
│  │                                                           │  │
│  │  Dashboard, POS Terminal (F1), Inventory (F2), Purchases,  │  │
│  │  Customers, Suppliers, Accounts, Expenses, Payroll,       │  │
│  │  Reports & Daily Z-Report, Settings & Local Backup        │  │
│  └─────────────────────────────┬─────────────────────────────┘  │
│                                │                                │
│                     Typed Preload API                           │
│                     (window.posApi)                             │
│                                │                                │
│                     Secure Electron IPC                         │
│                     (ipcMain / ipcRenderer)                     │
│                                │                                │
│  ┌─────────────────────────────▼─────────────────────────────┐  │
│  │               APPLICATION / SERVICE LAYER                 │  │
│  │                                                           │  │
│  │  AuthService, SalesService, PurchaseService,              │  │
│  │  InventoryService, AccountService, ExpenseService,        │  │
│  │  PayrollService, ReportService, BackupService,            │  │
│  │  SettingsService, RBAC Authorization Enforcer             │  │
│  └─────────────────────────────┬─────────────────────────────┘  │
│                                │                                │
│  ┌─────────────────────────────▼─────────────────────────────┐  │
│  │                      DOMAIN LAYER                         │  │
│  │                                                           │  │
│  │  Money Arithmetic (Integer Cents), Unit Conversions,      │  │
│  │  Stock Rules & Shortage Checks, PricingCalculator,        │  │
│  │  Landed Cost Apportionment, DoubleEntry Balancer,         │  │
│  │  Profit & Loss Analysis                                   │  │
│  └─────────────────────────────┬─────────────────────────────┘  │
│                                │                                │
│  ┌─────────────────────────────▼─────────────────────────────┐  │
│  │               REPOSITORY / DATABASE LAYER                 │  │
│  │                                                           │  │
│  │  UserRepository, ProductRepository, CustomerRepository,  │  │
│  │  SupplierRepository, SaleRepository, PurchaseRepository, │  │
│  │  AccountRepository, ExpenseRepository, EmployeeRepo,     │  │
│  │  TransactionsRunner, Versioned Schema Migrations          │  │
│  └─────────────────────────────┬─────────────────────────────┘  │
└────────────────────────────────┼────────────────────────────────┘
                                 │
                         ┌───────▼───────┐
                         │    SQLite     │
                         │ Local Database│
                         │  (WAL Mode)   │
                         └───────────────┘
```

---

## 3. Layer Responsibilities & Boundaries

### 3.1. Frontend: React + TypeScript
- **Location**: `src/renderer/`
- **Role**: Pure UI presentation, cashier interactions, keyboard shortcut listeners (F1-F4), and reactive state rendering.
- **Rules**:
  - Never performs final price or profit calculations. Requests domain calculation previews via `window.posApi.sales.calculate(...)`.
  - Communicates solely through the typed `window.posApi` interface.

### 3.2. Secure Preload API
- **Location**: `electron/preload/index.ts`
- **Role**: ContextBridge gateway exposing strictly typed methods grouped by domain (`auth`, `sales`, `inventory`, `customers`, `suppliers`, `accounts`, `reports`, `printing`, `backup`).
- **Rules**:
  - No Node.js runtime primitives or raw SQLite bindings are exposed to the browser window.
  - Channels are defined in `src/shared/contracts/ipc-channels.ts`.

### 3.3. Application / Service Layer
- **Location**: `src/application/`
- **Role**: Orchestrates workflows, verifies user authorization (RBAC), validates payload schemas with Zod, invokes Domain calculations, coordinates atomic multi-repository writes, and posts general ledger entries.

### 3.4. Domain Layer
- **Location**: `src/domain/`
- **Role**: Encapsulates pure business logic and mathematical rules with zero side effects.
- **Submodules**:
  - `money/money.ts`: Integer cents arithmetic, formatting, safe rounding.
  - `units/units.ts`: Multi-unit pack/carton conversion factors.
  - `inventory/stock-rules.ts`: Availability validation, negative stock prevention, reorder levels.
  - `sales/pricing-calculator.ts`: Deterministic calculation of subtotals, inclusive/exclusive tax, discounts, profit, and payment split.
  - `purchases/landed-cost.ts`: Apportionment of freight and duties proportionally across goods.
  - `accounting/double-entry.ts`: Debit/credit balance validation, ledger posting generator, account balance updates.
  - `costing/profit-calculator.ts`: Gross profit, net profit, margin calculations.

### 3.5. Infrastructure / Repository Layer
- **Location**: `src/infrastructure/sqlite/`
- **Role**: Handles raw database access, atomic transaction blocks (`TransactionRunner`), schema migrations, and optimized SQL queries.
- **SQLite Engine Configuration**:
  - `PRAGMA journal_mode = WAL`: Write-Ahead Logging allows concurrent readers while a write is occurring.
  - `PRAGMA foreign_keys = ON`: Strict relational constraints prevent orphaned records.
  - `PRAGMA busy_timeout = 5000`: Graceful handling of lock contention.

---

## 4. End-to-End POS Sale Transaction Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Cashier
    participant UI as React UI (Renderer)
    participant Preload as Typed Preload (window.posApi)
    participant Service as SalesService
    participant Domain as Domain: PricingCalculator
    participant Rules as Domain: StockRules
    participant DB as SQLite Transaction
    participant Ledger as Domain: DoubleEntryLedger
    participant Printer as ThermalPrinterService

    Cashier->>UI: Scans Barcode / Enters Items
    UI->>Preload: sales.calculate(items, discount)
    Preload->>Service: IPC: 'sales:calculate'
    Service->>Domain: calculateSale(items)
    Domain-->>Service: Calculation Result
    Service-->>UI: Real-time Price Preview
    Cashier->>UI: Selects Customer & Tenders Payment
    UI->>Preload: sales.createSale(request)
    Preload->>Service: IPC: 'sales:create'
    Service->>Domain: calculateSale(items)
    Service->>Rules: validateAvailability(stock, qty)
    alt Insufficient Stock
        Rules-->>Service: Shortage Error
        Service-->>UI: Reject with Shortage Notice
    else Stock Available
        Service->>DB: Begin Atomic Transaction
        DB->>DB: Deduct Product Inventory & Log Movement
        DB->>DB: Insert Sale & Line Items
        DB->>DB: Update Customer Credit Balance & Ledger
        Service->>Ledger: Generate Balanced Journal Lines
        DB->>DB: Post Journal Entry (Debits === Credits)
        DB->>DB: Update Chart of Accounts Balances
        DB->>DB: Commit Transaction
        Service-->>UI: Return Completed Sale (Invoice #)
        Service->>Printer: Silent Print Thermal Receipt (80mm)
        UI-->>Cashier: Display Success & Change Due
    end

---

## 5. Implementation Specifications & Operations

### 5.1. Responsibility of Every Architectural Layer
1. **Presentation Layer (`src/renderer/`)**: Pure React/TypeScript UI for cashiers and managers. Has no direct filesystem, database, or network access. All operations dispatch via typed preload API.
2. **Preload Gateway (`electron/preload/index.ts`)**: Exposes safe, typed methods via `contextBridge.exposeInMainWorld('posApi', ...)`. Strictly enforces `contextIsolation: true` and `nodeIntegration: false`.
3. **IPC Transport (`electron/main/ipc/`)**: Inter-process communication routing requests from renderer to application services.
4. **Application / Service Layer (`src/application/`)**: Coordinates use cases, enforces RBAC permissions, coordinates atomic database operations, and orchestrates workflows (sales, purchases, registers, backups).
5. **Domain Layer (`src/domain/`)**: Pure deterministic business functions with zero external dependencies (Money, Scaled Quantities, Rational Unit Conversions, Authoritative Line Pricing, Cash Drawer Reconciliation, MAC Costing, and Double-Entry Ledger Balancers).
6. **Infrastructure / Repository Layer (`src/infrastructure/sqlite/`)**: Direct database access with SQLite WAL mode, parameterized SQL, transaction runner, and versioned schema migrations.

### 5.2. How React Communicates with Backend Services
- React invokes methods on `window.posApi` (e.g. `window.posApi.sales.createSale(payload)`).
- Preload wraps this in `ipcRenderer.invoke(IPC_CHANNELS.SALES.CREATE, payload)`.
- Main process handler in `electron/main/ipc/register-handlers.ts` intercepts the channel, passes the request to `SalesService.createSale()`, and returns the typed response or error.

### 5.3. Where the SQLite Database is Stored
- **Development & Portable Mode**: Stored locally in `<project_root>/data/pos-database.sqlite`.
- **Installed Windows Desktop Mode**: Stored in `%APPDATA%/Modern Retail POS/data/pos-database.sqlite`.
- Uses SQLite Write-Ahead Logging (`WAL`), `PRAGMA foreign_keys = ON`, and `PRAGMA busy_timeout = 5000`.

### 5.4. How Migrations Are Executed
- Managed by `migration-runner.ts` in `src/infrastructure/sqlite/migrations/`.
- Queries the `schema_migrations` table for the latest applied migration version.
- Executes unapplied versioned migrations sequentially (`001_initial_schema`, `002_enterprise_schema`, `003_part3_scale_snapshots`) inside atomic SQLite transactions.

### 5.5. How Business Calculations Are Shared
- Domain calculators reside in `src/domain/` as pure TypeScript functions and classes.
- Used identically by backend application services (to validate and commit authoritative numbers) and accessible to renderer for real-time pricing and tax previews without duplicating code.

### 5.6. How Windows Packaging Works
- Configured via `electron-builder` in `package.json` (`npm run package:win`).
- Compiles Node backend (`npm run build:node`) and Vite frontend (`npm run build:renderer`).
- Packages native binaries into:
  - **NSIS Windows Installer (`.exe`)**: Desktop and Start Menu shortcuts, custom install directory.
  - **Portable Executable (`.exe`)**: Zero-install standalone desktop runner.

### 5.7. How the Application Runs 100% Without Internet
- **Local SQLite Engine**: Embedded C-based SQLite database with zero cloud requirements.
- **Local User Authentication**: Password hashes checked locally with bcrypt.
- **Offline Thermal Printing**: Direct local USB/COM/LPT thermal receipt printing using ESC/POS and Electron native print.
- **Local Automated Backups**: SQLite database snapshots saved to local disk or USB drive.
- **Zero Cloud Dependencies**: The system operates with full functionality when completely disconnected from the internet.

```

