import { google } from "googleapis";

export async function getSheetsClient(service) {
  const auth = new google.auth.JWT(
    service.client_email,
    null,
    service.private_key,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );

  return google.sheets({ version: "v4", auth });
}