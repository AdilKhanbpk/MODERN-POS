"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockMovementType = exports.SaleStatus = exports.PaymentMethod = exports.StandardAccountCode = exports.AccountType = void 0;
var AccountType;
(function (AccountType) {
    AccountType["ASSET"] = "ASSET";
    AccountType["LIABILITY"] = "LIABILITY";
    AccountType["EQUITY"] = "EQUITY";
    AccountType["REVENUE"] = "REVENUE";
    AccountType["EXPENSE"] = "EXPENSE";
})(AccountType || (exports.AccountType = AccountType = {}));
var StandardAccountCode;
(function (StandardAccountCode) {
    StandardAccountCode["CASH_ON_HAND"] = "1010";
    StandardAccountCode["BANK_ACCOUNT"] = "1020";
    StandardAccountCode["ACCOUNTS_RECEIVABLE"] = "1030";
    StandardAccountCode["INVENTORY_ASSET"] = "1040";
    StandardAccountCode["EQUIPMENT"] = "1050";
    StandardAccountCode["ACCOUNTS_PAYABLE"] = "2010";
    StandardAccountCode["SALES_TAX_PAYABLE"] = "2020";
    StandardAccountCode["SALARY_PAYABLE"] = "2030";
    StandardAccountCode["OWNERS_EQUITY"] = "3010";
    StandardAccountCode["RETAINED_EARNINGS"] = "3020";
    StandardAccountCode["SALES_REVENUE"] = "4010";
    StandardAccountCode["DISCOUNTS_ALLOWED"] = "4020";
    StandardAccountCode["RETURNS_REFUNDS"] = "4030";
    StandardAccountCode["COST_OF_GOODS_SOLD"] = "5010";
    StandardAccountCode["SALARY_EXPENSE"] = "5020";
    StandardAccountCode["RENT_EXPENSE"] = "5030";
    StandardAccountCode["UTILITIES_EXPENSE"] = "5040";
    StandardAccountCode["GENERAL_EXPENSE"] = "5050";
})(StandardAccountCode || (exports.StandardAccountCode = StandardAccountCode = {}));
var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["CASH"] = "CASH";
    PaymentMethod["CARD"] = "CARD";
    PaymentMethod["BANK_TRANSFER"] = "BANK_TRANSFER";
    PaymentMethod["CREDIT"] = "CREDIT";
    PaymentMethod["SPLIT"] = "SPLIT";
})(PaymentMethod || (exports.PaymentMethod = PaymentMethod = {}));
var SaleStatus;
(function (SaleStatus) {
    SaleStatus["COMPLETED"] = "COMPLETED";
    SaleStatus["REFUNDED"] = "REFUNDED";
    SaleStatus["VOIDED"] = "VOIDED";
})(SaleStatus || (exports.SaleStatus = SaleStatus = {}));
var StockMovementType;
(function (StockMovementType) {
    StockMovementType["SALE"] = "SALE";
    StockMovementType["SALE_RETURN"] = "SALE_RETURN";
    StockMovementType["PURCHASE_RECEIPT"] = "PURCHASE_RECEIPT";
    StockMovementType["PURCHASE_RETURN"] = "PURCHASE_RETURN";
    StockMovementType["ADJUSTMENT_ADD"] = "ADJUSTMENT_ADD";
    StockMovementType["ADJUSTMENT_DAMAGE"] = "ADJUSTMENT_DAMAGE";
    StockMovementType["ADJUSTMENT_THEFT"] = "ADJUSTMENT_THEFT";
    StockMovementType["INITIAL_COUNT"] = "INITIAL_COUNT";
})(StockMovementType || (exports.StockMovementType = StockMovementType = {}));
