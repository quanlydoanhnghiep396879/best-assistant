import nodemailer from "nodemailer";

export async function sendMail({ subject, html }) {
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new Error("❌ Missing GMAIL_USER or GMAIL_APP_PASSWORD");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD, // App Password (16 ký tự, KHÔNG dấu cách)
    },
  });

  const info = await transporter.sendMail({
    from: `"KPI Assistant" <${GMAIL_USER}>`,
    to: GMAIL_USER, // gửi cho chính mình (demo)
    subject,
    html,
  });

  console.log("📧 Mail sent:", info.messageId);
}