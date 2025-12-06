import { google } from "googleapis";
import path from "path";
import fs from "fs";

const KEY_FILE = path.join(process.cwd(), "kpi-automation-api-7c097161191e.json");

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export { getSheetsClient };

