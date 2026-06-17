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


router.put("/:taskId/bulk", requireAuth, (req, res) => {
  const taskId = req.params.taskId;
  const { blocks } = req.body || {};

  if (!Array.isArray(blocks)) {
    return res.status(400).json({ error: "Немає списку блоків" });
  }

  const allowedTypes = new Set(["TEXT", "IMAGE", "VIDEO", "AUDIO", "HTML", "SECTION"]);

  function parseContent(content) {
    if (!content) return {};
    if (typeof content === "object") return content;

    try {
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function validateBlock(block) {
    const type = String(block.type || "").toUpperCase();

    if (!allowedTypes.has(type)) {
      return false;
    }

    if (type !== "SECTION") {
      return true;
    }

    const data = parseContent(block.content);
    const columns = Array.isArray(data.columns) ? data.columns : [];

    if (!columns.length) {
      return false;
    }

    const sum = columns.reduce((total, column) => total + Number(column.width || 0), 0);

    if (Math.round(sum) !== 100) {
      return false;
    }

    return columns.every(column => {
      const childBlocks = Array.isArray(column.blocks) ? column.blocks : [];
      return childBlocks.every(validateBlock);
    });
  }

  for (const block of blocks) {
    if (!validateBlock(block)) {
      return res.status(400).json({ error: "Некоректний тип блоку" });
    }
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      `DELETE FROM task_content WHERE task_id = ?`,
      [taskId],
      deleteError => {
        if (deleteError) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Помилка очищення контенту" });
        }

        const stmt = db.prepare(`
          INSERT INTO task_content (task_id, type, content, sort_order)
          VALUES (?, ?, ?, ?)
        `);

        let failed = false;

        blocks.forEach((block, index) => {
          if (failed) return;

          const type = String(block.type || "").toUpperCase();
          const content = typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content || {});

          stmt.run(taskId, type, content, index + 1, error => {
            if (error && !failed) {
              failed = true;
            }
          });
        });

        stmt.finalize(finalizeError => {
          if (failed || finalizeError) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: "Помилка збереження контенту" });
          }

          db.run("COMMIT", commitError => {
            if (commitError) {
              return res.status(500).json({ error: "Помилка завершення збереження" });
            }

            res.json({ message: "Контент збережено" });
          });
        });
      }
    );
  });
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