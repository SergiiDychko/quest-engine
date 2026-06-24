const express = require("express");
const db = require("../database");
const bcrypt = require("bcrypt");
const { getGameAccess, requireCapability, handleAccessError } = require("../services/access");

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



async function copyTaskToGame(sourceTaskId, targetGameId, options = {}) {
  const sourceTask = await dbGet(`SELECT * FROM tasks WHERE id = ?`, [sourceTaskId]);
  if (!sourceTask) {
    const error = new Error("SOURCE_TASK_NOT_FOUND");
    error.statusCode = 404;
    throw error;
  }

  const sourceGame = await dbGet(`SELECT * FROM games WHERE id = ?`, [sourceTask.game_id]);
  const targetGame = await dbGet(`SELECT * FROM games WHERE id = ?`, [targetGameId]);

  if (!targetGame) {
    const error = new Error("TARGET_GAME_NOT_FOUND");
    error.statusCode = 404;
    throw error;
  }

  const winnerChanged = String(sourceGame?.winner_type || "TIME").toUpperCase() !== String(targetGame.winner_type || "TIME").toUpperCase();
  const nextOrderRow = await dbGet(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM tasks WHERE game_id = ?`,
    [targetGameId]
  );

  const isSameGame = Number(sourceTask.game_id) === Number(targetGameId);
  const titlePrefix = options.titlePrefix === undefined ? (isSameGame ? "Копія — " : "") : options.titlePrefix;

  const preservedUnlockType = String(sourceTask.unlock_type || "IMMEDIATE").toUpperCase();
  const copiedUnlockType = preservedUnlockType === "TASK" ? "IMMEDIATE" : preservedUnlockType;

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
      score_points,
      unlock_type,
      unlock_delay_seconds,
      unlock_task_id,
      unlock_code
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      targetGameId,
      `${titlePrefix || ""}${sourceTask.title || ""}`,
      sourceTask.task_type || "STANDARD",
      nextOrderRow?.next_order || 1,
      sourceTask.notes || "",
      sourceTask.is_scored === undefined ? 1 : sourceTask.is_scored,
      sourceTask.auto_transition_minutes,
      winnerChanged ? 0 : (Number(sourceTask.auto_transition_penalty_seconds) || 0),
      sourceTask.required_main_answers,
      sourceTask.hide_answers_block || 0,
      winnerChanged ? 0 : (Number(sourceTask.score_points) || 0),
      copiedUnlockType,
      copiedUnlockType === "TIME" ? (Number(sourceTask.unlock_delay_seconds) || 0) : 0,
      null,
      copiedUnlockType === "CODE" ? (sourceTask.unlock_code || null) : null
    ]
  );

  const newTaskId = newTaskResult.lastID;
  const answerIdMap = new Map();

  const content = await dbAll(`SELECT * FROM task_content WHERE task_id = ? ORDER BY sort_order ASC, id ASC`, [sourceTask.id]);
  for (const block of content) {
    await dbRun(
      `INSERT INTO task_content (task_id, type, content, sort_order) VALUES (?, ?, ?, ?)`,
      [newTaskId, block.type, block.content || "", block.sort_order]
    );
  }

  const answers = await dbAll(`SELECT * FROM task_answers WHERE task_id = ? ORDER BY answer_type, sort_order, id`, [sourceTask.id]);
  for (const answer of answers) {
    const answerResult = await dbRun(
      `
      INSERT INTO task_answers (
        task_id, answer_text, answer_type, description, time_modifier_seconds, comment, sort_order
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

  const hints = await dbAll(`SELECT * FROM task_hints WHERE task_id = ? ORDER BY sort_order ASC, id ASC`, [sourceTask.id]);
  for (const hint of hints) {
    await dbRun(
      `
      INSERT INTO task_hints (
        task_id, hint_type, show_after_seconds, purchase_after_seconds, purchase_value, content, sort_order
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

  const olympiadSettings = await dbGet(`SELECT * FROM olympiad_settings WHERE task_id = ?`, [sourceTask.id]);
  if (olympiadSettings) {
    await dbRun(
      `
      INSERT INTO olympiad_settings (
        task_id, association_count, level_count, completion_type, required_cells_count, purchase_available_after_seconds
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

    const cells = await dbAll(`SELECT * FROM olympiad_cells WHERE task_id = ? ORDER BY cell_number ASC`, [sourceTask.id]);
    for (const cell of cells) {
      await dbRun(
        `
        INSERT INTO olympiad_cells (
          task_id, cell_number, level_number, content, answer_text, comment, purchase_value, task_answer_id
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

  const multitaskSettings = await dbGet(`SELECT * FROM multitask_settings WHERE task_id = ?`, [sourceTask.id]);
  if (multitaskSettings) {
    await dbRun(
      `INSERT INTO multitask_settings (task_id, completion_type, required_count) VALUES (?, ?, ?)`,
      [newTaskId, multitaskSettings.completion_type || "ALL", multitaskSettings.required_count]
    );

    const subtasks = await dbAll(`SELECT * FROM multitask_subtasks WHERE task_id = ? ORDER BY sort_order ASC, id ASC`, [sourceTask.id]);
    for (const subtask of subtasks) {
      await dbRun(
        `
        INSERT INTO multitask_subtasks (
          task_id, sort_order, content, answer_text, description, comment, hint_type,
          hint_text, hint_after_seconds, hint_purchase_after_seconds, hint_purchase_value, task_answer_id
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

  return {
    id: newTaskId,
    title: `${titlePrefix || ""}${sourceTask.title || ""}`,
    task_type: sourceTask.task_type || "STANDARD",
    sort_order: nextOrderRow?.next_order || 1
  };
}

function defaultPage(pageType) {
  const defaults = {
    START: {
      title: "Старт гри",
      content: "Вітаємо на грі!",
      custom_css: ""
    },
    JOIN: {
      title: "Реєстрація команди",
      content: JSON.stringify({
        heading: "Реєстрація команди",
        description: "Введіть назву команди, щоб отримати посилання на гру.",
        button_text: "Створити команду"
      }),
      custom_css: ""
    },
    FINISH: {
      title: "Гру завершено",
      content: "Вітаємо! Ви завершили гру.",
      custom_css: ""
    }
  };

  return defaults[pageType] || { title: "", content: "", custom_css: "" };
}

router.get("/catalog", requireAuth, (req, res) => {
  const user = req.session.user;

  let query = `
    SELECT
      games.id,
      games.title,
      games.description,
      games.status,
      games.created_by,
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
        games.created_by,
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


router.get("/:id/permissions", requireAuth, async (req, res) => {
  const gameId = Number(req.params.id);

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canView");

    const canEditPermissions = req.session.user.role === "ADMIN" || access.isOwner;

    const permissions = await dbAll(
      `
      SELECT
        game_permissions.id,
        game_permissions.game_id,
        game_permissions.user_id,
        game_permissions.permission,
        users.username,
        users.name,
        users.role
      FROM game_permissions
      JOIN users ON users.id = game_permissions.user_id
      WHERE game_permissions.game_id = ?
      ORDER BY LOWER(users.username) ASC
      `,
      [gameId]
    );

    let users = [];
    if (canEditPermissions) {
      users = await dbAll(
        `
        SELECT id, username, name, role
        FROM users
        WHERE role = 'AUTHOR'
          AND id NOT IN (
            SELECT created_by FROM games WHERE id = ?
          )
        ORDER BY LOWER(username) ASC
        `,
        [gameId]
      );
    }

    res.json({
      permissions,
      users,
      access: {
        can_edit_permissions: canEditPermissions,
        can_view: access.canView,
        can_edit: access.canEdit,
        is_owner: access.isOwner,
        permission: access.permission
      }
    });
  } catch (error) {
    return handleAccessError(res, error, "Гру не знайдено");
  }
});

router.post("/:id/permissions", requireAuth, async (req, res) => {
  const gameId = Number(req.params.id);
  const userId = Number(req.body.user_id);
  const permission = String(req.body.permission || "").toUpperCase();

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canView");

    if (req.session.user.role !== "ADMIN" && !access.isOwner) {
      return res.status(403).json({ error: "Дозволи може змінювати тільки автор гри або адміністратор" });
    }

    if (!userId) {
      return res.status(400).json({ error: "Оберіть користувача" });
    }

    if (!["VIEW", "EDIT"].includes(permission)) {
      return res.status(400).json({ error: "Некоректний рівень доступу" });
    }

    const game = await dbGet(`SELECT id, created_by FROM games WHERE id = ?`, [gameId]);
    if (!game) {
      return res.status(404).json({ error: "Гру не знайдено" });
    }

    if (Number(game.created_by) === userId) {
      return res.status(400).json({ error: "Автор гри вже має повний доступ" });
    }

    const targetUser = await dbGet(`SELECT id, role FROM users WHERE id = ?`, [userId]);
    if (!targetUser) {
      return res.status(404).json({ error: "Користувача не знайдено" });
    }

    if (targetUser.role !== "AUTHOR") {
      return res.status(400).json({ error: "Доступ до гри можна надавати тільки авторам" });
    }

    await dbRun(
      `
      INSERT INTO game_permissions (game_id, user_id, permission)
      VALUES (?, ?, ?)
      ON CONFLICT(game_id, user_id)
      DO UPDATE SET permission = excluded.permission
      `,
      [gameId, userId, permission]
    );

    res.json({ message: "Дозвіл збережено" });
  } catch (error) {
    return handleAccessError(res, error, "Гру не знайдено");
  }
});

router.delete("/:id/permissions/:permissionId", requireAuth, async (req, res) => {
  const gameId = Number(req.params.id);
  const permissionId = Number(req.params.permissionId);

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canView");

    if (req.session.user.role !== "ADMIN" && !access.isOwner) {
      return res.status(403).json({ error: "Дозволи може змінювати тільки автор гри або адміністратор" });
    }

    const result = await dbRun(
      `DELETE FROM game_permissions WHERE id = ? AND game_id = ?`,
      [permissionId, gameId]
    );

    if (!result.changes) {
      return res.status(404).json({ error: "Дозвіл не знайдено" });
    }

    res.json({ message: "Дозвіл скасовано" });
  } catch (error) {
    return handleAccessError(res, error, "Гру не знайдено");
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  const gameId = Number(req.params.id);

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canView");

    const game = await dbGet(
      `
      SELECT games.*, users.username AS author_username, users.name AS author_name
      FROM games
      LEFT JOIN users ON users.id = games.created_by
      WHERE games.id = ?
      `,
      [gameId]
    );

    res.json({
      game,
      access: {
        can_view: access.canView,
        can_edit: access.canEdit,
        can_delete: access.canDelete,
        can_manage_runs: access.canManageRuns,
        is_owner: access.isOwner,
        permission: access.permission
      }
    });
  } catch (error) {
    return handleAccessError(res, error, "Гру не знайдено");
  }
});


router.put("/:id/status", requireAuth, async (req, res) => {
  const gameId = Number(req.params.id);
  const { status } = req.body;

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canEdit");
  } catch (error) {
    return handleAccessError(res, error, "Гру не знайдено");
  }

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

router.get("/:id/tasks", requireAuth, async (req, res) => {
  const gameId = Number(req.params.id);

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canView");

    const tasks = await dbAll(
      `
      SELECT *
      FROM tasks
      WHERE game_id = ?
      ORDER BY sort_order ASC
      `,
      [gameId]
    );

    res.json({ tasks });
  } catch (error) {
    return handleAccessError(res, error, "Гру не знайдено");
  }
});

router.post("/:id/tasks", requireAuth, async (req, res) => {
  const gameId = Number(req.params.id);
  const { title, task_type } = req.body;

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canEdit");
  } catch (error) {
    return handleAccessError(res, error, "Гру не знайдено");
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


router.put("/:id/tasks/reorder", requireAuth, async (req, res) => {
  const gameId = Number(req.params.id);
  const taskIds = Array.isArray(req.body?.task_ids)
    ? req.body.task_ids.map(id => Number(id)).filter(Boolean)
    : [];

  if (!gameId || !taskIds.length) {
    return res.status(400).json({ error: "Некоректний порядок завдань" });
  }

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canEdit");

    const existingTasks = await dbAll(
      `SELECT id FROM tasks WHERE game_id = ? ORDER BY sort_order ASC, id ASC`,
      [gameId]
    );

    const existingIds = existingTasks.map(task => Number(task.id));
    const uniqueIds = [...new Set(taskIds)];

    const isSameSet = existingIds.length === uniqueIds.length
      && existingIds.every(id => uniqueIds.includes(id));

    if (!isSameSet) {
      return res.status(400).json({ error: "Список завдань не відповідає цій грі" });
    }

    await dbRun("BEGIN TRANSACTION");

    for (let index = 0; index < uniqueIds.length; index += 1) {
      await dbRun(
        `UPDATE tasks SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND game_id = ?`,
        [index + 1, uniqueIds[index], gameId]
      );
    }

    await dbRun("COMMIT");

    res.json({ message: "Порядок завдань оновлено" });
  } catch (error) {
    try { await dbRun("ROLLBACK"); } catch (rollbackError) {}
    res.status(500).json({ error: "Помилка оновлення порядку завдань" });
  }
});

router.post("/:id/tasks/:taskId/copy", requireAuth, async (req, res) => {
  const sourceGameId = Number(req.params.id);
  const sourceTaskId = Number(req.params.taskId);
  const targetGameId = Number(req.body?.target_game_id);

  if (!sourceGameId || !sourceTaskId || !targetGameId) {
    return res.status(400).json({ error: "Некоректні дані для копіювання" });
  }

  try {
    const sourceAccess = await getGameAccess(req.session.user, sourceGameId);
    requireCapability(sourceAccess, "canView");
    const targetAccess = await getGameAccess(req.session.user, targetGameId);
    requireCapability(targetAccess, "canEdit");

    const task = await dbGet(
      `SELECT id, game_id FROM tasks WHERE id = ? AND game_id = ?`,
      [sourceTaskId, sourceGameId]
    );

    if (!task) {
      return res.status(404).json({ error: "Завдання не знайдено в цій грі" });
    }

    await dbRun("BEGIN TRANSACTION");
    const copiedTask = await copyTaskToGame(sourceTaskId, targetGameId);
    await dbRun("COMMIT");

    res.json({
      message: "Завдання скопійовано",
      task: copiedTask
    });
  } catch (error) {
    try { await dbRun("ROLLBACK"); } catch (rollbackError) {}

    if (error.statusCode === 404 || error.message === "TARGET_GAME_NOT_FOUND") {
      return res.status(404).json({ error: "Цільову гру не знайдено" });
    }

    console.error(error);
    res.status(500).json({ error: "Помилка копіювання завдання" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const gameId = Number(req.params.id);
  const password = String(req.body?.password || "");
  const user = req.session.user;

  if (!gameId) {
    return res.status(400).json({ error: "Некоректна гра" });
  }

  if (!password) {
    return res.status(400).json({ error: "Введіть пароль для підтвердження" });
  }

  try {
    const dbUser = await dbGet(`SELECT id, password_hash, role FROM users WHERE id = ?`, [user.id]);
    if (!dbUser) {
      return res.status(401).json({ error: "Користувача не знайдено" });
    }

    const passwordOk = await bcrypt.compare(password, dbUser.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: "Невірний пароль" });
    }

    const game = await dbGet(`SELECT id, created_by FROM games WHERE id = ?`, [gameId]);
    if (!game) {
      return res.status(404).json({ error: "Гру не знайдено" });
    }

    const access = await getGameAccess(user, gameId);
    if (!access.canDelete) {
      return res.status(403).json({ error: "Недостатньо прав для видалення цієї гри" });
    }

    await dbRun("BEGIN TRANSACTION");

    const runs = await dbAll(`SELECT id FROM game_runs WHERE game_id = ?`, [gameId]);
    for (const run of runs) {
      const runId = Number(run.id);
      const teams = await dbAll(`SELECT id FROM teams WHERE run_id = ?`, [runId]);
      const teamIds = teams.map(team => Number(team.id)).filter(Boolean);
      if (teamIds.length) {
        const placeholders = teamIds.map(() => "?").join(",");
        await dbRun(`DELETE FROM team_answers WHERE team_id IN (${placeholders})`, teamIds);
        await dbRun(`DELETE FROM team_found_answers WHERE team_id IN (${placeholders})`, teamIds);
        await dbRun(`DELETE FROM team_time_adjustments WHERE team_id IN (${placeholders})`, teamIds);
        await dbRun(`DELETE FROM team_tasks WHERE team_id IN (${placeholders})`, teamIds);
        await dbRun(`DELETE FROM team_hint_purchases WHERE team_id IN (${placeholders})`, teamIds);
        await dbRun(`DELETE FROM team_multitask_hint_purchases WHERE team_id IN (${placeholders})`, teamIds);
        await dbRun(`DELETE FROM team_score_events WHERE team_id IN (${placeholders})`, teamIds);
        await dbRun(`DELETE FROM messages WHERE team_id IN (${placeholders}) OR sender_team_id IN (${placeholders})`, [...teamIds, ...teamIds]);
      }
      await dbRun(`DELETE FROM messages WHERE run_id = ?`, [runId]);
      await dbRun(`DELETE FROM run_pages WHERE run_id = ?`, [runId]);
      await dbRun(`DELETE FROM run_moderators WHERE run_id = ?`, [runId]);
      await dbRun(`DELETE FROM teams WHERE run_id = ?`, [runId]);
      await dbRun(`DELETE FROM game_runs WHERE id = ?`, [runId]);
    }

    const tasks = await dbAll(`SELECT id FROM tasks WHERE game_id = ?`, [gameId]);
    for (const task of tasks) {
      const taskId = Number(task.id);
      await dbRun(`DELETE FROM task_content WHERE task_id = ?`, [taskId]);
      await dbRun(`DELETE FROM task_hints WHERE task_id = ?`, [taskId]);
      await dbRun(`DELETE FROM multitask_settings WHERE task_id = ?`, [taskId]);
      await dbRun(`DELETE FROM multitask_subtasks WHERE task_id = ?`, [taskId]);
      await dbRun(`DELETE FROM olympiad_settings WHERE task_id = ?`, [taskId]);
      await dbRun(`DELETE FROM olympiad_cells WHERE task_id = ?`, [taskId]);
      await dbRun(`DELETE FROM task_answers WHERE task_id = ?`, [taskId]);
    }

    await dbRun(`DELETE FROM tasks WHERE game_id = ?`, [gameId]);
    await dbRun(`DELETE FROM game_pages WHERE game_id = ?`, [gameId]);
    await dbRun(`DELETE FROM game_permissions WHERE game_id = ?`, [gameId]);
    await dbRun(`DELETE FROM games WHERE id = ?`, [gameId]);

    await dbRun("COMMIT");
    res.json({ message: "Гру видалено" });
  } catch (error) {
    try { await dbRun("ROLLBACK"); } catch (rollbackError) {}
    res.status(500).json({ error: "Помилка видалення гри" });
  }
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
    const sourceAccess = await getGameAccess(user, sourceGameId);
    requireCapability(sourceAccess, "canView");

    const sourceGame = await dbGet(`SELECT * FROM games WHERE id = ?`, [sourceGameId]);
    if (!sourceGame) {
      return res.status(404).json({ error: "Гру не знайдено" });
    }

    const winnerChanged = String(sourceGame.winner_type || "TIME").toUpperCase() !== winnerType;
    const shouldCopyStormUnlocks = gameType === "STORM";

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
    const pagesByType = new Map(pages.map(page => [page.page_type, page]));

    for (const pageType of ["START", "JOIN", "FINISH"]) {
      const sourcePage = pagesByType.get(pageType);
      const fallbackPage = defaultPage(pageType);
      const page = sourcePage || {
        page_type: pageType,
        title: fallbackPage.title,
        content: fallbackPage.content,
        custom_css: fallbackPage.custom_css
      };

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
          score_points,
          unlock_type,
          unlock_delay_seconds,
          unlock_task_id,
          unlock_code
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          winnerChanged ? 0 : (Number(task.score_points) || 0),
          shouldCopyStormUnlocks ? (task.unlock_type || "IMMEDIATE") : "IMMEDIATE",
          shouldCopyStormUnlocks ? (Number(task.unlock_delay_seconds) || 0) : 0,
          shouldCopyStormUnlocks && String(task.unlock_type || "").toUpperCase() === "TASK" ? (task.unlock_task_id || null) : null,
          shouldCopyStormUnlocks && String(task.unlock_type || "").toUpperCase() === "CODE" ? (task.unlock_code || null) : null
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

    for (const sourceTask of tasks) {
      const copiedTaskId = taskIdMap.get(Number(sourceTask.id));
      if (!copiedTaskId) continue;

      if (shouldCopyStormUnlocks && String(sourceTask.unlock_type || "IMMEDIATE").toUpperCase() === "TASK") {
        const mappedDependencyId = taskIdMap.get(Number(sourceTask.unlock_task_id)) || null;
        await dbRun(
          `UPDATE tasks SET unlock_task_id = ? WHERE id = ?`,
          [mappedDependencyId, copiedTaskId]
        );
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