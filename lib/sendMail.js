import nodemailer from "nodemailer";

export async function sendMail({ subject, html }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log("⚠️ Missing mail env, skip sending");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD, // app password (16 ký tự, KHÔNG CÁCH)
    },
  });

  await transporter.sendMail({
    from: `KPI Assistant <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject,
    html,
  });

  console.log("📧 Mail sent:", subject);
}