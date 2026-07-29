import { ExpenseCategory } from "@prisma/client";
import { getISTMonthBoundaries, formatISTDate } from "./monthly-sales";

import { prisma } from "./prisma";

export async function createExpense(data: {
  category: ExpenseCategory;
  amount: number;
  expenseDate: Date;
  description?: string;
  referenceNumber?: string;
  createdById: string;
}) {
  return await prisma.expense.create({
    data: {
      category: data.category,
      amount: data.amount,
      expenseDate: data.expenseDate,
      description: data.description,
      referenceNumber: data.referenceNumber,
      createdById: data.createdById,
    }
  });
}

export async function getExpenses(month: number, year: number) {
  const { start, end } = getISTMonthBoundaries(year, month);
  
  return await prisma.expense.findMany({
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
  });
}

export async function editExpense(id: string, data: {
  amount?: number;
  category?: ExpenseCategory;
  expenseDate?: Date;
  description?: string;
}) {
  return await prisma.expense.update({
    where: { id },
    data
  });
}

export async function voidExpense(id: string, reason?: string) {
  // Check if already voided
  const current = await prisma.expense.findUnique({ where: { id } });
  if (current?.status === "VOIDED") return current;

  return await prisma.expense.update({
    where: { id },
    data: {
      status: "VOIDED",
      voidedAt: new Date(),
      voidReason: reason || "Voided by user"
    }
  });
}

export async function deleteExpense(id: string) {
  return voidExpense(id, "Deleted via UI (soft-delete mapping)");
}
