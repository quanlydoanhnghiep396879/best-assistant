import fs from "fs";
import path from "path";

export function getServiceAccount() {
  const filePath = path.join(process.cwd(), "keys", "kpi.json");
  const json = fs.readFileSync(filePath, "utf8");
  return JSON.parse(json);
}