const express = require("express");
const db = require("../database");

const router = express.Router();

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeTeamName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isScoreModeValue(value) {
  const type = String(value || "TIME").toUpperCase();
  return type === "SCORE" || type === "POINTS";
}

function splitUserAnswers(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
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



async function addScoreEvent({ teamId, taskId, eventType, points, comment }) {
  const value = Number(points) || 0;
  if (!value) return;

  await dbRun(
    `
    INSERT INTO team_score_events (
      team_id,
      task_id,
      event_type,
      points,
      comment
    )
    VALUES (?, ?, ?, ?, ?)
    `,
    [teamId, taskId || null, eventType, value, comment || ""]
  );
}

async function addTaskCompletionScoreIfNeeded(teamId, task) {
  const points = Math.max(0, Number(task.score_points) || 0);
  if (!points) return;

  const existing = await dbGet(
    `
    SELECT id
    FROM team_score_events
    WHERE team_id = ?
      AND task_id = ?
      AND event_type = 'TASK_COMPLETE'
    LIMIT 1
    `,
    [teamId, task.id]
  );

  if (existing) return;

  await addScoreEvent({
    teamId,
    taskId: task.id,
    eventType: "TASK_COMPLETE",
    points,
    comment: `Виконано завдання ${task.sort_order}${task.title ? `: ${task.title}` : ""}`
  });
}

async function recordPositiveOrNegativeCodeEvent({ gameData, task, answer }) {
  if (!isScoreModeValue(gameData.winner_type)) return;

  const raw = Math.abs(Number(answer.time_modifier_seconds) || 0);
  if (!raw) return;

  if (answer.answer_type === "BONUS") {
    await addScoreEvent({
      teamId: gameData.team_id,
      taskId: task.id,
      eventType: "BONUS_CODE",
      points: raw,
      comment: answer.comment || answer.description || answer.answer_text
    });
  }

  if (answer.answer_type === "PENALTY") {
    await addScoreEvent({
      teamId: gameData.team_id,
      taskId: task.id,
      eventType: "PENALTY_CODE",
      points: -raw,
      comment: answer.comment || answer.description || answer.answer_text
    });
  }
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

async function getOlympiadPayload(teamId, taskId) {
  const settings = await dbGet(
    `SELECT * FROM olympiad_settings WHERE task_id = ?`,
    [taskId]
  );

  if (!settings) {
    return null;
  }

  const cells = await dbAll(
    `
    SELECT
      olympiad_cells.id,
      olympiad_cells.task_id,
      olympiad_cells.cell_number,
      olympiad_cells.level_number,
      olympiad_cells.content,
      olympiad_cells.answer_text,
      olympiad_cells.comment,
      olympiad_cells.purchase_value,
      olympiad_cells.task_answer_id,
      team_found_answers.found_at
    FROM olympiad_cells
    LEFT JOIN team_found_answers
      ON team_found_answers.task_answer_id = olympiad_cells.task_answer_id
      AND team_found_answers.team_id = ?
    WHERE olympiad_cells.task_id = ?
    ORDER BY olympiad_cells.cell_number ASC
    `,
    [teamId, taskId]
  );

  return {
    settings,
    cells: cells.map(cell => ({
      id: cell.id,
      cell_number: cell.cell_number,
      level_number: cell.level_number,
      content: cell.content || "",
      answer_text: cell.found_at ? cell.answer_text : "",
      purchase_value: cell.purchase_value || 0,
      is_found: Boolean(cell.found_at),
      task_answer_id: cell.task_answer_id
    }))
  };
}

async function checkOlympiadCompletion(teamId, task) {
  const settings = await dbGet(
    `SELECT * FROM olympiad_settings WHERE task_id = ?`,
    [task.id]
  );

  if (!settings) {
    return {
      completed: false,
      found_main: 0,
      required_main_answers: 0
    };
  }

  const foundRow = await dbGet(
    `
    SELECT COUNT(*) AS found_count
    FROM team_found_answers
    JOIN olympiad_cells
      ON olympiad_cells.task_answer_id = team_found_answers.task_answer_id
    WHERE team_found_answers.team_id = ?
      AND olympiad_cells.task_id = ?
    `,
    [teamId, task.id]
  );

  const totalRow = await dbGet(
    `SELECT COUNT(*) AS total_count, MAX(cell_number) AS top_cell FROM olympiad_cells WHERE task_id = ?`,
    [task.id]
  );

  const foundCount = foundRow?.found_count || 0;
  const totalCount = totalRow?.total_count || 0;
  const topCellNumber = totalRow?.top_cell || 0;

  let completed = false;
  let required = totalCount;

  if (settings.completion_type === "ALL") {
    completed = totalCount > 0 && foundCount >= totalCount;
    required = totalCount;
  } else if (settings.completion_type === "COUNT") {
    required = Number(settings.required_cells_count) || totalCount;
    completed = foundCount >= required;
  } else {
    const topFound = await dbGet(
      `
      SELECT team_found_answers.id
      FROM team_found_answers
      JOIN olympiad_cells
        ON olympiad_cells.task_answer_id = team_found_answers.task_answer_id
      WHERE team_found_answers.team_id = ?
        AND olympiad_cells.task_id = ?
        AND olympiad_cells.cell_number = ?
      `,
      [teamId, task.id, topCellNumber]
    );

    completed = Boolean(topFound);
    required = 1;
  }

  if (!completed) {
    return {
      completed: false,
      found_main: foundCount,
      required_main_answers: required
    };
  }

  const timeRow = await dbGet(`SELECT CURRENT_TIMESTAMP AS completed_at`);
  const completedAt = timeRow.completed_at;

  await dbRun(
    `
    UPDATE team_tasks
    SET completed_at = ?
    WHERE team_id = ?
      AND task_id = ?
      AND completed_at IS NULL
    `,
    [completedAt, teamId, task.id]
  );

  await new Promise((resolve, reject) => {
    openNextTaskAt(teamId, task.game_id, task.sort_order, completedAt, error => {
      if (error) reject(error);
      else resolve();
    });
  });

  await addTaskCompletionScoreIfNeeded(teamId, task);

  return {
    completed: true,
    completed_at: completedAt,
    found_main: foundCount,
    required_main_answers: required
  };
}


async function getMultitaskPayload(teamId, taskId) {
  const settings = await dbGet(
    `SELECT * FROM multitask_settings WHERE task_id = ?`,
    [taskId]
  );

  if (!settings) {
    return null;
  }

  const subtasks = await dbAll(
    `
    SELECT
      multitask_subtasks.*,
      team_found_answers.found_at,
      team_multitask_hint_purchases.purchased_at
    FROM multitask_subtasks
    LEFT JOIN team_found_answers
      ON team_found_answers.task_answer_id = multitask_subtasks.task_answer_id
      AND team_found_answers.team_id = ?
    LEFT JOIN team_multitask_hint_purchases
      ON team_multitask_hint_purchases.multitask_subtask_id = multitask_subtasks.id
      AND team_multitask_hint_purchases.team_id = ?
    WHERE multitask_subtasks.task_id = ?
    ORDER BY multitask_subtasks.sort_order ASC, multitask_subtasks.id ASC
    `,
    [teamId, teamId, taskId]
  );

  return {
    settings,
    subtasks: subtasks.map(item => ({
      id: item.id,
      sort_order: item.sort_order,
      content: item.content || "",
      answer_text: item.found_at ? item.answer_text : "",
      description: item.description || "",
      comment: item.found_at ? (item.comment || "") : "",
      hint_type: item.hint_type || "NONE",
      hint_text: item.hint_text || "",
      hint_after_seconds: Number(item.hint_after_seconds) || 0,
      hint_purchase_after_seconds: Number(item.hint_purchase_after_seconds) || 0,
      hint_purchase_value: Number(item.hint_purchase_value) || 0,
      is_found: Boolean(item.found_at),
      hint_purchased: Boolean(item.purchased_at),
      task_answer_id: item.task_answer_id
    }))
  };
}

function defaultGamePage(pageType) {
  if (pageType === "START") {
    return {
      page_type: "START",
      title: "Гра ще не почалась",
      content: JSON.stringify([
        {
          type: "TEXT",
          content: JSON.stringify({
            text: "Гра ще не почалась. Спробуйте оновити сторінку пізніше."
          })
        }
      ]),
      custom_css: ""
    };
  }

  if (pageType === "FINISH") {
    return {
      page_type: "FINISH",
      title: "Гру завершено",
      content: JSON.stringify([
        {
          type: "TEXT",
          content: JSON.stringify({
            text: "Вітаємо! Ви завершили гру."
          })
        }
      ]),
      custom_css: ""
    };
  }

  return {
    page_type: pageType,
    title: "",
    content: "[]",
    custom_css: ""
  };
}

function getGamePage(gameId, pageType, callback) {
  db.get(
    `
    SELECT page_type, title, content, custom_css
    FROM game_pages
    WHERE game_id = ?
      AND page_type = ?
    `,
    [gameId, pageType],
    (error, page) => {
      if (error) return callback(error);
      callback(null, page || defaultGamePage(pageType));
    }
  );
}

function parseUtcDate(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(" ", "T");
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getGameDataByPin(pin, callback) {
  db.get(
    `
    SELECT
      teams.id AS team_id,
      teams.name AS team_name,
      teams.pin AS team_pin,
      teams.finished_at AS team_finished_at,
      teams.created_at AS team_created_at,

      game_runs.id AS run_id,
      game_runs.title AS run_title,
      game_runs.run_code,
      game_runs.status AS run_status,
      game_runs.started_at,
      game_runs.finished_at AS run_finished_at,

      games.id AS game_id,
      games.title AS game_title,
      games.game_type,
      games.winner_type
    FROM teams
    JOIN game_runs ON game_runs.id = teams.run_id
    JOIN games ON games.id = game_runs.game_id
    WHERE teams.pin = ?
    `,
    [pin],
    callback
  );
}

function getCurrentTask(teamId, gameId, callback) {
  db.get(
    `
    SELECT
      tasks.*,
      team_tasks.opened_at,
      team_tasks.completed_at,
      team_tasks.auto_transition
    FROM tasks
    LEFT JOIN team_tasks
      ON team_tasks.task_id = tasks.id
      AND team_tasks.team_id = ?
    WHERE tasks.game_id = ?
      AND team_tasks.completed_at IS NULL
    ORDER BY tasks.sort_order ASC, tasks.id ASC
    LIMIT 1
    `,
    [teamId, gameId],
    (error, task) => {
      if (error) return callback(error);
      if (!task) return callback(null, null);

      db.get(
        `
        SELECT id
        FROM team_tasks
        WHERE team_id = ?
          AND task_id = ?
        `,
        [teamId, task.id],
        (teamTaskError, teamTask) => {
          if (teamTaskError) return callback(teamTaskError);
          if (teamTask) return callback(null, task);

          db.run(
            `
            INSERT INTO team_tasks (
              team_id,
              task_id,
              opened_at
            )
            VALUES (?, ?, CURRENT_TIMESTAMP)
            `,
            [teamId, task.id],
            insertError => {
              if (insertError) return callback(insertError);

              db.get(
                `
                SELECT
                  tasks.*,
                  team_tasks.opened_at,
                  team_tasks.completed_at
                FROM tasks
                JOIN team_tasks
                  ON team_tasks.task_id = tasks.id
                  AND team_tasks.team_id = ?
                WHERE tasks.id = ?
                `,
                [teamId, task.id],
                callback
              );
            }
          );
        }
      );
    }
  );
}

function getTaskContent(taskId, callback) {
  db.all(
    `
    SELECT *
    FROM task_content
    WHERE task_id = ?
    ORDER BY sort_order ASC, id ASC
    `,
    [taskId],
    callback
  );
}

function getTaskHints(taskId, teamId, callback) {
  db.all(
    `
    SELECT
      task_hints.*,
      team_hint_purchases.purchased_at AS purchased_at
    FROM task_hints
    LEFT JOIN team_hint_purchases
      ON team_hint_purchases.task_hint_id = task_hints.id
      AND team_hint_purchases.team_id = ?
    WHERE task_hints.task_id = ?
    ORDER BY task_hints.sort_order ASC, task_hints.id ASC
    `,
    [teamId || 0, taskId],
    callback
  );
}

function getTaskAnswersForPlayer(taskId, callback) {
  db.all(
    `
    SELECT
      task_answers.id,
      task_answers.answer_type,
      task_answers.description,
      task_answers.comment,
      task_answers.sort_order,
      task_answers.time_modifier_seconds
    FROM task_answers
    WHERE task_answers.task_id = ?
    ORDER BY
      CASE task_answers.answer_type
        WHEN 'MAIN' THEN 1
        WHEN 'BONUS' THEN 2
        WHEN 'PENALTY' THEN 3
        ELSE 4
      END,
      task_answers.sort_order ASC,
      task_answers.id ASC
    `,
    [taskId],
    callback
  );
}

function getFoundAnswersForTeamAndTask(teamId, taskId, callback) {
  db.all(
    `
    SELECT
      team_found_answers.task_answer_id,
      task_answers.answer_text,
      task_answers.answer_type,
      task_answers.description,
      task_answers.comment,
      task_answers.sort_order,
      task_answers.time_modifier_seconds
    FROM team_found_answers
    JOIN task_answers
      ON task_answers.id = team_found_answers.task_answer_id
    WHERE team_found_answers.team_id = ?
      AND task_answers.task_id = ?
    `,
    [teamId, taskId],
    callback
  );
}

function getTaskAnswersForCheck(taskId, callback) {
  db.all(
    `
    SELECT *
    FROM task_answers
    WHERE task_id = ?
    ORDER BY
      CASE answer_type
        WHEN 'MAIN' THEN 1
        WHEN 'BONUS' THEN 2
        WHEN 'PENALTY' THEN 3
        ELSE 4
      END,
      sort_order ASC,
      id ASC
    `,
    [taskId],
    callback
  );
}

function openNextTaskAt(teamId, gameId, currentSortOrder, openedAt, callback) {
  db.get(
    `
    SELECT id
    FROM tasks
    WHERE game_id = ?
      AND sort_order > ?
    ORDER BY sort_order ASC, id ASC
    LIMIT 1
    `,
    [gameId, currentSortOrder],
    (error, nextTask) => {
      if (error) return callback(error);
      if (!nextTask) return callback(null, false);

      db.run(
        `
        INSERT INTO team_tasks (
          team_id,
          task_id,
          opened_at
        )
        SELECT ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM team_tasks
          WHERE team_id = ?
            AND task_id = ?
        )
        `,
        [teamId, nextTask.id, openedAt, teamId, nextTask.id],
        insertError => {
          if (insertError) return callback(insertError);
          callback(null, true);
        }
      );
    }
  );
}

function completeTaskIfNeeded(teamId, task, callback) {
  db.get(
    `
    SELECT COUNT(*) AS total_main
    FROM task_answers
    WHERE task_id = ?
      AND answer_type = 'MAIN'
    `,
    [task.id],
    (totalError, totalRow) => {
      if (totalError) return callback(totalError);

      const totalMain = totalRow.total_main || 0;
      const requiredMainAnswers =
        task.required_main_answers || totalMain || 1;

      db.get(
        `
        SELECT COUNT(*) AS found_main
        FROM team_found_answers
        JOIN task_answers
          ON task_answers.id = team_found_answers.task_answer_id
        WHERE team_found_answers.team_id = ?
          AND task_answers.task_id = ?
          AND task_answers.answer_type = 'MAIN'
        `,
        [teamId, task.id],
        (foundError, foundRow) => {
          if (foundError) return callback(foundError);

          const foundMain = foundRow.found_main || 0;

          if (foundMain < requiredMainAnswers) {
            return callback(null, {
              completed: false,
              found_main: foundMain,
              required_main_answers: requiredMainAnswers
            });
          }

          db.get(
  `SELECT CURRENT_TIMESTAMP AS completed_at`,
  [],
  (timeError, timeRow) => {
    if (timeError) return callback(timeError);

    const completedAt = timeRow.completed_at;

    db.run(
      `
      UPDATE team_tasks
      SET completed_at = ?
      WHERE team_id = ?
        AND task_id = ?
        AND completed_at IS NULL
      `,
      [completedAt, teamId, task.id],
      updateError => {
        if (updateError) return callback(updateError);

        addTaskCompletionScoreIfNeeded(teamId, task)
          .then(() => {
            const isStorm = String(task.game_type || "LINEAR").toUpperCase() === "STORM";
            if (isStorm) {
              return callback(null, {
                completed: true,
                completed_at: completedAt,
                found_main: foundMain,
                required_main_answers: requiredMainAnswers
              });
            }

            openNextTaskAt(
              teamId,
              task.game_id,
              task.sort_order,
              completedAt,
              nextError => {
                if (nextError) return callback(nextError);

                callback(null, {
                  completed: true,
                  completed_at: completedAt,
                  found_main: foundMain,
                  required_main_answers: requiredMainAnswers
                });
              }
            );
          })
          .catch(scoreError => callback(scoreError));
      }
    );
  }
);
        }
      );
    }
  );
}


function secondsUntilUtc(value) {
  if (!value) return null;
  const target = parseUtcDate(value);
  if (!target || Number.isNaN(target.getTime())) return null;
  return Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
}

function addSecondsToUtc(value, seconds) {
  const base = parseUtcDate(value);
  if (!base || Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + (Number(seconds) || 0) * 1000);
}

async function ensureStormTeamTask(teamId, taskId, openedAt) {
  await dbRun(
    `
    INSERT INTO team_tasks (team_id, task_id, opened_at)
    SELECT ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM team_tasks WHERE team_id = ? AND task_id = ?
    )
    `,
    [teamId, taskId, openedAt || null, teamId, taskId]
  );
}

async function isStormTaskUnlocked({ gameData, task, completedTaskIds, foundCodes }) {
  const unlockType = String(task.unlock_type || "IMMEDIATE").toUpperCase();

  if (unlockType === "TIME") {
    const delay = Math.max(0, Number(task.unlock_delay_seconds) || 0);
    const base = gameData.started_at || gameData.team_created_at;
    const opensAt = addSecondsToUtc(base, delay);
    const remaining = opensAt ? Math.max(0, Math.floor((opensAt.getTime() - Date.now()) / 1000)) : 0;
    return {
      unlocked: remaining <= 0,
      opensAt: opensAt ? opensAt.toISOString() : null,
      remaining_seconds: remaining,
      locked_message: remaining > 0 ? null : ""
    };
  }

  if (unlockType === "TASK") {
    const dependencyId = Number(task.unlock_task_id) || 0;
    const unlocked = dependencyId > 0 && completedTaskIds.has(dependencyId);
    const dependencyTitle = task.unlock_task_title
      ? `Завдання ${task.unlock_task_sort_order}. ${task.unlock_task_title}`
      : (task.unlock_task_sort_order ? `Завдання ${task.unlock_task_sort_order}` : "іншого завдання");
    return {
      unlocked,
      opensAt: null,
      remaining_seconds: null,
      locked_message: `Відкриється після виконання "${dependencyTitle}"`
    };
  }

  if (unlockType === "CODE") {
    const requiredCode = normalizeAnswer(task.unlock_code || "");
    const unlocked = requiredCode && foundCodes.has(requiredCode);
    return {
      unlocked,
      opensAt: null,
      remaining_seconds: null,
      locked_message: "Відкриється після здачі певного коду"
    };
  }

  return { unlocked: true, opensAt: null, remaining_seconds: null, locked_message: "" };
}

async function buildStormPayload(gameData) {
  const tasks = await dbAll(
    `
    SELECT
      tasks.*,
      dependency.sort_order AS unlock_task_sort_order,
      dependency.title AS unlock_task_title,
      team_tasks.opened_at,
      team_tasks.completed_at,
      team_tasks.auto_transition
    FROM tasks
    LEFT JOIN tasks AS dependency ON dependency.id = tasks.unlock_task_id
    LEFT JOIN team_tasks
      ON team_tasks.task_id = tasks.id
     AND team_tasks.team_id = ?
    WHERE tasks.game_id = ?
    ORDER BY tasks.sort_order ASC, tasks.id ASC
    `,
    [gameData.team_id, gameData.game_id]
  );

  const completedTaskIds = new Set(
    tasks.filter(task => task.completed_at).map(task => Number(task.id))
  );

  const foundRows = await dbAll(
    `
    SELECT task_answers.answer_text
    FROM team_found_answers
    JOIN task_answers ON task_answers.id = team_found_answers.task_answer_id
    JOIN tasks ON tasks.id = task_answers.task_id
    WHERE team_found_answers.team_id = ?
      AND tasks.game_id = ?
    `,
    [gameData.team_id, gameData.game_id]
  );

  const foundCodes = new Set(foundRows.map(row => normalizeAnswer(row.answer_text)));
  const nowSql = await dbGet(`SELECT CURRENT_TIMESTAMP AS now`);

  const tabs = [];

  for (const task of tasks) {
    const unlockState = await isStormTaskUnlocked({ gameData, task, completedTaskIds, foundCodes });
    const available = Boolean(unlockState.unlocked);

    if (available && !task.opened_at) {
      await ensureStormTeamTask(gameData.team_id, task.id, nowSql.now);
      task.opened_at = nowSql.now;
    }

    const item = {
      id: task.id,
      sort_order: task.sort_order,
      title: task.title || "",
      task_type: task.task_type || "STANDARD",
      completed_at: task.completed_at || null,
      auto_transition: Number(task.auto_transition) || 0,
      opened_at: task.opened_at || null,
      auto_transition_minutes: Number(task.auto_transition_minutes) || 0,
      score_points: Number(task.score_points) || 0,
      available,
      unlock_type: task.unlock_type || "IMMEDIATE",
      remaining_seconds: unlockState.remaining_seconds,
      locked_message: unlockState.remaining_seconds > 0
        ? `Відкриється через ${formatDurationForStorm(unlockState.remaining_seconds)}`
        : (available ? "" : unlockState.locked_message)
    };

    if (available) {
      item.task = task;
      item.content = task.task_type === "MULTITASK" ? [] : await dbAll(
        `SELECT * FROM task_content WHERE task_id = ? ORDER BY sort_order ASC, id ASC`,
        [task.id]
      );
      item.hints = task.task_type === "MULTITASK" ? [] : await dbAll(
        `
        SELECT task_hints.*, team_hint_purchases.purchased_at AS purchased_at
        FROM task_hints
        LEFT JOIN team_hint_purchases
          ON team_hint_purchases.task_hint_id = task_hints.id
         AND team_hint_purchases.team_id = ?
        WHERE task_hints.task_id = ?
        ORDER BY task_hints.sort_order ASC, task_hints.id ASC
        `,
        [gameData.team_id, task.id]
      );
      item.answers = task.hide_answers_block ? [] : await dbAll(
        `SELECT id, answer_type, description, sort_order FROM task_answers WHERE task_id = ? ORDER BY answer_type, sort_order`,
        [task.id]
      );
      item.found_answers = await dbAll(
        `
        SELECT
          team_found_answers.task_answer_id,
          task_answers.answer_text,
          task_answers.answer_type,
          task_answers.description,
          task_answers.comment,
          task_answers.sort_order,
          task_answers.time_modifier_seconds
        FROM team_found_answers
        JOIN task_answers ON task_answers.id = team_found_answers.task_answer_id
        WHERE team_found_answers.team_id = ?
          AND task_answers.task_id = ?
        ORDER BY task_answers.answer_type, task_answers.sort_order
        `,
        [gameData.team_id, task.id]
      );
      item.olympiad = task.task_type === "OLYMPIAD"
        ? await getOlympiadPayload(gameData.team_id, task.id)
        : null;
      item.multitask = task.task_type === "MULTITASK"
        ? await getMultitaskPayload(gameData.team_id, task.id)
        : null;
    }

    tabs.push(item);
  }

  const activePlayable = tabs.find(item => item.available && !item.completed_at) || null;
  const activeDisplay = activePlayable || tabs.find(item => item.available) || null;
  const hasFutureLockedTasks = tabs.some(item => !item.available);
  const hasOpenOrFutureTasks = Boolean(activePlayable || hasFutureLockedTasks);
  const briefingPage = await dbGet(
    `SELECT * FROM game_pages WHERE game_id = ? AND page_type = 'START'`,
    [gameData.game_id]
  );

  return {
    briefing: briefingPage || null,
    run_finished_at: gameData.run_finished_at || null,
    tasks: tabs,
    has_open_or_future_tasks: hasOpenOrFutureTasks,
    active_task_id: activeDisplay ? activeDisplay.id : null
  };
}

function formatDurationForStorm(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function getStormPlayableTask(gameData, requestedTaskId) {
  const storm = await buildStormPayload(gameData);
  const item = storm.tasks.find(task => Number(task.id) === Number(requestedTaskId || storm.active_task_id));
  if (!item || !item.available || !item.task || item.completed_at) return null;
  return { task: { ...item.task, game_type: "STORM" }, storm };
}

function hasNextTask(teamId, gameId, callback) {
  db.get(
    `
    SELECT tasks.id
    FROM tasks
    LEFT JOIN team_tasks
      ON team_tasks.task_id = tasks.id
      AND team_tasks.team_id = ?
    WHERE tasks.game_id = ?
      AND team_tasks.completed_at IS NULL
    ORDER BY tasks.sort_order ASC, tasks.id ASC
    LIMIT 1
    `,
    [teamId, gameId],
    (error, task) => {
      if (error) return callback(error);
      callback(null, Boolean(task));
    }
  );
}

router.get("/:pin", (req, res) => {
  const pin = String(req.params.pin || "").trim().toUpperCase();

  getGameDataByPin(pin, (error, gameData) => {
    if (error) {
      return res.status(500).json({
        error: "Помилка завантаження гри"
      });
    }

    if (!gameData) {
      return res.status(404).json({
        error: "Команду не знайдено"
      });
    }

    if (gameData.run_status === "ARCHIVED") {
      return getGamePage(gameData.game_id, "FINISH", (pageError, page) => {
        if (pageError) {
          return res.status(500).json({ error: "Помилка завантаження фінальної сторінки" });
        }

        return res.json({
          status: "ARCHIVED",
          game: gameData,
          page
        });
      });
    }

    if (gameData.team_finished_at) {
      return getGamePage(gameData.game_id, "FINISH", (pageError, page) => {
        if (pageError) {
          return res.status(500).json({ error: "Помилка завантаження фінальної сторінки" });
        }

        return res.json({
          status: "FINISHED",
          game: gameData,
          page
        });
      });
    }

    if (gameData.started_at && gameData.run_status !== "ACTIVE") {
      const startDate = parseUtcDate(gameData.started_at);
      const now = new Date();

      if (startDate && now < startDate) {
        return getGamePage(gameData.game_id, "START", (pageError, page) => {
          if (pageError) {
            return res.status(500).json({ error: "Помилка завантаження стартової сторінки" });
          }

          return res.json({
            status: "WAITING",
            game: gameData,
            page
          });
        });
      }
    }

    if (String(gameData.game_type || "LINEAR").toUpperCase() === "STORM") {
      if (gameData.run_finished_at) {
        const finishDate = parseUtcDate(gameData.run_finished_at);
        if (finishDate && Date.now() >= finishDate.getTime()) {
          db.run(`UPDATE teams SET finished_at = CURRENT_TIMESTAMP WHERE id = ? AND finished_at IS NULL`, [gameData.team_id]);
          return getGamePage(gameData.game_id, "FINISH", (pageError, page) => {
            if (pageError) return res.status(500).json({ error: "Помилка завантаження фінальної сторінки" });
            return res.json({ status: "FINISHED", game: gameData, page });
          });
        }
      }

      buildStormPayload(gameData)
        .then(storm => {
          if (!storm.tasks.length) {
            return res.json({ status: "NO_TASKS", game: gameData, storm });
          }

          const active = storm.tasks.find(item => Number(item.id) === Number(storm.active_task_id)) || null;

          if (!storm.has_open_or_future_tasks) {
            return getGamePage(gameData.game_id, "FINISH", (pageError, page) => {
              if (pageError) {
                return res.status(500).json({ error: "Помилка завантаження фінальної сторінки" });
              }

              return res.json({ status: "FINISHED", game: gameData, page, storm });
            });
          }

          if (!active || !active.task) {
            return res.json({ status: "READY", game: gameData, task: {}, content: [], hints: [], answers: [], found_answers: [], olympiad: null, multitask: null, storm });
          }

          return res.json({
            status: "READY",
            game: gameData,
            task: active.task,
            content: active.content || [],
            hints: active.hints || [],
            answers: active.answers || [],
            found_answers: active.found_answers || [],
            olympiad: active.olympiad || null,
            multitask: active.multitask || null,
            storm
          });
        })
        .catch(error => {
          console.error("Storm payload error:", error);
          res.status(500).json({ error: "Помилка завантаження STORM-гри" });
        });
      return;
    }

    getCurrentTask(gameData.team_id, gameData.game_id, (taskError, task) => {
      if (taskError) {
        return res.status(500).json({
          error: "Помилка завантаження завдання"
        });
      }

      if (!task) {
        return getGamePage(gameData.game_id, "FINISH", (pageError, page) => {
          if (pageError) {
            return res.status(500).json({ error: "Помилка завантаження фінальної сторінки" });
          }

          return res.json({
            status: "FINISHED",
            game: gameData,
            page
          });
        });
      }

      getTaskContent(task.id, (contentError, content) => {
        if (contentError) {
          return res.status(500).json({
            error: "Помилка завантаження контенту"
          });
        }

        getTaskHints(task.id, gameData.team_id, (hintsError, hints) => {
          if (hintsError) {
            return res.status(500).json({
              error: "Помилка завантаження підказок"
            });
          }

          getTaskAnswersForPlayer(task.id, (answersError, answers) => {
            if (answersError) {
              return res.status(500).json({
                error: "Помилка завантаження форматів відповідей"
              });
            }

            getFoundAnswersForTeamAndTask(
              gameData.team_id,
              task.id,
              (foundError, foundAnswers) => {
                if (foundError) {
                  return res.status(500).json({
                    error: "Помилка завантаження прийнятих кодів"
                  });
                }

                Promise.resolve(
                  Promise.all([
                    task.task_type === "OLYMPIAD" ? getOlympiadPayload(gameData.team_id, task.id) : Promise.resolve(null),
                    task.task_type === "MULTITASK" ? getMultitaskPayload(gameData.team_id, task.id) : Promise.resolve(null)
                  ])
                ).then(([olympiad, multitask]) => {
                  res.json({
                    status: "READY",
                    game: gameData,
                    task,
                    content: task.task_type === "MULTITASK" ? [] : content,
                    hints: task.task_type === "MULTITASK" ? [] : hints,
                    answers: task.hide_answers_block ? [] : answers,
                    found_answers: foundAnswers,
                    olympiad,
                    multitask
                  });
                }).catch(() => {
                  res.status(500).json({ error: "Помилка завантаження завдання" });
                });
              }
            );
          });
        });
      });
    });
  });
});

router.put("/:pin/team-name", (req, res) => {
  const pin = String(req.params.pin || "").trim().toUpperCase();
  const newName = String(req.body.name || "").trim();

  if (!newName) {
    return res.status(400).json({
      error: "Введіть назву команди"
    });
  }

  if (newName.length > 80) {
    return res.status(400).json({
      error: "Назва команди занадто довга"
    });
  }

  getGameDataByPin(pin, (error, gameData) => {
    if (error) {
      return res.status(500).json({
        error: "Помилка завантаження команди"
      });
    }

    if (!gameData) {
      return res.status(404).json({
        error: "Команду не знайдено"
      });
    }

    if (gameData.run_status === "ARCHIVED") {
      return res.status(403).json({
        error: "Цей запуск уже в архіві"
      });
    }

    db.all(
      `
      SELECT id, name
      FROM teams
      WHERE run_id = ?
        AND id != ?
      `,
      [gameData.run_id, gameData.team_id],
      (teamsError, teams) => {
        if (teamsError) {
          return res.status(500).json({
            error: "Помилка перевірки назви команди"
          });
        }

        const normalizedNewName = normalizeTeamName(newName);

        const existingTeam = teams.find(team =>
          normalizeTeamName(team.name) === normalizedNewName
        );

        if (existingTeam) {
          return res.status(400).json({
            error: "Команда з такою назвою вже зареєстрована в цьому запуску"
          });
        }

        db.run(
          `
          UPDATE teams
          SET name = ?
          WHERE id = ?
          `,
          [newName, gameData.team_id],
          updateError => {
            if (updateError) {
              return res.status(500).json({
                error: "Помилка оновлення назви команди"
              });
            }

            res.json({
              message: "Назву команди оновлено",
              team_name: newName
            });
          }
        );
      }
    );
  });
});

router.post("/:pin/answer", async (req, res) => {
  const pin = String(req.params.pin || "").trim().toUpperCase();
  const rawAnswer = String(req.body.answer || "").trim();

  if (!rawAnswer) {
    return res.status(400).json({
      error: "Введіть відповідь"
    });
  }

  try {
    const gameData = await dbGet(
      `
      SELECT
        teams.id AS team_id,
        teams.name AS team_name,
        teams.pin AS team_pin,
        teams.finished_at AS team_finished_at,
      teams.created_at AS team_created_at,

        game_runs.id AS run_id,
        game_runs.title AS run_title,
        game_runs.run_code,
        game_runs.status AS run_status,
        game_runs.started_at,
        game_runs.finished_at AS run_finished_at,

        games.id AS game_id,
        games.title AS game_title,
        games.game_type,
        games.winner_type
      FROM teams
      JOIN game_runs ON game_runs.id = teams.run_id
      JOIN games ON games.id = game_runs.game_id
      WHERE teams.pin = ?
      `,
      [pin]
    );

    if (!gameData) {
      return res.status(404).json({
        error: "Команду не знайдено"
      });
    }

    if (gameData.run_status === "ARCHIVED") {
      return res.status(403).json({
        error: "Цей запуск уже в архіві"
      });
    }

    if (gameData.team_finished_at) {
      return res.status(403).json({ error: "Гру вже завершено" });
    }

    if (String(gameData.game_type || "LINEAR").toUpperCase() === "STORM" && gameData.run_finished_at) {
      const finishDate = parseUtcDate(gameData.run_finished_at);
      if (finishDate && Date.now() >= finishDate.getTime()) {
        await dbRun(`UPDATE teams SET finished_at = CURRENT_TIMESTAMP WHERE id = ? AND finished_at IS NULL`, [gameData.team_id]);
        return res.status(403).json({ error: "Час гри завершено" });
      }
    }

    let stormPayloadForResponse = null;
    let task = null;

    if (String(gameData.game_type || "LINEAR").toUpperCase() === "STORM") {
      const stormSelection = await getStormPlayableTask(gameData, req.body.task_id);
      task = stormSelection ? stormSelection.task : null;
      stormPayloadForResponse = stormSelection ? stormSelection.storm : null;
    } else {
      task = await new Promise((resolve, reject) => {
        getCurrentTask(gameData.team_id, gameData.game_id, (error, currentTask) => {
          if (error) reject(error);
          else resolve(currentTask);
        });
      });
    }

    if (!task) {
      return res.status(404).json({
        error: String(gameData.game_type || "LINEAR").toUpperCase() === "STORM"
          ? "Це завдання вже недоступне або ще не відкрите"
          : "Команда вже завершила гру"
      });
    }

    const answers = await dbAll(
      `
      SELECT *
      FROM task_answers
      WHERE task_id = ?
      ORDER BY
        CASE answer_type
          WHEN 'MAIN' THEN 1
          WHEN 'BONUS' THEN 2
          WHEN 'PENALTY' THEN 3
          ELSE 4
        END,
        sort_order ASC,
        id ASC
      `,
      [task.id]
    );

    const submittedCodes = splitUserAnswers(rawAnswer);
    const results = [];
    const newlyFound = [];
    let hasNewMainAnswer = false;

    for (const submittedCode of submittedCodes) {
      const normalizedSubmitted = normalizeAnswer(submittedCode);

      const foundAnswer = answers.find(answer => {
        const correctAnswer = normalizeAnswer(answer.answer_text);
        return correctAnswer && correctAnswer === normalizedSubmitted;
      });

      await dbRun(
        `
        INSERT INTO team_answers (
          team_id,
          task_id,
          answer,
          is_correct
        )
        VALUES (?, ?, ?, ?)
        `,
        [
          gameData.team_id,
          task.id,
          submittedCode,
          foundAnswer ? 1 : 0
        ]
      );

      if (!foundAnswer) {
        results.push({
          code: submittedCode.toUpperCase(),
          status: "rejected",
          message: `Код ${submittedCode.toUpperCase()} не прийнято`
        });

        continue;
      }

      const existingFound = await dbGet(
        `
        SELECT id
        FROM team_found_answers
        WHERE team_id = ?
          AND task_answer_id = ?
        `,
        [
          gameData.team_id,
          foundAnswer.id
        ]
      );

      if (existingFound) {
        results.push({
          code: submittedCode.toUpperCase(),
          status: "repeated",
          message: `Код ${submittedCode.toUpperCase()} введено повторно`,
          found: {
            id: foundAnswer.id,
            answer_text: foundAnswer.answer_text,
            answer_type: foundAnswer.answer_type,
            description: foundAnswer.description,
            comment: foundAnswer.comment,
            sort_order: foundAnswer.sort_order,
            time_modifier_seconds: foundAnswer.time_modifier_seconds
          }
        });

        continue;
      }

      await dbRun(
        `
        INSERT INTO team_found_answers (
          team_id,
          task_answer_id
        )
        VALUES (?, ?)
        `,
        [
          gameData.team_id,
          foundAnswer.id
        ]
      );

      await recordPositiveOrNegativeCodeEvent({ gameData, task, answer: foundAnswer });

      if (foundAnswer.answer_type === "BONUS" && !isScoreModeValue(gameData.winner_type)) {
  await dbRun(
    `
    UPDATE team_tasks
    SET bonus_seconds = bonus_seconds + ?
    WHERE team_id = ?
      AND task_id = ?
    `,
    [
      foundAnswer.time_modifier_seconds || 0,
      gameData.team_id,
      task.id
    ]
  );

  await dbRun(
    `
    INSERT INTO team_time_adjustments (
      team_id,
      task_id,
      adjustment_type,
      seconds,
      comment
    )
    VALUES (?, ?, 'BONUS_CODE', ?, ?)
    `,
    [
      gameData.team_id,
      task.id,
      Math.abs(foundAnswer.time_modifier_seconds || 0),
      foundAnswer.comment ||
      foundAnswer.description ||
      foundAnswer.answer_text
    ]
  );
}

      if (foundAnswer.answer_type === "PENALTY" && !isScoreModeValue(gameData.winner_type)) {
  await dbRun(
    `
    UPDATE team_tasks
    SET penalty_seconds = penalty_seconds + ?
    WHERE team_id = ?
      AND task_id = ?
    `,
    [
      foundAnswer.time_modifier_seconds || 0,
      gameData.team_id,
      task.id
    ]
  );

  await dbRun(
    `
    INSERT INTO team_time_adjustments (
      team_id,
      task_id,
      adjustment_type,
      seconds,
      comment
    )
    VALUES (?, ?, 'PENALTY_CODE', ?, ?)
    `,
    [
      gameData.team_id,
      task.id,
      Math.abs(foundAnswer.time_modifier_seconds || 0),
      foundAnswer.comment ||
      foundAnswer.description ||
      foundAnswer.answer_text
    ]
  );
}

      if (foundAnswer.answer_type === "MAIN") {
        hasNewMainAnswer = true;
      }

      const foundPayload = {
        id: foundAnswer.id,
        answer_text: foundAnswer.answer_text,
        answer_type: foundAnswer.answer_type,
        description: foundAnswer.description,
        comment: foundAnswer.comment,
        sort_order: foundAnswer.sort_order,
        time_modifier_seconds: foundAnswer.time_modifier_seconds
      };

      newlyFound.push(foundPayload);

      results.push({
        code: submittedCode.toUpperCase(),
        status: "accepted",
        message: `Код ${submittedCode.toUpperCase()} прийнято`,
        found: foundPayload
      });
    }

    let completeResult = {
      completed: false,
      found_main: 0,
      required_main_answers: 0
    };

    let nextExists = false;

    if (hasNewMainAnswer) {
      if (task.task_type === "OLYMPIAD") {
        completeResult = await checkOlympiadCompletion(gameData.team_id, task);
      } else {
        completeResult = await new Promise((resolve, reject) => {
          completeTaskIfNeeded(gameData.team_id, task, (error, result) => {
            if (error) reject(error);
            else resolve(result);
          });
        });
      }

      if (completeResult.completed) {
        nextExists = await new Promise((resolve, reject) => {
          hasNextTask(gameData.team_id, gameData.game_id, (error, exists) => {
            if (error) reject(error);
            else resolve(exists);
          });
        });

        if (!nextExists) {
          await dbRun(
            `
            UPDATE teams
            SET finished_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND finished_at IS NULL
            `,
            [gameData.team_id]
          );
        }
      }
    }

    const acceptedCount = results.filter(item => item.status === "accepted").length;
    const repeatedCount = results.filter(item => item.status === "repeated").length;

    const olympiad = task.task_type === "OLYMPIAD"
      ? await getOlympiadPayload(gameData.team_id, task.id)
      : null;

    const multitask = task.task_type === "MULTITASK"
      ? await getMultitaskPayload(gameData.team_id, task.id)
      : null;

    const refreshedStorm = String(gameData.game_type || "LINEAR").toUpperCase() === "STORM"
      ? await buildStormPayload(gameData)
      : null;

    if (refreshedStorm && !refreshedStorm.has_open_or_future_tasks) {
      await dbRun(`UPDATE teams SET finished_at = CURRENT_TIMESTAMP WHERE id = ? AND finished_at IS NULL`, [gameData.team_id]);
    }

    return res.json({
      accepted: acceptedCount > 0 || repeatedCount > 0,
      repeated: acceptedCount === 0 && repeatedCount > 0,
      task_completed: completeResult.completed,
      has_next_task: nextExists,
      message: results.map(item => item.message).join(", "),
      results,
      found_items: newlyFound,
      found: newlyFound[0] || null,
      olympiad,
      multitask,
      storm: refreshedStorm,
      found_main: completeResult.found_main,
      required_main_answers: completeResult.required_main_answers
    });

  } catch (error) {
    return res.status(500).json({
      error: "Помилка перевірки відповіді"
    });
  }
});




router.post("/:pin/hint/:hintId/purchase", async (req, res) => {
  const pin = String(req.params.pin || "").trim().toUpperCase();
  const hintId = Number(req.params.hintId);

  if (!Number.isInteger(hintId) || hintId < 1) {
    return res.status(400).json({ error: "Невірна підказка" });
  }

  try {
    const gameData = await new Promise((resolve, reject) => {
      getGameDataByPin(pin, (error, data) => error ? reject(error) : resolve(data));
    });

    if (!gameData) return res.status(404).json({ error: "Команду не знайдено" });
    if (gameData.run_status === "ARCHIVED") return res.status(403).json({ error: "Цей запуск уже в архіві" });
    if (gameData.team_finished_at) return res.status(403).json({ error: "Гру вже завершено" });
    if (String(gameData.game_type || "LINEAR").toUpperCase() === "STORM" && gameData.run_finished_at) {
      const finishDate = parseUtcDate(gameData.run_finished_at);
      if (finishDate && Date.now() >= finishDate.getTime()) {
        await dbRun(`UPDATE teams SET finished_at = CURRENT_TIMESTAMP WHERE id = ? AND finished_at IS NULL`, [gameData.team_id]);
        return res.status(403).json({ error: "Час гри завершено" });
      }
    }

    let task = null;
    if (String(gameData.game_type || "LINEAR").toUpperCase() === "STORM") {
      const stormSelection = await getStormPlayableTask(gameData, req.body.task_id);
      task = stormSelection ? stormSelection.task : null;
    } else {
      task = await new Promise((resolve, reject) => {
        getCurrentTask(gameData.team_id, gameData.game_id, (error, currentTask) => error ? reject(error) : resolve(currentTask));
      });
    }

    if (!task) return res.status(404).json({ error: String(gameData.game_type || "LINEAR").toUpperCase() === "STORM" ? "Це завдання вже недоступне або ще не відкрите" : "Команда вже завершила гру" });

    const hint = await dbGet(`SELECT * FROM task_hints WHERE id = ? AND task_id = ?`, [hintId, task.id]);
    if (!hint) return res.status(404).json({ error: "Підказку не знайдено" });
    if (hint.hint_type !== "PAID") return res.status(400).json({ error: "Ця підказка не є платною" });

    const elapsedSeconds = (() => {
      if (!task.opened_at) return 0;
      const openedDate = parseUtcDate(task.opened_at);
      if (!openedDate || Number.isNaN(openedDate.getTime())) return 0;
      return Math.floor((Date.now() - openedDate.getTime()) / 1000);
    })();

    if (elapsedSeconds < (Number(hint.purchase_after_seconds) || 0)) {
      return res.status(403).json({ error: "Купівля підказки ще недоступна" });
    }

    const existing = await dbGet(
      `SELECT id FROM team_hint_purchases WHERE team_id = ? AND task_hint_id = ?`,
      [gameData.team_id, hint.id]
    );

    if (!existing) {
      await dbRun(`INSERT INTO team_hint_purchases (team_id, task_hint_id) VALUES (?, ?)`, [gameData.team_id, hint.id]);
      const value = Math.max(0, Number(hint.purchase_value) || 0);
      if (value > 0) {
        if (isScoreModeValue(gameData.winner_type)) {
          await addScoreEvent({
            teamId: gameData.team_id,
            taskId: task.id,
            eventType: "HINT_PURCHASE",
            points: -value,
            comment: `Купівля підказки №${hint.sort_order}`
          });
        } else {
          await dbRun(
            `INSERT INTO team_time_adjustments (team_id, task_id, adjustment_type, seconds, comment) VALUES (?, ?, 'MANUAL_PENALTY', ?, ?)`,
            [gameData.team_id, task.id, value, `Купівля підказки №${hint.sort_order}`]
          );
        }
      }
    }

    const hints = await new Promise((resolve, reject) => {
      getTaskHints(task.id, gameData.team_id, (error, rows) => error ? reject(error) : resolve(rows));
    });

    res.json({ message: "Підказку куплено", hints });
  } catch (error) {
    res.status(500).json({ error: "Помилка купівлі підказки" });
  }
});

router.post("/:pin/multitask/subtask/:subtaskId/hint/purchase", async (req, res) => {
  const pin = String(req.params.pin || "").trim().toUpperCase();
  const subtaskId = Number(req.params.subtaskId);

  if (!Number.isInteger(subtaskId) || subtaskId < 1) {
    return res.status(400).json({ error: "Невірний номер підзавдання" });
  }

  try {
    const gameData = await new Promise((resolve, reject) => {
      getGameDataByPin(pin, (error, data) => error ? reject(error) : resolve(data));
    });

    if (!gameData) return res.status(404).json({ error: "Команду не знайдено" });
    if (gameData.run_status === "ARCHIVED") return res.status(403).json({ error: "Цей запуск уже в архіві" });
    if (gameData.team_finished_at) return res.status(403).json({ error: "Гру вже завершено" });
    if (String(gameData.game_type || "LINEAR").toUpperCase() === "STORM" && gameData.run_finished_at) {
      const finishDate = parseUtcDate(gameData.run_finished_at);
      if (finishDate && Date.now() >= finishDate.getTime()) {
        await dbRun(`UPDATE teams SET finished_at = CURRENT_TIMESTAMP WHERE id = ? AND finished_at IS NULL`, [gameData.team_id]);
        return res.status(403).json({ error: "Час гри завершено" });
      }
    }

    let task = null;
    if (String(gameData.game_type || "LINEAR").toUpperCase() === "STORM") {
      const stormSelection = await getStormPlayableTask(gameData, req.body.task_id);
      task = stormSelection ? stormSelection.task : null;
    } else {
      task = await new Promise((resolve, reject) => {
        getCurrentTask(gameData.team_id, gameData.game_id, (error, currentTask) => error ? reject(error) : resolve(currentTask));
      });
    }

    if (!task) return res.status(404).json({ error: String(gameData.game_type || "LINEAR").toUpperCase() === "STORM" ? "Це завдання вже недоступне або ще не відкрите" : "Команда вже завершила гру" });
    if (task.task_type !== "MULTITASK") return res.status(400).json({ error: "Поточне завдання не є Multitask" });

    const subtask = await dbGet(
      `SELECT * FROM multitask_subtasks WHERE id = ? AND task_id = ?`,
      [subtaskId, task.id]
    );

    if (!subtask) return res.status(404).json({ error: "Підзавдання не знайдено" });
    if (subtask.hint_type !== "PAID") return res.status(400).json({ error: "Для цього підзавдання платна підказка не передбачена" });

    const elapsedSeconds = (() => {
      if (!task.opened_at) return 0;
      const openedDate = parseUtcDate(task.opened_at);
      if (!openedDate || Number.isNaN(openedDate.getTime())) return 0;
      return Math.floor((Date.now() - openedDate.getTime()) / 1000);
    })();

    if (elapsedSeconds < (Number(subtask.hint_purchase_after_seconds) || 0)) {
      return res.status(403).json({ error: "Купівля підказки ще недоступна" });
    }

    const existing = await dbGet(
      `SELECT id FROM team_multitask_hint_purchases WHERE team_id = ? AND multitask_subtask_id = ?`,
      [gameData.team_id, subtask.id]
    );

    if (!existing) {
      await dbRun(
        `INSERT INTO team_multitask_hint_purchases (team_id, multitask_subtask_id) VALUES (?, ?)`,
        [gameData.team_id, subtask.id]
      );

      const purchaseValue = Math.max(0, Number(subtask.hint_purchase_value || 0));
      if (purchaseValue > 0) {
        if (isScoreModeValue(gameData.winner_type)) {
          await addScoreEvent({
            teamId: gameData.team_id,
            taskId: task.id,
            eventType: "HINT_PURCHASE",
            points: -purchaseValue,
            comment: `Купівля підказки Multitask №${subtask.sort_order}`
          });
        } else {
          await dbRun(
            `UPDATE team_tasks SET penalty_seconds = penalty_seconds + ? WHERE team_id = ? AND task_id = ?`,
            [purchaseValue, gameData.team_id, task.id]
          );

          await dbRun(
            `INSERT INTO team_time_adjustments (team_id, task_id, adjustment_type, seconds, comment) VALUES (?, ?, 'MANUAL_PENALTY', ?, ?)`,
            [gameData.team_id, task.id, purchaseValue, `Купівля підказки Multitask №${subtask.sort_order}`]
          );
        }
      }
    }

    const multitask = await getMultitaskPayload(gameData.team_id, task.id);
    res.json({ message: "Підказку куплено", multitask });
  } catch (error) {
    res.status(500).json({ error: "Помилка купівлі підказки" });
  }
});

router.post("/:pin/olympiad/cell/:cellNumber/purchase", async (req, res) => {
  const pin = String(req.params.pin || "").trim().toUpperCase();
  const cellNumber = Number(req.params.cellNumber);

  if (!Number.isInteger(cellNumber) || cellNumber < 1) {
    return res.status(400).json({ error: "Невірний номер клітинки" });
  }

  try {
    const gameData = await new Promise((resolve, reject) => {
      getGameDataByPin(pin, (error, data) => error ? reject(error) : resolve(data));
    });

    if (!gameData) return res.status(404).json({ error: "Команду не знайдено" });
    if (gameData.run_status === "ARCHIVED") return res.status(403).json({ error: "Цей запуск уже в архіві" });
    if (gameData.team_finished_at) return res.status(403).json({ error: "Гру вже завершено" });

    let task = null;
    if (String(gameData.game_type || "LINEAR").toUpperCase() === "STORM") {
      const stormSelection = await getStormPlayableTask(gameData, req.body.task_id);
      task = stormSelection ? stormSelection.task : null;
    } else {
      task = await new Promise((resolve, reject) => {
        getCurrentTask(gameData.team_id, gameData.game_id, (error, currentTask) => error ? reject(error) : resolve(currentTask));
      });
    }

    if (!task) return res.status(404).json({ error: String(gameData.game_type || "LINEAR").toUpperCase() === "STORM" ? "Це завдання вже недоступне або ще не відкрите" : "Команда вже завершила гру" });
    if (task.task_type !== "OLYMPIAD") return res.status(400).json({ error: "Поточне завдання не є олімпійкою" });

    const settings = await dbGet(`SELECT * FROM olympiad_settings WHERE task_id = ?`, [task.id]);
    if (!settings) return res.status(400).json({ error: "Олімпійку не налаштовано" });

    const elapsedSeconds = (() => {
      if (!task.opened_at) return 0;
      const openedDate = parseUtcDate(task.opened_at);
      if (!openedDate || Number.isNaN(openedDate.getTime())) return 0;
      return Math.floor((Date.now() - openedDate.getTime()) / 1000);
    })();

    const purchaseAfter = Number(settings.purchase_available_after_seconds || 0);
    if (elapsedSeconds < purchaseAfter) {
      return res.status(403).json({ error: "Купівля кодів ще недоступна" });
    }

    const cell = await dbGet(
      `SELECT * FROM olympiad_cells WHERE task_id = ? AND cell_number = ?`,
      [task.id, cellNumber]
    );

    if (!cell || !cell.task_answer_id) {
      return res.status(404).json({ error: "Клітинку не знайдено" });
    }

    const existing = await dbGet(
      `SELECT id FROM team_found_answers WHERE team_id = ? AND task_answer_id = ?`,
      [gameData.team_id, cell.task_answer_id]
    );

    if (existing) {
      const olympiad = await getOlympiadPayload(gameData.team_id, task.id);
      return res.json({ accepted: true, repeated: true, message: "Цей код уже відкрито", olympiad });
    }

    await dbRun(
      `INSERT INTO team_answers (team_id, task_id, answer, is_correct) VALUES (?, ?, ?, 1)`,
      [gameData.team_id, task.id, `[куплено] ${cell.answer_text || `Клітинка ${cell.cell_number}`}`]
    );

    await dbRun(
      `INSERT INTO team_found_answers (team_id, task_answer_id) VALUES (?, ?)`,
      [gameData.team_id, cell.task_answer_id]
    );

    const purchaseValue = Math.max(0, Number(cell.purchase_value || 0));
    if (purchaseValue > 0) {
      if (isScoreModeValue(gameData.winner_type)) {
        await addScoreEvent({
          teamId: gameData.team_id,
          taskId: task.id,
          eventType: "OLYMPIAD_PURCHASE",
          points: -purchaseValue,
          comment: `Купівля коду олімпійки №${cell.cell_number}: ${cell.answer_text || ""}`
        });
      } else {
        await dbRun(
          `
          UPDATE team_tasks
          SET penalty_seconds = penalty_seconds + ?
          WHERE team_id = ? AND task_id = ?
          `,
          [purchaseValue, gameData.team_id, task.id]
        );

        await dbRun(
          `
          INSERT INTO team_time_adjustments (
            team_id, task_id, adjustment_type, seconds, comment
          )
          VALUES (?, ?, 'PENALTY_CODE', ?, ?)
          `,
          [
            gameData.team_id,
            task.id,
            purchaseValue,
            `Купівля коду олімпійки №${cell.cell_number}: ${cell.answer_text || ""}`
          ]
        );
      }
    }

    const completeResult = await checkOlympiadCompletion(gameData.team_id, task);
    let nextExists = false;

    if (completeResult.completed) {
      nextExists = await new Promise((resolve, reject) => {
        hasNextTask(gameData.team_id, gameData.game_id, (error, exists) => error ? reject(error) : resolve(exists));
      });

      if (!nextExists) {
        await dbRun(
          `UPDATE teams SET finished_at = CURRENT_TIMESTAMP WHERE id = ? AND finished_at IS NULL`,
          [gameData.team_id]
        );
      }
    }

    const olympiad = await getOlympiadPayload(gameData.team_id, task.id);

    return res.json({
      accepted: true,
      repeated: false,
      message: cell.answer_text ? `Код ${cell.answer_text} прийнято` : `Код клітинки №${cell.cell_number} прийнято`,
      task_completed: completeResult.completed,
      has_next_task: nextExists,
      olympiad,
      found_main: completeResult.found_main,
      required_main_answers: completeResult.required_main_answers
    });
  } catch (error) {
    console.error("Olympiad purchase error:", error);
    return res.status(500).json({ error: "Помилка купівлі коду" });
  }
});

router.post("/:pin/auto-transition", async (req, res) => {
  const pin = String(req.params.pin || "").trim().toUpperCase();

  try {
    const gameData = await dbGet(
      `
      SELECT
        teams.id AS team_id,
        teams.name AS team_name,
        teams.pin AS team_pin,
        teams.finished_at AS team_finished_at,
        teams.created_at AS team_created_at,
        game_runs.id AS run_id,
        game_runs.title AS run_title,
        game_runs.run_code,
        game_runs.status AS run_status,
        game_runs.started_at,
        game_runs.finished_at AS run_finished_at,
        games.id AS game_id,
        games.title AS game_title,
        games.game_type,
        games.winner_type
      FROM teams
      JOIN game_runs ON game_runs.id = teams.run_id
      JOIN games ON games.id = game_runs.game_id
      WHERE teams.pin = ?
      `,
      [pin]
    );

    if (!gameData) return res.status(404).json({ error: "Команду не знайдено" });
    if (gameData.run_status === "ARCHIVED") return res.status(403).json({ error: "Цей запуск уже в архіві" });
    if (gameData.team_finished_at) return res.status(409).json({ error: "Гру вже завершено" });

    const isStorm = String(gameData.game_type || "LINEAR").toUpperCase() === "STORM";
    let task = null;
    let stormSelection = null;

    if (isStorm) {
      stormSelection = await getStormPlayableTask(gameData, req.body?.task_id);
      task = stormSelection ? stormSelection.task : null;
    } else {
      task = await new Promise((resolve, reject) => {
        getCurrentTask(gameData.team_id, gameData.game_id, (error, currentTask) => error ? reject(error) : resolve(currentTask));
      });

      const requestedTaskId = Number(req.body?.task_id);
      if (requestedTaskId && task && requestedTaskId !== Number(task.id)) {
        return res.status(409).json({ error: "Автоперехід уже не актуальний" });
      }
    }

    if (!task) {
      return res.status(404).json({ error: isStorm ? "Завдання вже недоступне" : "Поточне завдання не знайдено" });
    }

    const autoTransitionSeconds = Number(task.auto_transition_minutes) || 0;
    if (autoTransitionSeconds <= 0) {
      return res.status(400).json({ error: "Для цього завдання автоперехід не передбачений" });
    }

    const timeRow = await dbGet(
      `
      SELECT datetime(opened_at, '+' || ? || ' seconds') AS completed_at
      FROM team_tasks
      WHERE team_id = ? AND task_id = ?
      `,
      [autoTransitionSeconds, gameData.team_id, task.id]
    );

    if (!timeRow || !timeRow.completed_at) {
      return res.status(500).json({ error: "Помилка розрахунку часу автопереходу" });
    }

    const completedAt = timeRow.completed_at;
    if (Date.now() < parseUtcDate(completedAt).getTime()) {
      return res.status(409).json({ error: "Автоперехід ще не настав" });
    }

    const autoPenalty = Number(task.auto_transition_penalty_seconds) || 0;
    const updateResult = await dbRun(
      `
      UPDATE team_tasks
      SET completed_at = ?, auto_transition = 1, penalty_seconds = ?
      WHERE team_id = ? AND task_id = ? AND completed_at IS NULL
      `,
      [completedAt, autoPenalty, gameData.team_id, task.id]
    );

    if (!updateResult.changes) {
      const refreshedStorm = isStorm ? await buildStormPayload(gameData) : null;
      return res.status(409).json({ error: "Завдання вже завершене", storm: refreshedStorm });
    }

    await addTaskCompletionScoreIfNeeded(gameData.team_id, task);

    if (autoPenalty > 0) {
      if (isScoreModeValue(gameData.winner_type)) {
        await addScoreEvent({
          teamId: gameData.team_id,
          taskId: task.id,
          eventType: "AUTO_TRANSITION",
          points: -autoPenalty,
          comment: "Штраф за блокування завдання"
        });
      } else {
        await dbRun(
          `
          INSERT INTO team_time_adjustments (team_id, task_id, adjustment_type, seconds, comment)
          VALUES (?, ?, 'AUTO_TRANSITION', ?, ?)
          `,
          [gameData.team_id, task.id, autoPenalty, "Штраф за автоперехід"]
        );
      }
    }

    if (isStorm) {
      const refreshedStorm = await buildStormPayload(gameData);
      if (!refreshedStorm.has_open_or_future_tasks) {
        await dbRun(`UPDATE teams SET finished_at = ? WHERE id = ? AND finished_at IS NULL`, [completedAt, gameData.team_id]);
      }
      return res.json({ transitioned: true, message: "Час вийшов. Завдання заблоковано.", storm: refreshedStorm });
    }

    const nextExists = await new Promise((resolve, reject) => {
      openNextTaskAt(gameData.team_id, gameData.game_id, task.sort_order, completedAt, (error, exists) => error ? reject(error) : resolve(exists));
    });

    if (!nextExists) {
      await dbRun(`UPDATE teams SET finished_at = ? WHERE id = ? AND finished_at IS NULL`, [completedAt, gameData.team_id]);
    }

    return res.json({
      transitioned: true,
      has_next_task: nextExists,
      message: nextExists ? "Час вийшов. Переходимо до наступного завдання." : "Час вийшов. Гру завершено."
    });
  } catch (error) {
    console.error("Auto transition error:", error);
    return res.status(500).json({ error: "Помилка автопереходу" });
  }
});

module.exports = router;