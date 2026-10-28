"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountType = exports.StockMovementType = exports.SaleStatus = exports.PaymentMethod = exports.Permission = exports.Role = void 0;
const roles_permissions_1 = require("../constants/roles-permissions");
Object.defineProperty(exports, "Role", { enumerable: true, get: function () { return roles_permissions_1.Role; } });
Object.defineProperty(exports, "Permission", { enumerable: true, get: function () { return roles_permissions_1.Permission; } });
const accounts_1 = require("../constants/accounts");
Object.defineProperty(exports, "PaymentMethod", { enumerable: true, get: function () { return accounts_1.PaymentMethod; } });
Object.defineProperty(exports, "SaleStatus", { enumerable: true, get: function () { return accounts_1.SaleStatus; } });
Object.defineProperty(exports, "StockMovementType", { enumerable: true, get: function () { return accounts_1.StockMovementType; } });
Object.defineProperty(exports, "AccountType", { enumerable: true, get: function () { return accounts_1.AccountType; } });
__exportStar(require("./enterprise-core"), exports);
