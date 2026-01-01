// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function fromBase64(s) {
  if (!s) return "";
  return Buffer.from(s, "base64").toString("utf8");
}

function normalizePrivateKey(pk) {
  if (!pk) return "";
  // Vercel thường lưu private_key dạng có \\n
  return pk.replace(/\\n/g, "\n");
}

function loadServiceAccount() {
  // Ưu tiên theo những biến bạn đang có trên Vercel
  const jsonRaw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    fromBase64(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64);

  if (jsonRaw) {
    try {
      const obj = JSON.parse(jsonRaw);
      if (obj.private_key) obj.private_key = normalizePrivateKey(obj.private_key);
      return obj;
    } catch (e) {
      throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON / BASE64 (JSON parse failed)");
    }
  }

  // fallback: tách riêng email + key
  const client_email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    "";

  const private_key =
    normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY || "") ||
    normalizePrivateKey(fromBase64(process.env.GOOGLE_PRIVATE_KEY_BASE64 || ""));

  if (!client_email || !private_key) {
    throw new Error(
      "Missing service account env. Provide GOOGLE_SERVICE_ACCOUNT_JSON (recommended) or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY(_BASE64)."
    );
  }

  return {
    client_email,
    private_key,
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

let _sheets = null;

export function getSheetsClient() {
  if (_sheets) return _sheets;

  const sa = loadServiceAccount();
  const auth = new google.auth.JWT(sa.client_email, null, sa.private_key, SCOPES);
  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

export function getSheetId() {
  const id = process.env.GOOGLE_SHEET_ID || "";
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID");
  return id;
}

export function sheetNames() {
  return {
    KPI_SHEET_NAME: process.env.KPI_SHEET_NAME || "KPI",
    CONFIG_KPI_SHEET_NAME: process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI",
  };
}

export async function readValues(rangeA1) {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return res.data.values || [];
}