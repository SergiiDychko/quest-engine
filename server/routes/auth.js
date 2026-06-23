const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db = require("../database");
const { getPublicBaseUrl, isMailConfigured, sendPasswordResetEmail } = require("../services/mailer");

const router = express.Router();
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Потрібна авторизація" });
  }
  next();
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidUsername(value) {
  return /^[a-z0-9._-]{3,40}$/.test(String(value || ""));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function validatePassword(value) {
  const password = String(value || "");

  if (password.length < 8) {
    return "Пароль має містити щонайменше 8 символів";
  }

  if (!/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(password) || !/\d/.test(password)) {
    return "Пароль має містити літери і цифри";
  }

  return "";
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username || user.email,
    email: user.email,
    recovery_email: user.recovery_email || "",
    role: user.role,
    created_at: user.created_at || "",
    last_login_at: user.last_login_at || ""
  };
}

function updateSessionUser(req, user) {
  req.session.user = publicUser(user);
}

router.post("/login", (req, res) => {
  const identifier = normalizeIdentifier(req.body.identifier || req.body.email || req.body.username);
  const { password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: "Логін/email і пароль обовʼязкові" });
  }

  db.get(
    `
    SELECT *
    FROM users
    WHERE LOWER(COALESCE(username, email)) = ?
       OR LOWER(email) = ?
    `,
    [identifier, identifier],
    async (error, user) => {
      if (error) {
        return res.status(500).json({ error: "Помилка бази даних" });
      }

      if (!user) {
        return res.status(401).json({ error: "Невірний логін/email або пароль" });
      }

      const passwordOk = await bcrypt.compare(password, user.password_hash);

      if (!passwordOk) {
        return res.status(401).json({ error: "Невірний логін/email або пароль" });
      }

      updateSessionUser(req, user);
      db.run(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, [user.id]);

      res.json({
        message: "Вхід виконано",
        user: req.session.user
      });
    }
  );
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Вихід виконано" });
  });
});

router.get("/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ user: null });
  }

  res.json({ user: req.session.user });
});

router.get("/profile", requireAuth, (req, res) => {
  db.get(
    `
    SELECT id, name, username, email, recovery_email, role, created_at, last_login_at
    FROM users
    WHERE id = ?
    `,
    [req.session.user.id],
    (error, user) => {
      if (error) {
        return res.status(500).json({ error: "Помилка отримання профілю" });
      }

      if (!user) {
        return res.status(404).json({ error: "Користувача не знайдено" });
      }

      res.json({ user: publicUser(user) });
    }
  );
});

router.put("/profile", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const username = normalizeUsername(req.body.username);
  const recoveryEmail = normalizeEmail(req.body.recovery_email);
  const currentPassword = String(req.body.current_password || "");
  const newPassword = String(req.body.new_password || "");
  const repeatPassword = String(req.body.repeat_password || "");
  const wantsPasswordChange = Boolean(newPassword || repeatPassword);

  if (!name) {
    return res.status(400).json({ error: "Імʼя не може бути порожнім" });
  }

  if (!isValidUsername(username)) {
    return res.status(400).json({
      error: "Логін має містити 3–40 символів: латинські літери, цифри, крапка, дефіс або нижнє підкреслення"
    });
  }

  if (recoveryEmail && !isValidEmail(recoveryEmail)) {
    return res.status(400).json({ error: "Некоректна електронна пошта для відновлення" });
  }

  if (!currentPassword) {
    return res.status(400).json({ error: "Для збереження змін введіть поточний пароль" });
  }

  if (wantsPasswordChange) {
    if (!newPassword || !repeatPassword) {
      return res.status(400).json({ error: "Для зміни пароля заповніть новий пароль і повтор" });
    }

    if (newPassword !== repeatPassword) {
      return res.status(400).json({ error: "Новий пароль і повтор пароля не збігаються" });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }
  }

  db.get(`SELECT * FROM users WHERE id = ?`, [req.session.user.id], async (error, currentUser) => {
    if (error) {
      return res.status(500).json({ error: "Помилка бази даних" });
    }

    if (!currentUser) {
      return res.status(404).json({ error: "Користувача не знайдено" });
    }

    let passwordOk = false;
    try {
      passwordOk = await bcrypt.compare(currentPassword, currentUser.password_hash);
    } catch (compareError) {
      console.error(compareError);
      return res.status(500).json({ error: "Помилка перевірки поточного пароля" });
    }

    if (!passwordOk) {
      return res.status(401).json({ error: "Поточний пароль введено неправильно" });
    }

    db.get(
      `
      SELECT id
      FROM users
      WHERE LOWER(COALESCE(username, email)) = ?
        AND id <> ?
      `,
      [username, currentUser.id],
      async (duplicateError, duplicate) => {
        if (duplicateError) {
          return res.status(500).json({ error: "Помилка перевірки логіна" });
        }

        if (duplicate) {
          return res.status(409).json({ error: "Такий логін уже використовується" });
        }

        let passwordHash = currentUser.password_hash;
        if (wantsPasswordChange) {
          try {
            passwordHash = await bcrypt.hash(newPassword, 10);
          } catch (hashError) {
            console.error(hashError);
            return res.status(500).json({ error: "Помилка підготовки нового пароля" });
          }
        }

        db.run(
          `
          UPDATE users
          SET name = ?,
              username = ?,
              recovery_email = ?,
              password_hash = ?,
              reset_token_hash = NULL,
              reset_token_expires_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
          [name, username, recoveryEmail || null, passwordHash, currentUser.id],
          updateError => {
            if (updateError) {
              return res.status(500).json({ error: "Помилка збереження профілю" });
            }

            if (wantsPasswordChange) {
              req.session.destroy(destroyError => {
                if (destroyError) console.error(destroyError);
                return res.json({
                  message: "Зміни збережено. Пароль змінено, тому для безпеки увійдіть ще раз.",
                  relogin_required: true
                });
              });
              return;
            }

            const updatedUser = {
              ...currentUser,
              name,
              username,
              recovery_email: recoveryEmail || ""
            };

            updateSessionUser(req, updatedUser);

            res.json({
              message: "Профіль оновлено",
              user: req.session.user
            });
          }
        );
      }
    );
  });
});

router.put("/password", requireAuth, (req, res) => {
  return res.status(410).json({
    error: "Зміна пароля перенесена у форму профілю. Оновіть сторінку і натисніть «Зберегти зміни»."
  });
});

router.get("/mail-status", requireAuth, (req, res) => {
  res.json({ configured: isMailConfigured() });
});

router.post("/forgot-password", (req, res) => {
  const identifier = normalizeIdentifier(req.body.identifier || req.body.email || req.body.username);

  if (!identifier) {
    return res.status(400).json({ error: "Вкажіть логін або електронну пошту" });
  }

  const genericMessage = "Якщо користувача знайдено і для нього вказано email відновлення, інструкцію буде надіслано.";

  db.get(
    `
    SELECT id, username, email, recovery_email
    FROM users
    WHERE LOWER(COALESCE(username, email)) = ?
       OR LOWER(email) = ?
       OR LOWER(COALESCE(recovery_email, '')) = ?
    `,
    [identifier, identifier, identifier],
    (error, user) => {
      if (error) {
        return res.status(500).json({ error: "Помилка бази даних" });
      }

      if (!user || !user.recovery_email) {
        return res.json({ message: genericMessage });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
      const resetPath = `/reset-password.html?token=${token}`;
      const resetUrl = `${getPublicBaseUrl(req)}${resetPath}`;

      db.run(
        `
        UPDATE users
        SET reset_token_hash = ?,
            reset_token_expires_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [tokenHash(token), expiresAt, user.id],
        async updateError => {
          if (updateError) {
            return res.status(500).json({ error: "Помилка створення запиту на відновлення" });
          }

          let mailResult = { sent: false, reason: "SMTP_NOT_CONFIGURED" };
          try {
            mailResult = await sendPasswordResetEmail({
              to: user.recovery_email,
              resetUrl
            });
          } catch (mailError) {
            console.error("Password reset email error:", mailError);
          }

          if (!mailResult.sent) {
            console.log("Password reset link for", user.recovery_email, resetUrl);
          }

          res.json({
            message: genericMessage,
            mail_sent: mailResult.sent,
            dev_reset_link: process.env.NODE_ENV === "production" ? undefined : resetUrl
          });
        }
      );
    }
  );
});

router.post("/reset-password", (req, res) => {
  const token = String(req.body.token || "").trim();
  const newPassword = String(req.body.new_password || "");
  const repeatPassword = String(req.body.repeat_password || "");

  if (!token || !newPassword || !repeatPassword) {
    return res.status(400).json({ error: "Заповніть усі поля" });
  }

  if (newPassword !== repeatPassword) {
    return res.status(400).json({ error: "Новий пароль і повтор пароля не збігаються" });
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  db.get(
    `
    SELECT id, reset_token_expires_at
    FROM users
    WHERE reset_token_hash = ?
    `,
    [tokenHash(token)],
    async (error, user) => {
      if (error) {
        return res.status(500).json({ error: "Помилка бази даних" });
      }

      if (!user || !user.reset_token_expires_at || new Date(user.reset_token_expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: "Посилання для відновлення недійсне або застаріло" });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);

      db.run(
        `
        UPDATE users
        SET password_hash = ?,
            reset_token_hash = NULL,
            reset_token_expires_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [passwordHash, user.id],
        updateError => {
          if (updateError) {
            return res.status(500).json({ error: "Помилка збереження нового пароля" });
          }

          res.json({ message: "Пароль оновлено. Тепер можна увійти." });
        }
      );
    }
  );
});

module.exports = router;
