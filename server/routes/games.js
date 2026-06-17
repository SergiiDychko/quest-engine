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
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

router.get("/catalog", requireAuth, (req, res) => {
  const user = req.session.user;

  let query = `
    SELECT
      games.id,
      games.title,
      games.description,
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
        games.description,
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
          String(title || "").trim(),
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
              title: String(title || "").trim(),
              task_type: task_type || "STANDARD",
              sort_order: row.next_order
            }
          });
        }
      );
    }
  );
});


router.post("/:id/copy", requireAuth, async (req, res) => {
  const sourceGameId = req.params.id;
  const user = req.session.user;

  if (!["ADMIN", "AUTHOR"].includes(user.role)) {
    return res.status(403).json({ error: "Недостатньо прав" });
  }

  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const gameType = String(req.body.game_type || "LINEAR").toUpperCase();
  const winnerType = String(req.body.winner_type || "TIME").toUpperCase();

  if (!title) {
    return res.status(400).json({ error: "Назва копії обовʼязкова" });
  }

  if (!["LINEAR", "STORM"].includes(gameType)) {
    return res.status(400).json({ error: "Некоректний тип видачі завдань" });
  }

  if (!["TIME", "POINTS", "SCORE"].includes(winnerType)) {
    return res.status(400).json({ error: "Некоректна умова перемоги" });
  }

  try {
    const sourceGame = await dbGet(`SELECT * FROM games WHERE id = ?`, [sourceGameId]);
    if (!sourceGame) {
      return res.status(404).json({ error: "Гру не знайдено" });
    }

    const winnerChanged = String(sourceGame.winner_type || "TIME").toUpperCase() !== winnerType;

    await dbRun("BEGIN TRANSACTION");

    const gameResult = await dbRun(
      `
      INSERT INTO games (
        title,
        description,
        language,
        status,
        game_type,
        winner_type,
        default_css,
        created_by
      )
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?)
      `,
      [
        title,
        description,
        sourceGame.language || "uk",
        gameType,
        winnerType,
        sourceGame.default_css || "",
        user.id
      ]
    );

    const newGameId = gameResult.lastID;

    const pages = await dbAll(`SELECT * FROM game_pages WHERE game_id = ?`, [sourceGameId]);
    for (const page of pages) {
      await dbRun(
        `
        INSERT INTO game_pages (game_id, page_type, title, content, custom_css)
        VALUES (?, ?, ?, ?, ?)
        `,
        [newGameId, page.page_type, page.title || "", page.content || "", page.custom_css || ""]
      );
    }

    const tasks = await dbAll(`SELECT * FROM tasks WHERE game_id = ? ORDER BY sort_order ASC, id ASC`, [sourceGameId]);
    const taskIdMap = new Map();
    const answerIdMap = new Map();

    for (const task of tasks) {
      const newTaskResult = await dbRun(
        `
        INSERT INTO tasks (
          game_id,
          title,
          task_type,
          sort_order,
          notes,
          is_scored,
          auto_transition_minutes,
          auto_transition_penalty_seconds,
          required_main_answers,
          hide_answers_block,
          score_points
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          newGameId,
          task.title || "",
          task.task_type || "STANDARD",
          task.sort_order,
          task.notes || "",
          task.is_scored === undefined ? 1 : task.is_scored,
          task.auto_transition_minutes,
          winnerChanged ? 0 : (Number(task.auto_transition_penalty_seconds) || 0),
          task.required_main_answers,
          task.hide_answers_block || 0,
          winnerChanged ? 0 : (Number(task.score_points) || 0)
        ]
      );

      const newTaskId = newTaskResult.lastID;
      taskIdMap.set(Number(task.id), newTaskId);

      const content = await dbAll(`SELECT * FROM task_content WHERE task_id = ? ORDER BY sort_order ASC, id ASC`, [task.id]);
      for (const block of content) {
        await dbRun(
          `INSERT INTO task_content (task_id, type, content, sort_order) VALUES (?, ?, ?, ?)`,
          [newTaskId, block.type, block.content || "", block.sort_order]
        );
      }

      const answers = await dbAll(`SELECT * FROM task_answers WHERE task_id = ? ORDER BY answer_type, sort_order, id`, [task.id]);
      for (const answer of answers) {
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
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            newTaskId,
            answer.answer_text || "",
            answer.answer_type || "MAIN",
            answer.description || "",
            winnerChanged ? 0 : (Number(answer.time_modifier_seconds) || 0),
            answer.comment || "",
            answer.sort_order
          ]
        );
        answerIdMap.set(Number(answer.id), answerResult.lastID);
      }

      const hints = await dbAll(`SELECT * FROM task_hints WHERE task_id = ? ORDER BY sort_order ASC, id ASC`, [task.id]);
      for (const hint of hints) {
        await dbRun(
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
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            newTaskId,
            hint.hint_type || "TIMED",
            hint.show_after_seconds || 0,
            hint.purchase_after_seconds || 0,
            winnerChanged ? 0 : (Number(hint.purchase_value) || 0),
            hint.content || "",
            hint.sort_order
          ]
        );
      }

      const olympiadSettings = await dbGet(`SELECT * FROM olympiad_settings WHERE task_id = ?`, [task.id]);
      if (olympiadSettings) {
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
            newTaskId,
            olympiadSettings.association_count,
            olympiadSettings.level_count,
            olympiadSettings.completion_type,
            olympiadSettings.required_cells_count,
            olympiadSettings.purchase_available_after_seconds || 0
          ]
        );

        const cells = await dbAll(`SELECT * FROM olympiad_cells WHERE task_id = ? ORDER BY cell_number ASC`, [task.id]);
        for (const cell of cells) {
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
              newTaskId,
              cell.cell_number,
              cell.level_number,
              cell.content || "",
              cell.answer_text || "",
              cell.comment || "",
              winnerChanged ? 0 : (Number(cell.purchase_value) || 0),
              answerIdMap.get(Number(cell.task_answer_id)) || null
            ]
          );
        }
      }

      const multitaskSettings = await dbGet(`SELECT * FROM multitask_settings WHERE task_id = ?`, [task.id]);
      if (multitaskSettings) {
        await dbRun(
          `INSERT INTO multitask_settings (task_id, completion_type, required_count) VALUES (?, ?, ?)`,
          [newTaskId, multitaskSettings.completion_type || "ALL", multitaskSettings.required_count]
        );

        const subtasks = await dbAll(`SELECT * FROM multitask_subtasks WHERE task_id = ? ORDER BY sort_order ASC, id ASC`, [task.id]);
        for (const subtask of subtasks) {
          await dbRun(
            `
            INSERT INTO multitask_subtasks (
              task_id,
              sort_order,
              content,
              answer_text,
              description,
              comment,
              hint_type,
              hint_text,
              hint_after_seconds,
              hint_purchase_after_seconds,
              hint_purchase_value,
              task_answer_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              newTaskId,
              subtask.sort_order,
              subtask.content || "",
              subtask.answer_text || "",
              subtask.description || "",
              subtask.comment || "",
              subtask.hint_type || "NONE",
              subtask.hint_text || "",
              subtask.hint_after_seconds || 0,
              subtask.hint_purchase_after_seconds || 0,
              winnerChanged ? 0 : (Number(subtask.hint_purchase_value) || 0),
              answerIdMap.get(Number(subtask.task_answer_id)) || null
            ]
          );
        }
      }
    }

    await dbRun("COMMIT");

    res.json({
      message: "Копію гри створено",
      game: { id: newGameId, title }
    });
  } catch (error) {
    console.error(error);
    try { await dbRun("ROLLBACK"); } catch (rollbackError) {}
    res.status(500).json({ error: "Помилка створення копії гри" });
  }
});

module.exports = router;