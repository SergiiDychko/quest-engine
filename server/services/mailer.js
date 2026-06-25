function cleanEnv(value) {
  let result = String(value || "").trim();

  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1).trim();
  }

  return result
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

function isPlaceholder(value) {
  const cleaned = cleanEnv(value).toLowerCase();

  return (
    !cleaned ||
    cleaned.includes("example.com") ||
    cleaned.includes("your-domain.com") ||
    cleaned.includes("your-smtp") ||
    cleaned.includes("replace-with")
  );
}

function getPublicBaseUrl(req) {
  const configured = cleanEnv(process.env.APP_BASE_URL).replace(/\/$/, "");
  if (configured && !isPlaceholder(configured)) return configured;

  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${protocol}://${host}`;
}

function isMailConfigured() {
  return Boolean(
    !isPlaceholder(process.env.SMTP_HOST) &&
    !isPlaceholder(process.env.SMTP_PORT) &&
    !isPlaceholder(process.env.SMTP_USER) &&
    !isPlaceholder(process.env.SMTP_PASS) &&
    !isPlaceholder(process.env.MAIL_FROM)
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
    host: cleanEnv(process.env.SMTP_HOST),
    port: Number(cleanEnv(process.env.SMTP_PORT)),
    secure: cleanEnv(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: {
      user: cleanEnv(process.env.SMTP_USER),
      pass: cleanEnv(process.env.SMTP_PASS)
    }
  });
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const transporter = createTransporter();

  if (!transporter) {
    return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  await transporter.sendMail({
    from: cleanEnv(process.env.MAIL_FROM),
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
  cleanEnv,
  getPublicBaseUrl,
  isMailConfigured,
  sendPasswordResetEmail
};
