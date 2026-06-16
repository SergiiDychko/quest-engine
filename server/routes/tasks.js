const express = require("express");
const db = require("../database");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Потрібна авторизація" });
  }
  next();
}

router.get("/:id", requireAuth, (req, res) => {
  const taskId = req.params.id;

  db.get(`SELECT * FROM tasks WHERE id = ?`, [taskId], (error, task) => {
    if (error) return res.status(500).json({ error: "Помилка отримання завдання" });
    if (!task) return res.status(404).json({ error: "Завдання не знайдено" });

    db.all(
      `SELECT * FROM task_answers WHERE task_id = ? ORDER BY answer_type, sort_order`,
      [taskId],
      (answersError, answers) => {
        if (answersError) return res.status(500).json({ error: "Помилка отримання кодів" });
        res.json({ task, answers });
      }
    );
  });
});

router.put("/:id", requireAuth, (req, res) => {
  const taskId = req.params.id;
  const { title, task_type } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      error: "Назва завдання обовʼязкова"
    });
  }

  if (task_type && !["STANDARD", "OLYMPIAD"].includes(task_type)) {
    return res.status(400).json({
      error: "Невірний тип завдання"
    });
  }

  db.run(
    `
    UPDATE tasks
    SET
      title = ?,
      task_type = COALESCE(?, task_type),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [title.trim(), task_type || null, taskId],
    function(error) {
      if (error) {
        return res.status(500).json({
          error: "Помилка оновлення завдання"
        });
      }

      res.json({
        message: "Завдання оновлено"
      });
    }
  );
});

router.delete("/:id", requireAuth, (req, res) => {
  const taskId = req.params.id;

  db.get(
    `SELECT id, game_id, sort_order FROM tasks WHERE id = ?`,
    [taskId],
    (taskError, task) => {
      if (taskError) {
        return res.status(500).json({ error: "Помилка пошуку завдання" });
      }

      if (!task) {
        return res.status(404).json({ error: "Завдання не знайдено" });
      }

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        db.run(
          `
          DELETE FROM team_found_answers
          WHERE task_answer_id IN (
            SELECT id FROM task_answers WHERE task_id = ?
          )
          `,
          [taskId]
        );

        db.run(`DELETE FROM team_answers WHERE task_id = ?`, [taskId]);
        db.run(`DELETE FROM team_tasks WHERE task_id = ?`, [taskId]);
        db.run(`DELETE FROM task_answers WHERE task_id = ?`, [taskId]);
        db.run(`DELETE FROM task_hints WHERE task_id = ?`, [taskId]);
        db.run(`DELETE FROM task_content WHERE task_id = ?`, [taskId]);
        db.run(`DELETE FROM olympiad_cells WHERE task_id = ?`, [taskId]);
        db.run(`DELETE FROM olympiad_settings WHERE task_id = ?`, [taskId]);

        db.run(
          `DELETE FROM tasks WHERE id = ?`,
          [taskId],
          function(deleteError) {
            if (deleteError) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: "Помилка видалення завдання" });
            }

            db.run(
              `
              UPDATE tasks
              SET sort_order = sort_order - 1
              WHERE game_id = ?
                AND sort_order > ?
              `,
              [task.game_id, task.sort_order],
              reorderError => {
                if (reorderError) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: "Помилка перенумерації завдань" });
                }

                db.run("COMMIT");

                res.json({
                  message: "Завдання видалено"
                });
              }
            );
          }
        );
      });
    }
  );
});

router.put("/:id/settings", requireAuth, (req, res) => {
  const taskId = req.params.id;
  const {
    auto_transition_enabled,
    auto_transition_minutes,
    auto_transition_penalty_seconds
  } = req.body;

  const enabled = Boolean(auto_transition_enabled);

  db.run(
    `
    UPDATE tasks
    SET
      auto_transition_minutes = ?,
      auto_transition_penalty_seconds = ?
    WHERE id = ?
    `,
    [
      enabled ? Number(auto_transition_minutes) || 1 : null,
      enabled ? Number(auto_transition_penalty_seconds) || 0 : 0,
      taskId
    ],
    function(error) {
      if (error) {
        return res.status(500).json({ error: "Помилка збереження автопереходу" });
      }

      res.json({ message: "Налаштування автопереходу збережено" });
    }
  );
});

router.post("/:id/answers", requireAuth, (req, res) => {
  const taskId = req.params.id;
  const { count, answer_type } = req.body;
  const codesCount = Number(count);

  if (!codesCount || codesCount < 1) {
    return res.status(400).json({ error: "Кількість кодів має бути більше 0" });
  }

  if (!["MAIN", "BONUS", "PENALTY"].includes(answer_type)) {
    return res.status(400).json({ error: "Невірний тип коду" });
  }

  db.get(
    `
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
    FROM task_answers
    WHERE task_id = ? AND answer_type = ?
    `,
    [taskId, answer_type],
    (error, row) => {
      if (error) return res.status(500).json({ error: "Помилка визначення порядку" });

      const stmt = db.prepare(`
        INSERT INTO task_answers (
          task_id, answer_text, answer_type, description,
          time_modifier_seconds, comment, sort_order
        )
        VALUES (?, '', ?, '', 0, '', ?)
      `);

      for (let i = 0; i < codesCount; i++) {
        stmt.run(taskId, answer_type, row.next_order + i);
      }

      stmt.finalize(finalizeError => {
        if (finalizeError) return res.status(500).json({ error: "Помилка створення кодів" });
        res.json({ message: "Коди створено" });
      });
    }
  );
});

router.put("/:id/answers", requireAuth, (req, res) => {
  const taskId = req.params.id;
  const { required_main_answers, answers } = req.body;

  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: "Немає списку кодів" });
  }

  const mainAnswersCount = answers.filter(a => a.answer_type === "MAIN").length;
  const requiredMain = Number(required_main_answers) || 1;

  if (mainAnswersCount > 1 && (requiredMain < 1 || requiredMain > mainAnswersCount)) {
    return res.status(400).json({
      error: "Кількість кодів для проходження не може перевищувати кількість основних кодів"
    });
  }

  db.serialize(() => {
    db.run(
      `UPDATE tasks SET required_main_answers = ? WHERE id = ?`,
      [mainAnswersCount > 1 ? requiredMain : 1, taskId]
    );

    const stmt = db.prepare(`
      UPDATE task_answers
      SET answer_text = ?, description = ?, comment = ?, time_modifier_seconds = ?
      WHERE id = ? AND task_id = ?
    `);

    answers.forEach(answer => {
      stmt.run(
        answer.answer_text || "",
        answer.description || "",
        answer.comment || "",
        Number(answer.time_modifier_seconds) || 0,
        answer.id,
        taskId
      );
    });

    stmt.finalize(error => {
      if (error) return res.status(500).json({ error: "Помилка збереження кодів" });
      res.json({ message: "Коди збережено" });
    });
  });
});

router.delete("/:taskId/answers/:answerId", requireAuth, (req, res) => {
  const { taskId, answerId } = req.params;

  db.run(
    `DELETE FROM task_answers WHERE id = ? AND task_id = ?`,
    [answerId, taskId],
    function(error) {
      if (error) return res.status(500).json({ error: "Помилка видалення коду" });
      res.json({ message: "Код видалено" });
    }
  );
});

module.exports = router;