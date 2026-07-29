"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfitAndLoss = getProfitAndLoss;
exports.getYearlyProfitAndLoss = getYearlyProfitAndLoss;
var monthly_sales_1 = require("./monthly-sales");
var expenses_1 = require("./expenses");
var prisma_1 = require("./prisma");
function getProfitAndLoss(month, year) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, start, end, salesSummary, grossSales, cashSales, creditSales, invoiceCount, returnedSales, salesReturns, netSales, validStatus, currentSales, currentSaleIds, costOfGoodsSold, completeInvoices, missingCostInvoices, _i, currentSaleIds_1, saleId, saleItems, saleHasMissingCost, saleCost, _b, saleItems_1, item, cost, coveragePercent, grossProfit, rawExpenses, totalExpenses, expMap, _c, rawExpenses_1, exp, amt, expensesByCategory, netProfit, profitMargin;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _a = (0, monthly_sales_1.getISTMonthBoundaries)(year, month), start = _a.start, end = _a.end;
                    return [4 /*yield*/, (0, monthly_sales_1.getMonthlySales)(month, year)];
                case 1:
                    salesSummary = _d.sent();
                    grossSales = salesSummary.totalSales;
                    cashSales = salesSummary.cashSales;
                    creditSales = salesSummary.creditSales;
                    invoiceCount = salesSummary.invoiceCount;
                    return [4 /*yield*/, prisma_1.prisma.sale.aggregate({
                            _sum: { grandTotal: true },
                            where: {
                                status: { in: ["RETURNED", "PARTIALLY_RETURNED"] },
                                voidedAt: null,
                                OR: [
                                    { saleDate: { gte: start, lte: end } },
                                    { saleDate: null, createdAt: { gte: start, lte: end } }
                                ]
                            }
                        })];
                case 2:
                    returnedSales = _d.sent();
                    salesReturns = Number(returnedSales._sum.grandTotal || 0);
                    netSales = grossSales - salesReturns;
                    validStatus = ["COMPLETED"];
                    return [4 /*yield*/, prisma_1.prisma.sale.findMany({
                            where: {
                                status: { in: validStatus },
                                voidedAt: null,
                                OR: [
                                    { saleDate: { gte: start, lte: end } },
                                    { saleDate: null, createdAt: { gte: start, lte: end } }
                                ]
                            },
                            select: { id: true }
                        })];
                case 3:
                    currentSales = _d.sent();
                    currentSaleIds = currentSales.map(function (s) { return s.id; });
                    costOfGoodsSold = 0;
                    completeInvoices = 0;
                    missingCostInvoices = 0;
                    if (!(currentSaleIds.length > 0)) return [3 /*break*/, 7];
                    _i = 0, currentSaleIds_1 = currentSaleIds;
                    _d.label = 4;
                case 4:
                    if (!(_i < currentSaleIds_1.length)) return [3 /*break*/, 7];
                    saleId = currentSaleIds_1[_i];
                    return [4 /*yield*/, prisma_1.prisma.saleItem.findMany({
                            where: { saleId: saleId }
                        })];
                case 5:
                    saleItems = _d.sent();
                    saleHasMissingCost = false;
                    saleCost = 0;
                    for (_b = 0, saleItems_1 = saleItems; _b < saleItems_1.length; _b++) {
                        item = saleItems_1[_b];
                        cost = Number(item.purchasePriceSnapshot);
                        if (!cost || cost <= 0) {
                            saleHasMissingCost = true;
                        }
                        else {
                            saleCost += item.quantity * cost;
                        }
                    }
                    costOfGoodsSold += saleCost;
                    if (saleHasMissingCost) {
                        missingCostInvoices++;
                    }
                    else {
                        completeInvoices++;
                    }
                    _d.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 4];
                case 7:
                    coveragePercent = invoiceCount > 0 ? (completeInvoices / invoiceCount) * 100 : 100;
                    grossProfit = netSales - costOfGoodsSold;
                    return [4 /*yield*/, (0, expenses_1.getExpenses)(month, year)];
                case 8:
                    rawExpenses = _d.sent();
                    totalExpenses = 0;
                    expMap = {};
                    for (_c = 0, rawExpenses_1 = rawExpenses; _c < rawExpenses_1.length; _c++) {
                        exp = rawExpenses_1[_c];
                        amt = Number(exp.amount);
                        expMap[exp.category] = (expMap[exp.category] || 0) + amt;
                        totalExpenses += amt;
                    }
                    expensesByCategory = Object.entries(expMap).map(function (_a) {
                        var cat = _a[0], amt = _a[1];
                        return ({
                            category: cat.replace("_", " "),
                            amount: amt
                        });
                    });
                    netProfit = grossProfit - totalExpenses;
                    profitMargin = netSales > 0 ? (netProfit / netSales) * 100 : 0;
                    return [2 /*return*/, {
                            month: month,
                            year: year,
                            grossSales: grossSales,
                            cashSales: cashSales,
                            creditSales: creditSales,
                            invoiceCount: invoiceCount,
                            salesReturns: salesReturns,
                            netSales: netSales,
                            costOfGoodsSold: costOfGoodsSold,
                            grossProfit: grossProfit,
                            totalExpenses: totalExpenses,
                            expensesByCategory: expensesByCategory,
                            netProfit: netProfit,
                            profitMargin: profitMargin,
                            costDataCompleteness: {
                                completeInvoices: completeInvoices,
                                missingCostInvoices: missingCostInvoices,
                                coveragePercent: Number(coveragePercent.toFixed(2))
                            }
                        }];
            }
        });
    });
}
function getYearlyProfitAndLoss(year) {
    return __awaiter(this, void 0, void 0, function () {
        var grossSales, cashSales, creditSales, invoiceCount, salesReturns, netSales, costOfGoodsSold, grossProfit, totalExpenses, netProfit, completeInvoices, missingCostInvoices, expenseCount, expMap, monthlyBreakdown, month, mReport, rawExpenses, _i, rawExpenses_2, exp, amt, expensesByCategory, profitMargin, coveragePercent;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    grossSales = 0;
                    cashSales = 0;
                    creditSales = 0;
                    invoiceCount = 0;
                    salesReturns = 0;
                    netSales = 0;
                    costOfGoodsSold = 0;
                    grossProfit = 0;
                    totalExpenses = 0;
                    netProfit = 0;
                    completeInvoices = 0;
                    missingCostInvoices = 0;
                    expenseCount = 0;
                    expMap = {};
                    monthlyBreakdown = [];
                    month = 1;
                    _a.label = 1;
                case 1:
                    if (!(month <= 12)) return [3 /*break*/, 5];
                    return [4 /*yield*/, getProfitAndLoss(month, year)];
                case 2:
                    mReport = _a.sent();
                    grossSales += mReport.grossSales;
                    cashSales += mReport.cashSales;
                    creditSales += mReport.creditSales;
                    invoiceCount += mReport.invoiceCount;
                    salesReturns += mReport.salesReturns;
                    netSales += mReport.netSales;
                    costOfGoodsSold += mReport.costOfGoodsSold;
                    grossProfit += mReport.grossProfit;
                    totalExpenses += mReport.totalExpenses;
                    netProfit += mReport.netProfit;
                    completeInvoices += mReport.costDataCompleteness.completeInvoices;
                    missingCostInvoices += mReport.costDataCompleteness.missingCostInvoices;
                    return [4 /*yield*/, (0, expenses_1.getExpenses)(month, year)];
                case 3:
                    rawExpenses = _a.sent();
                    expenseCount += rawExpenses.length;
                    for (_i = 0, rawExpenses_2 = rawExpenses; _i < rawExpenses_2.length; _i++) {
                        exp = rawExpenses_2[_i];
                        amt = Number(exp.amount);
                        expMap[exp.category] = (expMap[exp.category] || 0) + amt;
                    }
                    monthlyBreakdown.push({
                        month: month,
                        netSales: mReport.netSales,
                        costOfGoodsSold: mReport.costOfGoodsSold,
                        grossProfit: mReport.grossProfit,
                        totalExpenses: mReport.totalExpenses,
                        netProfit: mReport.netProfit
                    });
                    _a.label = 4;
                case 4:
                    month++;
                    return [3 /*break*/, 1];
                case 5:
                    expensesByCategory = Object.entries(expMap).map(function (_a) {
                        var cat = _a[0], amt = _a[1];
                        return ({
                            category: cat.replace("_", " "),
                            amount: amt
                        });
                    });
                    profitMargin = netSales > 0 ? (netProfit / netSales) * 100 : 0;
                    coveragePercent = invoiceCount > 0 ? (completeInvoices / invoiceCount) * 100 : 100;
                    return [2 /*return*/, {
                            year: year,
                            grossSales: grossSales,
                            cashSales: cashSales,
                            creditSales: creditSales,
                            invoiceCount: invoiceCount,
                            salesReturns: salesReturns,
                            netSales: netSales,
                            costOfGoodsSold: costOfGoodsSold,
                            grossProfit: grossProfit,
                            totalExpenses: totalExpenses,
                            expensesByCategory: expensesByCategory,
                            netProfit: netProfit,
                            profitMargin: profitMargin,
                            expenseCount: expenseCount,
                            costDataCompleteness: {
                                completeInvoices: completeInvoices,
                                missingCostInvoices: missingCostInvoices,
                                coveragePercent: Number(coveragePercent.toFixed(2))
                            },
                            monthlyBreakdown: monthlyBreakdown
                        }];
            }
        });
    });
}
