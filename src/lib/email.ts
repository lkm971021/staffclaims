import "server-only";
import nodemailer from "nodemailer";

/** Optional SMTP email. If SMTP_HOST is not set, notifications are in-app only. */
export const emailEnabled = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);

let transport: nodemailer.Transporter | null = null;

export async function sendEmail(to: string, subject: string, text: string) {
  if (!emailEnabled()) return { skipped: true };
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
  return { skipped: false };
}
