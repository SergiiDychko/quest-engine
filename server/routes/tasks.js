const express = require("express");
const db = require("../database");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Потрібна авторизація" });
  }
  next();
}


function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}


function normalizeCodeForDuplicateCheck(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function findDuplicateCodes(items) {
  const seen = new Map();

  for (const item of items) {
    const normalized = normalizeCodeForDuplicateCheck(item.value);
    if (!normalized) continue;

    if (seen.has(normalized)) {
      return {
        first: seen.get(normalized).label,
        second: item.label,
        value: item.value
      };
    }

    seen.set(normalized, item);
  }

  return null;
}

function formatDuplicateCodeMessage(duplicate) {
  const valueLine = duplicate.value ? `Виявлено дубль коду "${duplicate.value}".\n\n` : "";
  return `${valueLine}${duplicate.first}\n${duplicate.second}\n\nПотрібно виправити.`;
}

function codeTypeLabel(type) {
  if (type === "MAIN") return "Основний код";
  if (type === "BONUS") return "Бонусний код";
  if (type === "PENALTY") return "Штрафний код";
  return "Код";
}

function generateOlympiadCellsMeta(associationCount, levelCount) {
  const x = Number(associationCount);
  const l = Number(levelCount);
  const cells = [];
  let cellNumber = 1;

  for (let level = l; level >= 1; level--) {
    const count = Math.pow(x, level - 1);
    for (let index = 0; index < count; index++) {
      cells.push({
        cell_number: cellNumber,
        level_number: level,
        index_in_level: index
      });
      cellNumber += 1;
    }
  }

  return cells;
}

function getOlympiadTotalCells(associationCount, levelCount) {
  return generateOlympiadCellsMeta(associationCount, levelCount).length;
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
  const { title, task_type, hide_answers_block } = req.body;

  if (task_type && !["STANDARD", "OLYMPIAD", "MULTITASK"].includes(task_type)) {
    return res.status(400).json({
      error: "Невірний тип завдання"
    });
  }

  const hasHideAnswers = Object.prototype.hasOwnProperty.call(req.body, "hide_answers_block");

  db.run(
    `
    UPDATE tasks
    SET
      title = ?,
      task_type = COALESCE(?, task_type),
      hide_answers_block = CASE WHEN ? THEN ? ELSE hide_answers_block END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      String(title || "").trim(),
      task_type || null,
      hasHideAnswers ? 1 : 0,
      hide_answers_block ? 1 : 0,
      taskId
    ],
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


router.get("/:id/olympiad", requireAuth, async (req, res) => {
  const taskId = req.params.id;

  try {
    const task = await dbGet(`SELECT id, task_type, hide_answers_block FROM tasks WHERE id = ?`, [taskId]);
    if (!task) return res.status(404).json({ error: "Завдання не знайдено" });

    const settings = await dbGet(
      `SELECT * FROM olympiad_settings WHERE task_id = ?`,
      [taskId]
    );

    const cells = await dbAll(
      `SELECT * FROM olympiad_cells WHERE task_id = ? ORDER BY cell_number ASC`,
      [taskId]
    );

    const fallbackSettings = {
      association_count: 3,
      level_count: 4,
      completion_type: "TOP_CELL",
      required_cells_count: null,
      purchase_available_after_seconds: 0
    };

    const effectiveSettings = settings || fallbackSettings;
    const meta = generateOlympiadCellsMeta(
      effectiveSettings.association_count,
      effectiveSettings.level_count
    );

    const existingByNumber = new Map(cells.map(cell => [Number(cell.cell_number), cell]));

    res.json({
      task: {
        id: task.id,
        task_type: task.task_type,
        hide_answers_block: Number(task.hide_answers_block) || 0
      },
      settings: effectiveSettings,
      cells: meta.map(item => ({
        ...item,
        id: existingByNumber.get(item.cell_number)?.id || null,
        content: existingByNumber.get(item.cell_number)?.content || "",
        answer_text: existingByNumber.get(item.cell_number)?.answer_text || "",
        comment: existingByNumber.get(item.cell_number)?.comment || "",
        purchase_value: existingByNumber.get(item.cell_number)?.purchase_value || 0,
        task_answer_id: existingByNumber.get(item.cell_number)?.task_answer_id || null
      }))
    });
  } catch (error) {
    res.status(500).json({ error: "Помилка завантаження олімпійки" });
  }
});

router.put("/:id/olympiad", requireAuth, async (req, res) => {
  const taskId = req.params.id;
  const associationCount = Number(req.body.association_count);
  const levelCount = Number(req.body.level_count);
  const completionType = String(req.body.completion_type || "TOP_CELL").toUpperCase();
  const requiredCellsCount = Number(req.body.required_cells_count) || null;
  const purchaseAvailableAfterSeconds = Math.max(0, Number(req.body.purchase_available_after_seconds) || 0);
  const hideAnswersBlock = req.body.hide_answers_block ? 1 : 0;
  const cells = Array.isArray(req.body.cells) ? req.body.cells : [];

  if (!Number.isInteger(associationCount) || associationCount < 2 || associationCount > 6) {
    return res.status(400).json({ error: "Кількість асоціацій має бути від 2 до 6" });
  }

  if (!Number.isInteger(levelCount) || levelCount < 2 || levelCount > 6) {
    return res.status(400).json({ error: "Кількість рівнів має бути від 2 до 6" });
  }

  if (!["ALL", "TOP_CELL", "COUNT"].includes(completionType)) {
    return res.status(400).json({ error: "Невірна умова завершення олімпійки" });
  }

  const meta = generateOlympiadCellsMeta(associationCount, levelCount);
  const totalCells = meta.length;

  const cellByNumberForValidation = new Map(
    cells.map(cell => [Number(cell.cell_number), cell])
  );

  const duplicate = findDuplicateCodes(
    meta.map(item => ({
      label: String(item.cell_number),
      value: cellByNumberForValidation.get(item.cell_number)?.answer_text || ""
    }))
  );

  if (duplicate) {
    return res.status(400).json({ error: formatDuplicateCodeMessage(duplicate) });
  }

  if (completionType === "COUNT") {
    if (!requiredCellsCount || requiredCellsCount < 1 || requiredCellsCount > totalCells) {
      return res.status(400).json({ error: "Кількість кодів для завершення має бути від 1 до загальної кількості клітинок" });
    }
  }

  const cellByNumber = new Map(
    cells.map(cell => [Number(cell.cell_number), cell])
  );

  try {
    await dbRun("BEGIN TRANSACTION");

    await dbRun(
      `UPDATE tasks SET task_type = 'OLYMPIAD', hide_answers_block = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [hideAnswersBlock, taskId]
    );

    await dbRun(`DELETE FROM olympiad_cells WHERE task_id = ?`, [taskId]);
    await dbRun(`DELETE FROM team_found_answers WHERE task_answer_id IN (SELECT id FROM task_answers WHERE task_id = ? AND answer_type = 'MAIN')`, [taskId]);
    await dbRun(`DELETE FROM task_answers WHERE task_id = ? AND answer_type = 'MAIN'`, [taskId]);
    await dbRun(`DELETE FROM olympiad_settings WHERE task_id = ?`, [taskId]);

    await dbRun(
      `
      INSERT INTO olympiad_settings (
        task_id,
        association_count,
        level_count,
        completion_type,
        required_cells_count,
        purchase_available_after_seconds
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        taskId,
        associationCount,
        levelCount,
        completionType,
        completionType === "COUNT" ? requiredCellsCount : null,
        purchaseAvailableAfterSeconds
      ]
    );

    for (const item of meta) {
      const inputCell = cellByNumber.get(item.cell_number) || {};
      const answerText = String(inputCell.answer_text || "").trim();
      const content = String(inputCell.content || "");
      const comment = String(inputCell.comment || "");
      const purchaseValue = Math.max(0, Number(inputCell.purchase_value) || 0);

      const answerResult = await dbRun(
        `
        INSERT INTO task_answers (
          task_id,
          answer_text,
          answer_type,
          description,
          time_modifier_seconds,
          comment,
          sort_order
        )
        VALUES (?, ?, 'MAIN', ?, 0, ?, ?)
        `,
        [
          taskId,
          answerText,
          `Клітинка ${item.cell_number}`,
          comment,
          item.cell_number
        ]
      );

      await dbRun(
        `
        INSERT INTO olympiad_cells (
          task_id,
          cell_number,
          level_number,
          content,
          answer_text,
          comment,
          purchase_value,
          task_answer_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          taskId,
          item.cell_number,
          item.level_number,
          content,
          answerText,
          comment,
          purchaseValue,
          answerResult.lastID
        ]
      );
    }

    await dbRun("COMMIT");

    res.json({
      message: "Олімпійку збережено",
      total_cells: totalCells
    });
  } catch (error) {
    try { await dbRun("ROLLBACK"); } catch (rollbackError) {}
    res.status(500).json({ error: "Помилка збереження олімпійки" });
  }
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
        db.run(`DELETE FROM team_multitask_hint_purchases WHERE multitask_subtask_id IN (SELECT id FROM multitask_subtasks WHERE task_id = ?)`, [taskId]);
        db.run(`DELETE FROM multitask_subtasks WHERE task_id = ?`, [taskId]);
        db.run(`DELETE FROM multitask_settings WHERE task_id = ?`, [taskId]);

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

  const duplicate = findDuplicateCodes(
    answers.map(answer => ({
      label: `${codeTypeLabel(answer.answer_type)} №${answer.sort_order || ""}`,
      value: answer.answer_text || ""
    }))
  );

  if (duplicate) {
    return res.status(400).json({ error: formatDuplicateCodeMessage(duplicate) });
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


router.get("/:id/multitask", requireAuth, async (req, res) => {
  const taskId = req.params.id;

  try {
    const task = await dbGet(`SELECT id, task_type FROM tasks WHERE id = ?`, [taskId]);
    if (!task) return res.status(404).json({ error: "Завдання не знайдено" });

    const settings = await dbGet(
      `SELECT * FROM multitask_settings WHERE task_id = ?`,
      [taskId]
    );

    const subtasks = await dbAll(
      `SELECT * FROM multitask_subtasks WHERE task_id = ? ORDER BY sort_order ASC, id ASC`,
      [taskId]
    );

    res.json({
      settings: settings || { task_id: taskId, completion_type: "ALL", required_count: null },
      subtasks: subtasks || []
    });
  } catch (error) {
    res.status(500).json({ error: "Помилка завантаження Multitask" });
  }
});

router.put("/:id/multitask", requireAuth, async (req, res) => {
  const taskId = req.params.id;
  const completionType = String(req.body.completion_type || "ALL").toUpperCase();
  const subtasks = Array.isArray(req.body.subtasks) ? req.body.subtasks : [];
  const requiredCount = completionType === "COUNT" ? Number(req.body.required_count) : subtasks.length;

  if (!["ALL", "COUNT"].includes(completionType)) {
    return res.status(400).json({ error: "Невірна умова проходження Multitask" });
  }

  if (!subtasks.length) {
    return res.status(400).json({ error: "Створіть хоча б одне підзавдання" });
  }

  if (completionType === "COUNT" && (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > subtasks.length)) {
    return res.status(400).json({ error: "Кількість кодів для проходження має бути від 1 до кількості підзавдань" });
  }

  const duplicate = findDuplicateCodes(
    subtasks.map((subtask, index) => ({
      label: `Підзавдання №${index + 1}`,
      value: subtask.answer_text || ""
    }))
  );

  if (duplicate) {
    return res.status(400).json({ error: formatDuplicateCodeMessage(duplicate) });
  }

  try {
    await dbRun("BEGIN TRANSACTION");

    await dbRun(
      `UPDATE tasks SET task_type = 'MULTITASK', required_main_answers = ?, hide_answers_block = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [completionType === "COUNT" ? requiredCount : subtasks.length, taskId]
    );

    await dbRun(`DELETE FROM team_multitask_hint_purchases WHERE multitask_subtask_id IN (SELECT id FROM multitask_subtasks WHERE task_id = ?)`, [taskId]);
    await dbRun(`DELETE FROM multitask_subtasks WHERE task_id = ?`, [taskId]);
    await dbRun(`DELETE FROM team_found_answers WHERE task_answer_id IN (SELECT id FROM task_answers WHERE task_id = ? AND answer_type = 'MAIN')`, [taskId]);
    await dbRun(`DELETE FROM task_answers WHERE task_id = ? AND answer_type = 'MAIN'`, [taskId]);
    await dbRun(`DELETE FROM multitask_settings WHERE task_id = ?`, [taskId]);

    await dbRun(
      `INSERT INTO multitask_settings (task_id, completion_type, required_count) VALUES (?, ?, ?)`,
      [taskId, completionType, completionType === "COUNT" ? requiredCount : null]
    );

    for (let index = 0; index < subtasks.length; index += 1) {
      const subtask = subtasks[index] || {};
      const sortOrder = index + 1;
      const answerText = String(subtask.answer_text || "").trim();
      const description = String(subtask.description || "");
      const comment = String(subtask.comment || "");
      const hintType = String(subtask.hint_type || "NONE").toUpperCase();

      if (!["NONE", "TIMED", "PAID"].includes(hintType)) {
        throw new Error("Невірний тип підказки");
      }

      const answerResult = await dbRun(
        `INSERT INTO task_answers (task_id, answer_text, answer_type, description, time_modifier_seconds, comment, sort_order)
         VALUES (?, ?, 'MAIN', ?, 0, ?, ?)`,
        [taskId, answerText, description, comment, sortOrder]
      );

      await dbRun(
        `INSERT INTO multitask_subtasks (
          task_id, sort_order, content, answer_text, description, comment,
          hint_type, hint_text, hint_after_seconds, hint_purchase_after_seconds,
          hint_purchase_value, task_answer_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          taskId,
          sortOrder,
          String(subtask.content || ""),
          answerText,
          description,
          comment,
          hintType,
          String(subtask.hint_text || ""),
          Math.max(0, Number(subtask.hint_after_seconds) || 0),
          Math.max(0, Number(subtask.hint_purchase_after_seconds) || 0),
          Math.max(0, Number(subtask.hint_purchase_value) || 0),
          answerResult.lastID
        ]
      );
    }

    await dbRun("COMMIT");
    res.json({ message: "Multitask збережено" });
  } catch (error) {
    try { await dbRun("ROLLBACK"); } catch (rollbackError) {}
    res.status(500).json({ error: error.message || "Помилка збереження Multitask" });
  }
});

module.exports = router;