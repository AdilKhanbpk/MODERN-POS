"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_PERMISSIONS = exports.Permission = exports.Role = void 0;
var Role;
(function (Role) {
    Role["ADMIN"] = "ADMIN";
    Role["MANAGER"] = "MANAGER";
    Role["CASHIER"] = "CASHIER";
    Role["INVENTORY_CLERK"] = "INVENTORY_CLERK";
})(Role || (exports.Role = Role = {}));
var Permission;
(function (Permission) {
    // Sales & POS
    Permission["POS_ACCESS"] = "POS_ACCESS";
    Permission["CREATE_SALE"] = "CREATE_SALE";
    Permission["VOID_SALE"] = "VOID_SALE";
    Permission["APPLY_DISCOUNT"] = "APPLY_DISCOUNT";
    Permission["REPRINT_RECEIPT"] = "REPRINT_RECEIPT";
    Permission["PROCESS_RETURN"] = "PROCESS_RETURN";
    // Inventory
    Permission["VIEW_INVENTORY"] = "VIEW_INVENTORY";
    Permission["MANAGE_PRODUCTS"] = "MANAGE_PRODUCTS";
    Permission["ADJUST_STOCK"] = "ADJUST_STOCK";
    Permission["PURCHASE_RECEIVE"] = "PURCHASE_RECEIVE";
    // Customers & Suppliers
    Permission["MANAGE_CUSTOMERS"] = "MANAGE_CUSTOMERS";
    Permission["MANAGE_SUPPLIERS"] = "MANAGE_SUPPLIERS";
    Permission["GIVE_CUSTOMER_CREDIT"] = "GIVE_CUSTOMER_CREDIT";
    // Accounts & Expenses
    Permission["VIEW_ACCOUNTS"] = "VIEW_ACCOUNTS";
    Permission["MANAGE_EXPENSES"] = "MANAGE_EXPENSES";
    Permission["JOURNAL_ENTRIES"] = "JOURNAL_ENTRIES";
    Permission["VIEW_PROFIT_LOSS"] = "VIEW_PROFIT_LOSS";
    // Employees & Payroll
    Permission["MANAGE_EMPLOYEES"] = "MANAGE_EMPLOYEES";
    Permission["PROCESS_PAYROLL"] = "PROCESS_PAYROLL";
    // Reports
    Permission["VIEW_REPORTS"] = "VIEW_REPORTS";
    Permission["VIEW_DAILY_Z_REPORT"] = "VIEW_DAILY_Z_REPORT";
    // System & Administration
    Permission["MANAGE_USERS"] = "MANAGE_USERS";
    Permission["SYSTEM_SETTINGS"] = "SYSTEM_SETTINGS";
    Permission["BACKUP_RESTORE"] = "BACKUP_RESTORE";
})(Permission || (exports.Permission = Permission = {}));
exports.ROLE_PERMISSIONS = {
    [Role.ADMIN]: Object.values(Permission),
    [Role.MANAGER]: [
        Permission.POS_ACCESS,
        Permission.CREATE_SALE,
        Permission.VOID_SALE,
        Permission.APPLY_DISCOUNT,
        Permission.REPRINT_RECEIPT,
        Permission.PROCESS_RETURN,
        Permission.VIEW_INVENTORY,
        Permission.MANAGE_PRODUCTS,
        Permission.ADJUST_STOCK,
        Permission.PURCHASE_RECEIVE,
        Permission.MANAGE_CUSTOMERS,
        Permission.MANAGE_SUPPLIERS,
        Permission.GIVE_CUSTOMER_CREDIT,
        Permission.VIEW_ACCOUNTS,
        Permission.MANAGE_EXPENSES,
        Permission.JOURNAL_ENTRIES,
        Permission.VIEW_PROFIT_LOSS,
        Permission.MANAGE_EMPLOYEES,
        Permission.VIEW_REPORTS,
        Permission.VIEW_DAILY_Z_REPORT,
        Permission.BACKUP_RESTORE
    ],
    [Role.CASHIER]: [
        Permission.POS_ACCESS,
        Permission.CREATE_SALE,
        Permission.APPLY_DISCOUNT,
        Permission.REPRINT_RECEIPT,
        Permission.VIEW_INVENTORY,
        Permission.MANAGE_CUSTOMERS,
        Permission.VIEW_DAILY_Z_REPORT
    ],
    [Role.INVENTORY_CLERK]: [
        Permission.VIEW_INVENTORY,
        Permission.MANAGE_PRODUCTS,
        Permission.ADJUST_STOCK,
        Permission.PURCHASE_RECEIVE,
        Permission.MANAGE_SUPPLIERS
    ]
};
