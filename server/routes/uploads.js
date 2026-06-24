const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Потрібна авторизація" });
  }
  next();
}

function getUploadDir() {
  const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, "../../uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

function safeImageExtension(filename, mimeType) {
  const ext = String(path.extname(filename || "")).toLowerCase();
  const allowed = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]);

  if (allowed.has(ext)) return ext;

  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/svg+xml") return ".svg";

  return "";
}

function safeVideoExtension(filename, mimeType) {
  const ext = String(path.extname(filename || "")).toLowerCase();
  const allowed = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv"]);

  if (allowed.has(ext)) return ext;

  if (mimeType === "video/mp4") return ".mp4";
  if (mimeType === "video/webm") return ".webm";
  if (mimeType === "video/quicktime") return ".mov";
  if (mimeType === "video/ogg") return ".ogv";

  return "";
}

function safeAudioExtension(filename, mimeType) {
  const ext = String(path.extname(filename || "")).toLowerCase();
  const allowed = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".webm"]);

  if (allowed.has(ext)) return ext;

  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/mp3") return ".mp3";
  if (mimeType === "audio/wav") return ".wav";
  if (mimeType === "audio/x-wav") return ".wav";
  if (mimeType === "audio/ogg") return ".ogg";
  if (mimeType === "audio/mp4") return ".m4a";
  if (mimeType === "audio/aac") return ".aac";
  if (mimeType === "audio/flac") return ".flac";
  if (mimeType === "audio/webm") return ".webm";

  return "";
}

function saveDataUrlFile({ dataUrl, filename, typePrefix, maxSizeBytes, getExtension, errorPrefix }, res) {
  const match = String(dataUrl || "").match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    return res.status(400).json({ error: `Некоректні дані файлу` });
  }

  const mimeType = match[1];
  const ext = getExtension(filename, mimeType);

  if (!ext) {
    return res.status(400).json({ error: errorPrefix });
  }

  const buffer = Buffer.from(match[2], "base64");

  if (buffer.length > maxSizeBytes) {
    return res.status(400).json({ error: `Файл завеликий. Максимум ${Math.floor(maxSizeBytes / 1024 / 1024)} МБ` });
  }

  const uploadsDir = getUploadDir();
  const fileName = `${typePrefix}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
  const filePath = path.join(uploadsDir, fileName);

  fs.writeFile(filePath, buffer, error => {
    if (error) {
      return res.status(500).json({ error: "Помилка збереження файлу" });
    }

    res.json({
      url: `/uploads/${fileName}`
    });
  });
}

router.post("/image", requireAuth, (req, res) => {
  const { filename, dataUrl } = req.body || {};

  return saveDataUrlFile({
    dataUrl,
    filename,
    typePrefix: "image",
    maxSizeBytes: 10 * 1024 * 1024,
    getExtension: safeImageExtension,
    errorPrefix: "Підтримуються лише зображення"
  }, res);
});

router.post("/video", requireAuth, (req, res) => {
  const { filename, dataUrl } = req.body || {};

  return saveDataUrlFile({
    dataUrl,
    filename,
    typePrefix: "video",
    maxSizeBytes: 200 * 1024 * 1024,
    getExtension: safeVideoExtension,
    errorPrefix: "Підтримуються лише відеофайли"
  }, res);
});

router.post("/audio", requireAuth, (req, res) => {
  const { filename, dataUrl } = req.body || {};

  return saveDataUrlFile({
    dataUrl,
    filename,
    typePrefix: "audio",
    maxSizeBytes: 50 * 1024 * 1024,
    getExtension: safeAudioExtension,
    errorPrefix: "Підтримуються лише аудіофайли"
  }, res);
});

module.exports = router;
