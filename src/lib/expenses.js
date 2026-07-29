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
exports.createExpense = createExpense;
exports.getExpenses = getExpenses;
exports.editExpense = editExpense;
exports.voidExpense = voidExpense;
exports.deleteExpense = deleteExpense;
var monthly_sales_1 = require("./monthly-sales");
var prisma_1 = require("./prisma");
function createExpense(data) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, prisma_1.prisma.expense.create({
                        data: {
                            category: data.category,
                            amount: data.amount,
                            expenseDate: data.expenseDate,
                            description: data.description,
                            referenceNumber: data.referenceNumber,
                            createdById: data.createdById,
                        }
                    })];
                case 1: return [2 /*return*/, _a.sent()];
            }
        });
    });
}
function getExpenses(month, year) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, start, end;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = (0, monthly_sales_1.getISTMonthBoundaries)(year, month), start = _a.start, end = _a.end;
                    return [4 /*yield*/, prisma_1.prisma.expense.findMany({
                            where: {
                                status: "COMPLETED",
                                expenseDate: {
                                    gte: start,
                                    lte: end
                                }
                            },
                            include: {
                                createdBy: {
                                    select: { fullName: true }
                                }
                            },
                            orderBy: { expenseDate: 'desc' }
                        })];
                case 1: return [2 /*return*/, _b.sent()];
            }
        });
    });
}
function editExpense(id, data) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, prisma_1.prisma.expense.update({
                        where: { id: id },
                        data: data
                    })];
                case 1: return [2 /*return*/, _a.sent()];
            }
        });
    });
}
function voidExpense(id, reason) {
    return __awaiter(this, void 0, void 0, function () {
        var current;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, prisma_1.prisma.expense.findUnique({ where: { id: id } })];
                case 1:
                    current = _a.sent();
                    if ((current === null || current === void 0 ? void 0 : current.status) === "VOIDED")
                        return [2 /*return*/, current];
                    return [4 /*yield*/, prisma_1.prisma.expense.update({
                            where: { id: id },
                            data: {
                                status: "VOIDED",
                                voidedAt: new Date(),
                                voidReason: reason || "Voided by user"
                            }
                        })];
                case 2: return [2 /*return*/, _a.sent()];
            }
        });
    });
}
function deleteExpense(id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, voidExpense(id, "Deleted via UI (soft-delete mapping)")];
        });
    });
}
