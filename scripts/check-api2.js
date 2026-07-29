const http = require("http");
const jwt = require("jsonwebtoken");
const fs = require("fs");

function getSecret() {
  const env = fs.readFileSync(".env", "utf8");
  const match = env.match(/JWT_SECRET=(.*)/);
  return match ? match[1].trim() : "test-secret";
}

async function check() {
  const token = jwt.sign({ userId: "1", role: "ADMIN", mobile: "1234567890" }, getSecret(), { expiresIn: "7d" });

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
check();
