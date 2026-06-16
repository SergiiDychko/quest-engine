const express = require("express");
const db = require("../database");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Потрібна авторизація" });
  }

  next();
}


router.get("/catalog", requireAuth, (req, res) => {
  const user = req.session.user;

  let query = `
    SELECT
      games.id,
      games.title,
      games.status,
      games.game_type,
      games.winner_type,
      COUNT(tasks.id) AS tasks_count
    FROM games
    LEFT JOIN tasks ON tasks.game_id = games.id
    GROUP BY games.id
    ORDER BY LOWER(games.title) ASC
  `;

  let params = [];

  if (user.role !== "ADMIN") {
    query = `
      SELECT
        games.id,
        games.title,
        games.status,
        games.game_type,
        games.winner_type,
        COUNT(tasks.id) AS tasks_count
      FROM games
      LEFT JOIN game_permissions
        ON game_permissions.game_id = games.id
      LEFT JOIN tasks ON tasks.game_id = games.id
      WHERE games.created_by = ?
         OR game_permissions.user_id = ?
      GROUP BY games.id
      ORDER BY LOWER(games.title) ASC
    `;

    params = [user.id, user.id];
  }

  db.all(query, params, (error, games) => {
    if (error) {
      return res.status(500).json({ error: "Помилка отримання каталогу ігор" });
    }

    res.json({ games });
  });
});

router.get("/ready", requireAuth, (req, res) => {
  const user = req.session.user;

  let query = `
    SELECT id, title, status
    FROM games
    WHERE status = 'READY'
    ORDER BY LOWER(title) ASC
  `;

  let params = [];

  if (user.role !== "ADMIN") {
    query = `
      SELECT DISTINCT games.id, games.title, games.status
      FROM games
      LEFT JOIN game_permissions
        ON game_permissions.game_id = games.id
      WHERE games.status = 'READY'
        AND (
          games.created_by = ?
          OR game_permissions.user_id = ?
        )
      ORDER BY LOWER(games.title) ASC
    `;

    params = [user.id, user.id];
  }

  db.all(query, params, (error, games) => {
    if (error) {
      return res.status(500).json({ error: "Помилка отримання готових ігор" });
    }

    res.json({ games });
  });
});

router.get("/", requireAuth, (req, res) => {
  const user = req.session.user;

  let query = `
    SELECT *
    FROM games
    ORDER BY created_at DESC
  `;

  let params = [];

  if (user.role !== "ADMIN") {
    query = `
      SELECT DISTINCT games.*
      FROM games
      LEFT JOIN game_permissions
        ON game_permissions.game_id = games.id
      WHERE games.created_by = ?
         OR game_permissions.user_id = ?
      ORDER BY games.created_at DESC
    `;

    params = [user.id, user.id];
  }

  db.all(query, params, (error, games) => {
    if (error) {
      return res.status(500).json({ error: "Помилка отримання ігор" });
    }

    res.json({ games });
  });
});

router.post("/", requireAuth, (req, res) => {
  const user = req.session.user;

  if (!["ADMIN", "AUTHOR"].includes(user.role)) {
    return res.status(403).json({ error: "Недостатньо прав" });
  }

  const { title, description, language, game_type, winner_type } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: "Назва гри обовʼязкова" });
  }

  db.run(
    `
    INSERT INTO games (
      title,
      description,
      language,
      game_type,
      winner_type,
      status,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)
    `,
    [
      title.trim(),
      description || "",
      language || "uk",
      game_type || "LINEAR",
      winner_type || "TIME",
      user.id
    ],
    function (error) {
      if (error) {
        return res.status(500).json({ error: "Помилка створення гри" });
      }

      res.json({
        message: "Гру створено",
        game: {
          id: this.lastID,
          title: title.trim()
        }
      });
    }
  );
});

router.get("/:id", requireAuth, (req, res) => {
  const gameId = req.params.id;

  db.get(
    `
    SELECT *
    FROM games
    WHERE id = ?
    `,
    [gameId],
    (error, game) => {
      if (error) {
        return res.status(500).json({ error: "Помилка отримання гри" });
      }

      if (!game) {
        return res.status(404).json({ error: "Гру не знайдено" });
      }

      res.json({ game });
    }
  );
});


router.put("/:id/status", requireAuth, (req, res) => {
  const gameId = req.params.id;
  const { status } = req.body;

  if (!["DRAFT", "READY"].includes(status)) {
    return res.status(400).json({ error: "Некоректний статус гри" });
  }

  db.run(
    `
    UPDATE games
    SET
      status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [status, gameId],
    function(error) {
      if (error) {
        return res.status(500).json({ error: "Помилка оновлення статусу гри" });
      }

      if (!this.changes) {
        return res.status(404).json({ error: "Гру не знайдено" });
      }

      res.json({ message: "Статус гри оновлено", game: { id: Number(gameId), status } });
    }
  );
});

router.get("/:id/tasks", requireAuth, (req, res) => {
  const gameId = req.params.id;

  db.all(
    `
    SELECT *
    FROM tasks
    WHERE game_id = ?
    ORDER BY sort_order ASC
    `,
    [gameId],
    (error, tasks) => {
      if (error) {
        return res.status(500).json({ error: "Помилка отримання завдань" });
      }

      res.json({ tasks });
    }
  );
});

router.post("/:id/tasks", requireAuth, (req, res) => {
  const gameId = req.params.id;
  const { title, task_type } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: "Назва завдання обовʼязкова" });
  }

  db.get(
    `
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
    FROM tasks
    WHERE game_id = ?
    `,
    [gameId],
    (orderError, row) => {
      if (orderError) {
        return res.status(500).json({ error: "Помилка визначення порядку" });
      }

      db.run(
        `
        INSERT INTO tasks (
          game_id,
          title,
          task_type,
          sort_order
        )
        VALUES (?, ?, ?, ?)
        `,
        [
          gameId,
          title.trim(),
          task_type || "STANDARD",
          row.next_order
        ],
        function (error) {
          if (error) {
            return res.status(500).json({ error: "Помилка створення завдання" });
          }

          res.json({
            message: "Завдання створено",
            task: {
              id: this.lastID,
              title: title.trim(),
              task_type: task_type || "STANDARD",
              sort_order: row.next_order
            }
          });
        }
      );
    }
  );
});

module.exports = router;