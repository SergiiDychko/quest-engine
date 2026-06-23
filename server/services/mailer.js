function getPublicBaseUrl(req) {
  const configured = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;

  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${protocol}://${host}`;
}

function isMailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.MAIL_FROM
  );
}

function createTransporter() {
  if (!isMailConfigured()) return null;

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (error) {
    console.error("Nodemailer is not installed. Run: npm install");
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const transporter = createTransporter();

  if (!transporter) {
    return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: "Відновлення пароля Quest Engine",
    text: [
      "Ви отримали цей лист, бо для вашого профілю Quest Engine було запитано відновлення пароля.",
      "",
      "Щоб створити новий пароль, відкрийте посилання:",
      resetUrl,
      "",
      "Посилання дійсне протягом 1 години.",
      "Якщо ви не запитували відновлення пароля, просто проігноруйте цей лист."
    ].join("\n"),
    html: `
      <p>Ви отримали цей лист, бо для вашого профілю <strong>Quest Engine</strong> було запитано відновлення пароля.</p>
      <p><a href="${resetUrl}">Створити новий пароль</a></p>
      <p>Посилання дійсне протягом 1 години.</p>
      <p>Якщо ви не запитували відновлення пароля, просто проігноруйте цей лист.</p>
    `
  });

  return { sent: true };
}

module.exports = {
  getPublicBaseUrl,
  isMailConfigured,
  sendPasswordResetEmail
};
