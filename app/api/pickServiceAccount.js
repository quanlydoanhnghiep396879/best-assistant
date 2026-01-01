// app/api/_lib/pickServiceAccount.js

function tryJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function pickServiceAccount() {
  // ƯU TIÊN: JSON base64
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    const jsonText = Buffer.from(b64, "base64").toString("utf8");
    const obj = tryJsonParse(jsonText);
    if (obj) return obj;
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid JSON (after base64 decode).");
  }

  // THỨ 2: JSON raw
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const obj = tryJsonParse(raw);
    if (obj) return obj;
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }

  // FALLBACK: tách email + private key
  const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let private_key = process.env.GOOGLE_PRIVATE_KEY;

  if (client_email && private_key) {
    // Vercel thường lưu key dạng có \n
    private_key = private_key.replace(/\\n/g, "\n");
    return {
      type: "service_account",
      client_email,
      private_key,
      token_uri: "https://oauth2.googleapis.com/token",
    };
  }

  throw new Error(
    "Missing service account env. Provide GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 (recommended) or GOOGLE_SERVICE_ACCOUNT_JSON or (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY)."
  );
}