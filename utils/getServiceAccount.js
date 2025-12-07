export function getServiceAccount() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error("Missing Google API credentials");
  }

  // Xử lý xuống dòng trong PRIVATE KEY
  privateKey = privateKey.replace(/\\n/g, "\n");

  return {
    client_email: email,
    private_key: privateKey,
  };
}