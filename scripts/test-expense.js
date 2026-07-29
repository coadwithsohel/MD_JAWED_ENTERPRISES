const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { getProfitAndLoss } = require("./.next/server/app/api/reports/profit-loss/route.js");

async function run() {
  const admin = await prisma.user.findFirst();
  
  console.log("--- BEFORE EXPENSE ---");
  const pl1 = await getProfitAndLoss(7, 2026);
  console.log(`Net Profit: ${pl1.netProfit}, Total Expenses: ${pl1.totalExpenses}`);

  console.log("\n--- CREATING EXPENSE ---");
  const expense = await prisma.expense.create({
    data: {
      category: "ELECTRICITY_BILL",
      amount: 1000,
      expenseDate: new Date("2026-07-15T12:00:00Z"),
      description: "Test",
      createdById: admin.id
    }
  });

  console.log("\n--- AFTER EXPENSE ---");
  const pl2 = await getProfitAndLoss(7, 2026);
  console.log(`Net Profit: ${pl2.netProfit}, Total Expenses: ${pl2.totalExpenses}`);

  console.log("\n--- CLEANING UP ---");
  await prisma.expense.delete({ where: { id: expense.id } });
  
  console.log("\nDone.");
}

run().catch(console.error).finally(() => prisma.$disconnect());
