const http = require("http");

async function check() {
  const req = http.get("http://localhost:3000/api/reports/profit-loss?month=7&year=2026", {
    headers: {
      "Cookie": "mdjaved_session=ey... (Not strictly needed if auth passes or I can bypass it for the test)"
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
