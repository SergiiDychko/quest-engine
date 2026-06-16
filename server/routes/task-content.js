const express = require("express");
const db = require("../database");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Потрібна авторизація" });
  }

  next();
}

router.get("/:taskId", requireAuth, (req, res) => {
  const taskId = req.params.taskId;

  db.all(
    `
    SELECT *
    FROM task_content
    WHERE task_id = ?
    ORDER BY sort_order ASC
    `,
    [taskId],
    (error, content) => {
      if (error) {
        return res.status(500).json({ error: "Помилка отримання контенту" });
      }

      res.json({ content });
    }
  );
});

router.post("/:taskId", requireAuth, (req, res) => {
  const taskId = req.params.taskId;
  const { type, content } = req.body;

  if (!type || !content) {
    return res.status(400).json({ error: "Тип і контент обовʼязкові" });
  }

  db.get(
    `
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
    FROM task_content
    WHERE task_id = ?
    `,
    [taskId],
    (orderError, row) => {
      if (orderError) {
        return res.status(500).json({ error: "Помилка визначення порядку" });
      }

      db.run(
        `
        INSERT INTO task_content (task_id, type, content, sort_order)
        VALUES (?, ?, ?, ?)
        `,
        [taskId, type, content, row.next_order],
        function (error) {
          if (error) {
            return res.status(500).json({ error: "Помилка створення контенту" });
          }

          res.json({
            message: "Контент додано",
            item: {
              id: this.lastID,
              task_id: taskId,
              type,
              content,
              sort_order: row.next_order
            }
          });
        }
      );
    }
  );
});

router.put("/item/:id", requireAuth, (req, res) => {
  const contentId = req.params.id;
  const { content } = req.body;

  db.run(
    `
    UPDATE task_content
    SET content = ?
    WHERE id = ?
    `,
    [content, contentId],
    function(error) {
      if (error) {
        return res.status(500).json({
          error: "Помилка оновлення контенту"
        });
      }

      res.json({
        message: "Контент оновлено"
      });
    }
  );
});

router.delete("/item/:id", requireAuth, (req, res) => {
  const contentId = req.params.id;

  db.run(
    `
    DELETE FROM task_content
    WHERE id = ?
    `,
    [contentId],
    function(error) {
      if (error) {
        return res.status(500).json({
          error: "Помилка видалення контенту"
        });
      }

      res.json({
        message: "Контент видалено"
      });
    }
  );
});

module.exports = router;