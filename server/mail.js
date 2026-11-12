import nodemailer from "nodemailer";
export function assertMailConfiguration() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.EMAIL_PROVIDER === "brevo") {
    if (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM_ADDRESS)
      throw new Error("Configure BREVO_API_KEY and EMAIL_FROM_ADDRESS.");
  } else if (!process.env.SMTP_HOST)
    throw new Error(
      "Configure SMTP or the Brevo email API for verification and password reset emails.",
    );
}
export async function sendMail(message) {
  if (process.env.EMAIL_PROVIDER === "brevo") {
    assertMailConfiguration();
    const result = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "UniArchive", email: process.env.EMAIL_FROM_ADDRESS },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!result.ok)
      throw Object.assign(
        new Error(
          "Verification email could not be sent. Try resending later or contact the administrator.",
        ),
        { status: 503 },
      );
    return;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        }
      : {}),
  });
  await transport.sendMail(message);
}
