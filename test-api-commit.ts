import { prisma } from "./src/lib/prisma";
import { signToken } from "./src/lib/auth";

async function testApi() {
  const admin = await prisma.user.findFirst({ where: { role: "OWNER" as any } });
  if (!admin) {
    console.log("No OWNER found");
    return;
  }
  const token = signToken({ userId: admin.id, role: admin.role, mobile: admin.mobile });
  
  const res = await fetch("http://localhost:3000/api/reports/profit-loss?period=yearly&year=2026", {
    headers: {
      "Cookie": `mdjaved_session=${token}`
    }
  });
  console.log(await res.json());
}
testApi();
