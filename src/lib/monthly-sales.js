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
exports.getISTMonthBoundaries = getISTMonthBoundaries;
exports.formatISTDate = formatISTDate;
exports.getMonthlySales = getMonthlySales;
var client_1 = require("@prisma/client");
var library_1 = require("@prisma/client/runtime/library");
var prisma = new client_1.PrismaClient();
function getISTMonthBoundaries(year, month) {
    // month is 1-12
    // start of month in IST
    // Since we want exactly calendar month in Asia/Kolkata
    // We can construct the date in IST and convert to UTC
    // Using string format "YYYY-MM-01T00:00:00+05:30"
    var formattedMonth = month.toString().padStart(2, '0');
    var nextMonthNum = month === 12 ? 1 : month + 1;
    var nextYearNum = month === 12 ? year + 1 : year;
    var formattedNextMonth = nextMonthNum.toString().padStart(2, '0');
    var startIstString = "".concat(year, "-").concat(formattedMonth, "-01T00:00:00+05:30");
    var endIstString = "".concat(nextYearNum, "-").concat(formattedNextMonth, "-01T00:00:00+05:30");
    var startUtc = new Date(startIstString);
    var endUtc = new Date(new Date(endIstString).getTime() - 1); // 1 ms before next month start
    return { start: startUtc, end: endUtc };
}
function formatISTDate(date) {
    var istOffset = 5.5 * 60 * 60 * 1000;
    var istDate = new Date(date.getTime() + istOffset);
    var y = istDate.getUTCFullYear();
    var m = (istDate.getUTCMonth() + 1).toString().padStart(2, '0');
    var d = istDate.getUTCDate().toString().padStart(2, '0');
    return "".concat(y, "-").concat(m, "-").concat(d);
}
function getMonthlySales(month, year) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, start, end, prevMonth, prevYear, _b, prevStart, prevEnd, validStatus, currentMonthSales, prevMonthSales, totalSales, cashSales, creditSales, invoiceCount, dailyMap, _i, currentMonthSales_1, sale, amt, isCash, accDate, dateStr, dayStat, prevTotalSales, _c, prevMonthSales_1, p, growthPercent, currentTotal, prevTotal, dailyBreakdown;
        var _d, _e, _f, _g;
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0:
                    _a = getISTMonthBoundaries(year, month), start = _a.start, end = _a.end;
                    prevMonth = month === 1 ? 12 : month - 1;
                    prevYear = month === 1 ? year - 1 : year;
                    _b = getISTMonthBoundaries(prevYear, prevMonth), prevStart = _b.start, prevEnd = _b.end;
                    validStatus = ["COMPLETED"];
                    return [4 /*yield*/, prisma.sale.findMany({
                            where: {
                                status: { in: validStatus },
                                voidedAt: null, // exclude voided
                                OR: [
                                    { saleDate: { gte: start, lte: end } },
                                    { saleDate: null, createdAt: { gte: start, lte: end } }
                                ]
                            },
                            select: {
                                id: true,
                                saleDate: true,
                                createdAt: true,
                                saleType: true,
                                grandTotal: true,
                            }
                        })];
                case 1:
                    currentMonthSales = _h.sent();
                    return [4 /*yield*/, prisma.sale.findMany({
                            where: {
                                status: { in: validStatus },
                                voidedAt: null,
                                OR: [
                                    { saleDate: { gte: prevStart, lte: prevEnd } },
                                    { saleDate: null, createdAt: { gte: prevStart, lte: prevEnd } }
                                ]
                            },
                            select: {
                                grandTotal: true
                            }
                        })];
                case 2:
                    prevMonthSales = _h.sent();
                    totalSales = new library_1.Decimal(0);
                    cashSales = new library_1.Decimal(0);
                    creditSales = new library_1.Decimal(0);
                    invoiceCount = currentMonthSales.length;
                    dailyMap = new Map();
                    for (_i = 0, currentMonthSales_1 = currentMonthSales; _i < currentMonthSales_1.length; _i++) {
                        sale = currentMonthSales_1[_i];
                        amt = (_d = sale.grandTotal) !== null && _d !== void 0 ? _d : new library_1.Decimal(0);
                        totalSales = totalSales.add(amt);
                        isCash = sale.saleType === "CASH";
                        if (isCash) {
                            cashSales = cashSales.add(amt);
                        }
                        else {
                            creditSales = creditSales.add(amt);
                        }
                        accDate = (_e = sale.saleDate) !== null && _e !== void 0 ? _e : sale.createdAt;
                        dateStr = formatISTDate(accDate);
                        dayStat = (_f = dailyMap.get(dateStr)) !== null && _f !== void 0 ? _f : {
                            date: dateStr,
                            invoiceCount: 0,
                            cashSales: 0,
                            creditSales: 0,
                            totalSales: 0
                        };
                        dayStat.invoiceCount += 1;
                        dayStat.totalSales += amt.toNumber();
                        if (isCash)
                            dayStat.cashSales += amt.toNumber();
                        else
                            dayStat.creditSales += amt.toNumber();
                        dailyMap.set(dateStr, dayStat);
                    }
                    prevTotalSales = new library_1.Decimal(0);
                    for (_c = 0, prevMonthSales_1 = prevMonthSales; _c < prevMonthSales_1.length; _c++) {
                        p = prevMonthSales_1[_c];
                        prevTotalSales = prevTotalSales.add((_g = p.grandTotal) !== null && _g !== void 0 ? _g : new library_1.Decimal(0));
                    }
                    growthPercent = null;
                    currentTotal = totalSales.toNumber();
                    prevTotal = prevTotalSales.toNumber();
                    if (prevTotal === 0) {
                        if (currentTotal > 0)
                            growthPercent = 100;
                        else
                            growthPercent = 0;
                    }
                    else {
                        growthPercent = ((currentTotal - prevTotal) / prevTotal) * 100;
                    }
                    dailyBreakdown = Array.from(dailyMap.values()).sort(function (a, b) { return a.date.localeCompare(b.date); });
                    return [2 /*return*/, {
                            month: month,
                            year: year,
                            totalSales: currentTotal,
                            invoiceCount: invoiceCount,
                            cashSales: cashSales.toNumber(),
                            creditSales: creditSales.toNumber(),
                            averageInvoiceValue: invoiceCount > 0 ? currentTotal / invoiceCount : 0,
                            growthPercent: growthPercent !== null ? Number(growthPercent.toFixed(2)) : null,
                            dailyBreakdown: dailyBreakdown
                        }];
            }
        });
    });
}
