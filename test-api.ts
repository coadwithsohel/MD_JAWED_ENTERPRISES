import { signToken } from "./src/lib/auth";

async function testApi() {
  const token = signToken({ userId: "mock-user-id", role: "ADMIN", mobile: "9876543210" });
  
  const res = await fetch("http://localhost:3000/api/reports/profit-loss?period=monthly&year=2026&month=7", {
    headers: {
      "Cookie": `mdjaved_session=${token}`
    }
  });
  
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", text);
}
testApi();
