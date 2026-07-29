const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  const admin = await prisma.user.findFirst();
  console.log("Admin:", admin?.id);

  // 1. Initial State
  console.log("--- 1. INITIAL STATE ---");
  let pl1 = await fetch("http://localhost:3000/api/reports/profit-loss?month=7&year=2026").then(r => r.json());
  console.log(`Total Expenses: ${pl1.totalExpenses}, Net Profit: ${pl1.netProfit}`);
  
  // 2. Add Expense
  console.log("\n--- 2. CREATING EXPENSE (1000) ---");
  const exp = await prisma.expense.create({
    data: {
      category: "ELECTRICITY_BILL",
      amount: 1000,
      expenseDate: new Date("2026-07-15T00:00:00Z"),
      description: "Test",
      createdById: admin.id
    }
  });
  let pl2 = await fetch("http://localhost:3000/api/reports/profit-loss?month=7&year=2026").then(r => r.json());
  console.log(`Total Expenses: ${pl2.totalExpenses}, Net Profit: ${pl2.netProfit}`);

  // 3. Edit Expense
  console.log("\n--- 3. EDITING EXPENSE (800) ---");
  await prisma.expense.update({ where: { id: exp.id }, data: { amount: 800 } });
  
  let pl3 = await fetch("http://localhost:3000/api/reports/profit-loss?month=7&year=2026").then(r => r.json());
  console.log(`Total Expenses: ${pl3.totalExpenses}, Net Profit: ${pl3.netProfit}`);

  // 4. Void Expense
  console.log("\n--- 4. VOIDING EXPENSE ---");
  await prisma.expense.update({ where: { id: exp.id }, data: { status: "VOIDED", voidedAt: new Date() } });
  let pl4 = await fetch("http://localhost:3000/api/reports/profit-loss?month=7&year=2026").then(r => r.json());
  console.log(`Total Expenses: ${pl4.totalExpenses}, Net Profit: ${pl4.netProfit}`);

  console.log("\n--- 5. CLEANING UP ---");
  await prisma.expense.delete({ where: { id: exp.id } });
  console.log("Done.");
}

check().catch(console.error).finally(() => prisma.$disconnect());
