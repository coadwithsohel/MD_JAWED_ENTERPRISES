import { getProfitAndLoss } from "./src/lib/profit-loss";

async function main() {
  try {
    const report = await getProfitAndLoss({ period: "yearly", year: 2026 });
    console.log("Success:", JSON.stringify(report, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
