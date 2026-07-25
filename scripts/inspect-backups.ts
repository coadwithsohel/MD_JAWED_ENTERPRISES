import fs from "fs";
import path from "path";

const BACKUP_DIR = path.join(__dirname, "../backups");

function inspect() {
  const files = fs.readdirSync(BACKUP_DIR);
  for (const file of files) {
    if (file.endsWith(".json")) {
      const fullPath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(fullPath);
      if (stat.size < 10) continue;
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        if (Array.isArray(content)) {
          console.log(`${file}: ${content.length} items (size: ${(stat.size / 1024).toFixed(1)} KB)`);
        } else if (typeof content === "object") {
          console.log(`${file}: object with keys [${Object.keys(content).join(", ")}]`);
        }
      } catch (err) {
        console.log(`${file}: invalid JSON`);
      }
    }
  }
}

inspect();
