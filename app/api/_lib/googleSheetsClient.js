// app/api/_lib/googleSheetsClient.js

import { google } from "googleapis";
import { pickServiceAccount } from "./pickServiceAccount";

let _sheets = null;

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  const sa = pickServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

/**
 * Read values from a range A1 notation.
 * opts.valueRenderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA"
 */
export async function readValues(rangeA1, opts = {}) {
  const sheets = await getSheetsClient();

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID env.");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption: opts.valueRenderOption || "UNFORMATTED_VALUE",
  });

  return res.data.values || [];
}