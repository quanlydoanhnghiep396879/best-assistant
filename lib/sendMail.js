import nodemailer from "nodemailer";

export async function sendMail({ subject, html }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,           // vietduc20042020@gmail.com
      pass: process.env.GMAIL_APP_PASSWORD,   // app password (liền, không cách)
    },
  });

  const info = await transporter.sendMail({
    from: `Best Assistant <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER, // gửi cho chính em
    subject,
    html,
  });

  console.log("📧 Mail sent:", info.messageId);
}