const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../database");

const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email і пароль обовʼязкові" });
  }

  db.get(
    "SELECT * FROM users WHERE email = ?",
    [email],
    async (error, user) => {
      if (error) {
        return res.status(500).json({ error: "Помилка бази даних" });
      }

      if (!user) {
        return res.status(401).json({ error: "Невірний email або пароль" });
      }

      const passwordOk = await bcrypt.compare(password, user.password_hash);

      if (!passwordOk) {
        return res.status(401).json({ error: "Невірний email або пароль" });
      }

      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      };

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

module.exports = router;