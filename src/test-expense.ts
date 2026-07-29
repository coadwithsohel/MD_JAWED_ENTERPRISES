import { PrismaClient } from "@prisma/client";
import { getProfitAndLoss } from "./lib/profit-loss";

const prisma = new PrismaClient();

async function run() {
  const admin = await prisma.user.findFirst();
  
  console.log("--- BEFORE EXPENSE ---");
  const pl1 = await getProfitAndLoss({ period: "monthly", month: 7, year: 2026 });
  console.log(`Net Profit: ${pl1.netProfit}, Total Expenses: ${pl1.totalExpenses}`);

  console.log("\n--- CREATING EXPENSE ---");
  const expense = await prisma.expense.create({
    data: {
      category: "ELECTRICITY_BILL",
      amount: 1000,
      expenseDate: new Date("2026-07-15T12:00:00Z"),
      description: "Test",
      createdById: admin!.id
    }
  });

  console.log("\n--- AFTER EXPENSE ---");
  const pl2 = await getProfitAndLoss({ period: "monthly", month: 7, year: 2026 });
  console.log(`Net Profit: ${pl2.netProfit}, Total Expenses: ${pl2.totalExpenses}`);

  console.log("\n--- CLEANING UP ---");
  await prisma.expense.delete({ where: { id: expense.id } });
  
  console.log("\nDone.");
}

run().catch(console.error).finally(() => prisma.$disconnect());
