// app/api/_lib/pickServiceAccount.js

function tryJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function fromBase64(b64) {
  return Buffer.from(b64, "base64").toString("utf8");
}

// Trả về object { client_email, private_key } hoặc null
export function pickServiceAccount() {
  // 1) JSON Base64
  const b64 =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 ||
    "";

  if (b64) {
    const jsonText = fromBase64(b64);
    const obj = tryJsonParse(jsonText);
    if (obj?.client_email && obj?.private_key) {
      return {
        client_email: obj.client_email,
        private_key: obj.private_key,
      };
    }
  }

  // 2) JSON raw
  const jsonRaw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT ||
    "";

  if (jsonRaw) {
    const obj = tryJsonParse(jsonRaw);
    if (obj?.client_email && obj?.private_key) {
      return {
        client_email: obj.client_email,
        private_key: obj.private_key,
      };
    }
  }

  // 3) email + private_key
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL ||
    "";

  let privateKey =
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    "";

  const privateKeyB64 =
    process.env.GOOGLE_PRIVATE_KEY_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 ||
    "";

  if (!privateKey && privateKeyB64) {
    privateKey = fromBase64(privateKeyB64);
  }

  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  if (email && privateKey) return { client_email: email, private_key: privateKey };

  return null;
}