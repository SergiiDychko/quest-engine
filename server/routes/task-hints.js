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
    FROM task_hints
    WHERE task_id = ?
    ORDER BY sort_order ASC
    `,
    [taskId],
    (error, hints) => {
      if (error) {
        return res.status(500).json({ error: "Помилка отримання підказок" });
      }

      res.json({ hints });
    }
  );
});

router.post("/:taskId", requireAuth, (req, res) => {
  const taskId = req.params.taskId;

  db.get(
    `
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
    FROM task_hints
    WHERE task_id = ?
    `,
    [taskId],
    (error, row) => {
      if (error) {
        return res.status(500).json({ error: "Помилка створення підказки" });
      }

      db.run(
        `
        INSERT INTO task_hints (
          task_id,
          show_after_seconds,
          content,
          sort_order
        )
        VALUES (?, 300, '', ?)
        `,
        [taskId, row.next_order],
        function (insertError) {
          if (insertError) {
            return res.status(500).json({ error: "Помилка додавання підказки" });
          }

          res.json({ message: "Підказку додано" });
        }
      );
    }
  );
});

router.put("/:hintId", requireAuth, (req, res) => {
  const hintId = req.params.hintId;
  const { show_after_seconds, content } = req.body;

  db.run(
    `
    UPDATE task_hints
    SET
      show_after_seconds = ?,
      content = ?
    WHERE id = ?
    `,
    [
      Number(show_after_seconds) || 0,
      content || "",
      hintId
    ],
    function (error) {
      if (error) {
        return res.status(500).json({ error: "Помилка збереження підказки" });
      }

      res.json({ message: "Підказку збережено" });
    }
  );
});

router.delete("/:hintId", requireAuth, (req, res) => {
  const hintId = req.params.hintId;

  db.run(
    `
    DELETE FROM task_hints
    WHERE id = ?
    `,
    [hintId],
    function (error) {
      if (error) {
        return res.status(500).json({ error: "Помилка видалення підказки" });
      }

      res.json({ message: "Підказку видалено" });
    }
  );
});

module.exports = router;