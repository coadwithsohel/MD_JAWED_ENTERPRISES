const http = require("http");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");

const prisma = new PrismaClient();

async function check() {
  const user = await prisma.user.findFirst();
  const token = jwt.sign({ userId: user.id, role: user.role, mobile: user.mobile }, process.env.JWT_SECRET, { expiresIn: "7d" });

  const req = http.get("http://localhost:3000/api/reports/profit-loss?month=7&year=2026", {
    headers: {
      "Cookie": `mdjaved_session=${token}`
    }
  }, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => {
      console.log("STATUS:", res.statusCode);
      console.log("BODY:", data);
    });
  });
  req.on("error", console.error);
}
require("dotenv").config();
check();
