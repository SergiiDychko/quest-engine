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
          hint_type,
          show_after_seconds,
          purchase_after_seconds,
          purchase_value,
          content,
          sort_order
        )
        VALUES (?, 'TIMED', 300, 0, 0, '', ?)
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
  const {
    hint_type,
    show_after_seconds,
    purchase_after_seconds,
    purchase_value,
    content
  } = req.body;

  const type = String(hint_type || "TIMED").toUpperCase();

  if (!["TIMED", "PAID"].includes(type)) {
    return res.status(400).json({ error: "Некоректний тип підказки" });
  }

  db.run(
    `
    UPDATE task_hints
    SET
      hint_type = ?,
      show_after_seconds = ?,
      purchase_after_seconds = ?,
      purchase_value = ?,
      content = ?
    WHERE id = ?
    `,
    [
      type,
      Number(show_after_seconds) || 0,
      Number(purchase_after_seconds) || 0,
      Math.max(0, Number(purchase_value) || 0),
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

  db.serialize(() => {
    db.run(`DELETE FROM team_hint_purchases WHERE task_hint_id = ?`, [hintId]);
    db.run(
      `DELETE FROM task_hints WHERE id = ?`,
      [hintId],
      function (error) {
        if (error) {
          return res.status(500).json({ error: "Помилка видалення підказки" });
        }

        res.json({ message: "Підказку видалено" });
      }
    );
  });
});

module.exports = router;
