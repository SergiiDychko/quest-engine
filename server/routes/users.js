const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../database");

const router = express.Router();
const ROLES = ["ADMIN", "AUTHOR"];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Потрібна авторизація" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Потрібна авторизація" });
  if (req.session.user.role !== "ADMIN") return res.status(403).json({ error: "Доступ лише для адміністратора" });
  next();
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function(error) { error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes }); }));
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username || row.email,
    name: row.name || "",
    email: row.email || "",
    recovery_email: row.recovery_email || "",
    role: row.role || "AUTHOR",
    created_at: row.created_at || "",
    last_login_at: row.last_login_at || ""
  };
}

function randomString(length, alphabet) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function generateUniqueUsername() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const username = randomString(6, alphabet);
    const existing = await dbGet(`SELECT id FROM users WHERE LOWER(COALESCE(username, email)) = ?`, [username]);
    if (!existing) return username;
  }
  return `user${Date.now().toString(36).slice(-6)}`;
}

function generatePassword() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const alphabet = letters + digits;
  const chars = [
    letters[Math.floor(Math.random() * letters.length)],
    digits[Math.floor(Math.random() * digits.length)]
  ];
  while (chars.length < 8) {
    chars.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
  }
  return chars.sort(() => Math.random() - 0.5).join("");
}

async function verifyAdminPassword(adminId, password) {
  const admin = await dbGet(`SELECT id, password_hash, role FROM users WHERE id = ?`, [adminId]);
  if (!admin || admin.role !== "ADMIN") return false;
  return bcrypt.compare(String(password || ""), admin.password_hash);
}

router.get("/roles", requireAuth, (req, res) => {
  res.json({ roles: ROLES });
});

router.get("/suggest", requireAdmin, async (req, res) => {
  try {
    res.json({ username: await generateUniqueUsername(), password: generatePassword() });
  } catch (error) {
    res.status(500).json({ error: "Помилка генерації даних користувача" });
  }
});

router.get("/", requireAdmin, async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT id, username, name, email, recovery_email, role, created_at, last_login_at
      FROM users
      WHERE role IN ('ADMIN', 'AUTHOR')
      ORDER BY LOWER(COALESCE(username, email)) ASC
    `);
    res.json({ users: users.map(publicUser) });
  } catch (error) {
    res.status(500).json({ error: "Помилка отримання користувачів" });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  const role = String(req.body.role || "AUTHOR").toUpperCase();

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return res.status(400).json({ error: "Логін має містити 3–40 символів: латинські літери, цифри, крапка, дефіс або нижнє підкреслення" });
  }
  if (password.length < 8) return res.status(400).json({ error: "Пароль має містити мінімум 8 символів" });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Некоректна роль" });

  try {
    const existing = await dbGet(`SELECT id FROM users WHERE LOWER(COALESCE(username, email)) = ? OR LOWER(email) = ?`, [username, username]);
    if (existing) return res.status(409).json({ error: "Такий логін уже існує" });

    const passwordHash = await bcrypt.hash(password, 10);
    const email = `${username}@quest-engine.local`;
    const result = await dbRun(
      `INSERT INTO users (name, username, email, recovery_email, password_hash, role) VALUES (?, ?, ?, NULL, ?, ?)`,
      [username, username, email, passwordHash, role]
    );
    const user = await dbGet(`SELECT id, username, name, email, recovery_email, role, created_at, last_login_at FROM users WHERE id = ?`, [result.lastID]);
    res.json({ message: "Користувача створено", user: publicUser(user), credentials: { username, password } });
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) return res.status(409).json({ error: "Такий логін уже існує" });
    console.error(error);
    res.status(500).json({ error: "Помилка створення користувача" });
  }
});

router.put("/:id/role", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const role = String(req.body.role || "").toUpperCase();

  if (!userId) return res.status(400).json({ error: "Некоректний користувач" });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Некоректна роль" });
  if (Number(req.session.user.id) === userId) return res.status(400).json({ error: "Не можна змінити власну роль" });

  try {
    const target = await dbGet(`SELECT id, role FROM users WHERE id = ?`, [userId]);
    if (!target) return res.status(404).json({ error: "Користувача не знайдено" });

    if (target.role === "ADMIN" && role !== "ADMIN") {
      const adminCount = await dbGet(`SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'`);
      if (Number(adminCount.count) <= 1) return res.status(400).json({ error: "У системі має залишитись хоча б один адміністратор" });
    }

    await dbRun(`UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [role, userId]);
    res.json({ message: "Роль оновлено" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Помилка оновлення ролі" });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const password = String(req.body.password || "");

  if (!userId) return res.status(400).json({ error: "Некоректний користувач" });
  if (Number(req.session.user.id) === userId) return res.status(400).json({ error: "Не можна видалити власний акаунт" });
  if (!password) return res.status(400).json({ error: "Введіть пароль адміністратора" });

  try {
    const passwordOk = await verifyAdminPassword(req.session.user.id, password);
    if (!passwordOk) return res.status(401).json({ error: "Невірний пароль адміністратора" });

    const target = await dbGet(`SELECT id, role FROM users WHERE id = ?`, [userId]);
    if (!target) return res.status(404).json({ error: "Користувача не знайдено" });

    if (target.role === "ADMIN") {
      const adminCount = await dbGet(`SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'`);
      if (Number(adminCount.count) <= 1) return res.status(400).json({ error: "Не можна видалити останнього адміністратора" });
    }

    await dbRun("BEGIN TRANSACTION");
    await dbRun(`UPDATE games SET created_by = ?, updated_at = CURRENT_TIMESTAMP WHERE created_by = ?`, [req.session.user.id, userId]);
    await dbRun(`UPDATE game_runs SET created_by = ? WHERE created_by = ?`, [req.session.user.id, userId]);
    await dbRun(`DELETE FROM game_permissions WHERE user_id = ?`, [userId]);
    await dbRun(`DELETE FROM run_moderators WHERE user_id = ?`, [userId]);
    await dbRun(`DELETE FROM users WHERE id = ?`, [userId]);
    await dbRun("COMMIT");

    res.json({ message: "Користувача видалено" });
  } catch (error) {
    try { await dbRun("ROLLBACK"); } catch (rollbackError) {}
    console.error(error);
    res.status(500).json({ error: "Помилка видалення користувача" });
  }
});

module.exports = router;
