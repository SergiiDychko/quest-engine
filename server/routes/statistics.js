const express = require("express");
const db = require("../database");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Потрібна авторизація"
    });
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
      if (error) {
        reject(error);
      } else {
        resolve({
          lastID: this.lastID,
          changes: this.changes
        });
      }
    });
  });
}

function toDate(value) {
  if (!value) {
    return null;
  }

  return new Date(String(value).replace(" ", "T") + "Z");
}

function formatTime(value) {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return date.toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDateTime(value) {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return date.toLocaleString("uk-UA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getSecondsBetween(startValue, endValue) {
  const start = toDate(startValue);
  const end = toDate(endValue);

  if (!start || !end) {
    return null;
  }

  return Math.max(
    0,
    Math.floor((end.getTime() - start.getTime()) / 1000)
  );
}

function buildTaskCell(task) {
  if (!task.opened_at) {
    return {
      status: "not_started",
      duration_seconds: null,
      start_time: "-",
      finish_time: "-",
      lines: ["-"]
    };
  }

  if (!task.completed_at) {
    return {
      status: "in_progress",
      duration_seconds: null,
      start_time: formatTime(task.opened_at),
      finish_time: "-",
      lines: [
        "в процесі",
        `(${formatTime(task.opened_at)} — -)`
      ]
    };
  }

  const durationSeconds =
    getSecondsBetween(task.opened_at, task.completed_at);

  return {
    status: "completed",
    duration_seconds: durationSeconds,
    start_time: formatTime(task.opened_at),
    finish_time: formatTime(task.completed_at),
    lines: [
      formatDuration(durationSeconds),
      `(${formatTime(task.opened_at)} — ${formatTime(task.completed_at)})`
    ]
  };
}

function sumCompletedTaskSeconds(tasks) {
  return tasks.reduce((sum, task) => {
    if (!task.cell || task.cell.duration_seconds === null) {
      return sum;
    }

    return sum + task.cell.duration_seconds;
  }, 0);
}

function firstOpenedAt(tasks) {
  const task = tasks.find(item => item.opened_at);
  return task ? task.opened_at : null;
}

function lastCompletedAt(tasks) {
  const completed = tasks
    .filter(item => item.completed_at)
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));

  if (!completed.length) {
    return null;
  }

  return completed[completed.length - 1].completed_at;
}

function calculateBonusSeconds(adjustments) {
  return adjustments
    .filter(item =>
      item.adjustment_type === "BONUS_CODE" ||
      item.adjustment_type === "MANUAL_BONUS"
    )
    .reduce((sum, item) => {
      return sum + Math.abs(Number(item.seconds) || 0);
    }, 0);
}

function calculatePenaltySeconds(adjustments) {
  return adjustments
    .filter(item =>
      item.adjustment_type === "PENALTY_CODE" ||
      item.adjustment_type === "AUTO_TRANSITION" ||
      item.adjustment_type === "MANUAL_PENALTY"
    )
    .reduce((sum, item) => {
      return sum + Math.abs(Number(item.seconds) || 0);
    }, 0);
}


async function getCurrentTimestamp() {
  const row = await dbGet(`SELECT CURRENT_TIMESTAMP AS current_time`);
  return row.current_time;
}

async function getTasksForRun(runId) {
  return dbAll(
    `
    SELECT
      tasks.id,
      tasks.game_id,
      tasks.sort_order,
      tasks.title,
      tasks.auto_transition_minutes,
      tasks.auto_transition_penalty_seconds
    FROM tasks
    JOIN game_runs
      ON game_runs.game_id = tasks.game_id
    WHERE game_runs.id = ?
    ORDER BY tasks.sort_order ASC, tasks.id ASC
    `,
    [runId]
  );
}

function getAutoTransitionSeconds(task) {
  return Math.max(0, Number(task.auto_transition_minutes) || 0);
}

function getAutoTransitionPenaltySeconds(task) {
  return Math.max(0, Number(task.auto_transition_penalty_seconds) || 0);
}

async function addAutoTransitionAdjustments({
  teamId,
  task,
  actualSecondsOnTask,
  commentPrefix
}) {
  const autoTransitionSeconds = getAutoTransitionSeconds(task);
  const autoTransitionPenaltySeconds = getAutoTransitionPenaltySeconds(task);

  const remainingAutoTransitionSeconds =
    autoTransitionSeconds > 0
      ? Math.max(0, autoTransitionSeconds - actualSecondsOnTask)
      : 0;

  if (remainingAutoTransitionSeconds > 0) {
    await dbRun(
      `
      INSERT INTO team_time_adjustments (
        team_id,
        task_id,
        adjustment_type,
        seconds,
        comment
      )
      VALUES (?, ?, 'AUTO_TRANSITION', ?, ?)
      `,
      [
        teamId,
        task.id,
        remainingAutoTransitionSeconds,
        `${commentPrefix} завдання №${task.sort_order}`
      ]
    );
  }

  if (
    autoTransitionSeconds > 0 &&
    autoTransitionPenaltySeconds > 0
  ) {
    await dbRun(
      `
      INSERT INTO team_time_adjustments (
        team_id,
        task_id,
        adjustment_type,
        seconds,
        comment
      )
      VALUES (?, ?, 'AUTO_TRANSITION', ?, 'Штраф за автоперехід')
      `,
      [
        teamId,
        task.id,
        autoTransitionPenaltySeconds
      ]
    );
  }
}

async function completeOpenedTeamTask({
  teamId,
  task,
  completedAt,
  openedAt,
  commentPrefix
}) {
  const actualSecondsOnTask =
    getSecondsBetween(openedAt, completedAt) || 0;

  const updateResult = await dbRun(
    `
    UPDATE team_tasks
    SET
      completed_at = ?,
      auto_transition = ?
    WHERE team_id = ?
      AND task_id = ?
      AND completed_at IS NULL
    `,
    [
      completedAt,
      getAutoTransitionSeconds(task) > 0 ? 1 : 0,
      teamId,
      task.id
    ]
  );

  if (updateResult.changes === 0) {
    return false;
  }

  await addAutoTransitionAdjustments({
    teamId,
    task,
    actualSecondsOnTask,
    commentPrefix
  });

  return true;
}

async function createSkippedCompletedTeamTask({
  teamId,
  task,
  completedAt
}) {
  const existing = await dbGet(
    `
    SELECT id, completed_at
    FROM team_tasks
    WHERE team_id = ?
      AND task_id = ?
    `,
    [teamId, task.id]
  );

  if (existing && existing.completed_at) {
    return false;
  }

  if (existing) {
    await dbRun(
      `
      UPDATE team_tasks
      SET
        opened_at = COALESCE(opened_at, ?),
        completed_at = ?,
        auto_transition = ?
      WHERE id = ?
      `,
      [
        completedAt,
        completedAt,
        getAutoTransitionSeconds(task) > 0 ? 1 : 0,
        existing.id
      ]
    );
  } else {
    await dbRun(
      `
      INSERT INTO team_tasks (
        team_id,
        task_id,
        opened_at,
        completed_at,
        auto_transition
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        teamId,
        task.id,
        completedAt,
        completedAt,
        getAutoTransitionSeconds(task) > 0 ? 1 : 0
      ]
    );
  }

  await addAutoTransitionAdjustments({
    teamId,
    task,
    actualSecondsOnTask: 0,
    commentPrefix: "Коригування за групове пропускання"
  });

  return true;
}

async function openTargetTaskForTeam({
  teamId,
  targetTaskId,
  openedAt
}) {
  const existing = await dbGet(
    `
    SELECT id, opened_at, completed_at
    FROM team_tasks
    WHERE team_id = ?
      AND task_id = ?
    `,
    [teamId, targetTaskId]
  );

  if (existing && existing.completed_at) {
    return false;
  }

  if (existing) {
    await dbRun(
      `
      UPDATE team_tasks
      SET opened_at = COALESCE(opened_at, ?)
      WHERE id = ?
        AND completed_at IS NULL
      `,
      [openedAt, existing.id]
    );
  } else {
    await dbRun(
      `
      INSERT INTO team_tasks (
        team_id,
        task_id,
        opened_at
      )
      VALUES (?, ?, ?)
      `,
      [teamId, targetTaskId, openedAt]
    );
  }

  return true;
}

async function getRunById(runId) {
  return dbGet(
    `
    SELECT
      game_runs.id,
      game_runs.game_id,
      game_runs.title,
      game_runs.run_code,
      game_runs.status,
      game_runs.started_at,
      game_runs.finished_at,
      games.title AS game_title
    FROM game_runs
    JOIN games ON games.id = game_runs.game_id
    WHERE game_runs.id = ?
    `,
    [runId]
  );
}

async function getRunByCode(runCode) {
  return dbGet(
    `
    SELECT
      game_runs.id,
      game_runs.game_id,
      game_runs.title,
      game_runs.run_code,
      game_runs.status,
      game_runs.started_at,
      game_runs.finished_at,
      games.title AS game_title
    FROM game_runs
    JOIN games ON games.id = game_runs.game_id
    WHERE game_runs.run_code = ?
    `,
    [runCode]
  );
}

async function buildStatisticsForRun(run) {
  const teams = await dbAll(
    `
    SELECT
      id,
      name,
      created_at,
      finished_at
    FROM teams
    WHERE run_id = ?
    ORDER BY name COLLATE NOCASE
    `,
    [run.id]
  );

  for (const team of teams) {
    team.tasks = await dbAll(
      `
      SELECT
        tasks.id,
        tasks.title,
        tasks.sort_order,

        team_tasks.opened_at,
        team_tasks.completed_at,
        team_tasks.bonus_seconds,
        team_tasks.penalty_seconds,
        team_tasks.auto_transition

      FROM tasks

      LEFT JOIN team_tasks
        ON team_tasks.task_id = tasks.id
       AND team_tasks.team_id = ?

      WHERE tasks.game_id = ?

      ORDER BY tasks.sort_order
      `,
      [
        team.id,
        run.game_id
      ]
    );

    team.tasks = team.tasks.map(task => ({
      ...task,
      cell: buildTaskCell(task)
    }));

    team.adjustments = await dbAll(
      `
      SELECT
        team_time_adjustments.id,
        team_time_adjustments.team_id,
        team_time_adjustments.task_id,
        team_time_adjustments.adjustment_type,
        team_time_adjustments.seconds,
        team_time_adjustments.comment,
        team_time_adjustments.created_at,

        tasks.title AS task_title,
        tasks.sort_order AS task_sort_order

      FROM team_time_adjustments

      LEFT JOIN tasks
        ON tasks.id = team_time_adjustments.task_id

      WHERE team_time_adjustments.team_id = ?

      ORDER BY
        team_time_adjustments.created_at ASC,
        team_time_adjustments.id ASC
      `,
      [team.id]
    );

    team.total_bonus_seconds =
      calculateBonusSeconds(team.adjustments);

    team.total_penalty_seconds =
      calculatePenaltySeconds(team.adjustments);

    team.started_at = firstOpenedAt(team.tasks);
    team.calculated_finished_at = lastCompletedAt(team.tasks);

    const allTasksCompleted =
      team.tasks.length > 0 &&
      team.tasks.every(task => task.completed_at);

    team.statistics_finished_at =
      allTasksCompleted
        ? team.calculated_finished_at
        : null;

    team.full_time_seconds =
      allTasksCompleted
        ? sumCompletedTaskSeconds(team.tasks)
        : null;

    team.game_time_seconds =
      team.full_time_seconds === null
        ? null
        : Math.max(
            0,
            team.full_time_seconds
              - team.total_bonus_seconds
              + team.total_penalty_seconds
          );

    team.full_time_display =
      team.full_time_seconds === null
        ? "-"
        : formatDuration(team.full_time_seconds);

    team.game_time_display =
      team.game_time_seconds === null
        ? "-"
        : formatDuration(team.game_time_seconds);

    team.started_at_display = formatTime(team.started_at);
    team.finished_at_display = formatTime(team.statistics_finished_at);
  }

  return {
    run: {
      id: run.id,
      game_id: run.game_id,
      title: run.title,
      game_title: run.game_title,
      run_code: run.run_code,
      status: run.status,
      started_at: run.started_at,
      finished_at: run.finished_at,
      started_at_display: formatDateTime(run.started_at),
      finished_at_display: formatDateTime(run.finished_at)
    },
    teams
  };
}

router.get(
  "/run/:runId",
  requireAuth,
  async (req, res) => {
    const runId = req.params.runId;

    try {
      const run = await getRunById(runId);

      if (!run) {
        return res.status(404).json({
          error: "Запуск не знайдено"
        });
      }

      const statistics = await buildStatisticsForRun(run);

      res.json(statistics);

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Помилка отримання статистики"
      });
    }
  }
);

router.get(
  "/team/:teamId/task/:taskId",
  requireAuth,
  async (req, res) => {
    const teamId = req.params.teamId;
    const taskId = req.params.taskId;

    try {
      const team = await dbGet(
        `
        SELECT
          teams.id,
          teams.name,
          teams.pin,
          teams.run_id,
          teams.created_at,
          teams.finished_at,

          game_runs.title AS run_title,
          game_runs.status AS run_status,
          games.id AS game_id,
          games.title AS game_title
        FROM teams
        JOIN game_runs ON game_runs.id = teams.run_id
        JOIN games ON games.id = game_runs.game_id
        WHERE teams.id = ?
        `,
        [teamId]
      );

      if (!team) {
        return res.status(404).json({
          error: "Команду не знайдено"
        });
      }

      const task = await dbGet(
        `
        SELECT
          tasks.*,
          team_tasks.opened_at,
          team_tasks.completed_at,
          team_tasks.bonus_seconds,
          team_tasks.penalty_seconds,
          team_tasks.auto_transition
        FROM tasks
        LEFT JOIN team_tasks
          ON team_tasks.task_id = tasks.id
         AND team_tasks.team_id = ?
        WHERE tasks.id = ?
          AND tasks.game_id = ?
        `,
        [
          teamId,
          taskId,
          team.game_id
        ]
      );

      if (!task) {
        return res.status(404).json({
          error: "Завдання не знайдено"
        });
      }

      task.cell = buildTaskCell(task);

      const content = await dbAll(
        `
        SELECT *
        FROM task_content
        WHERE task_id = ?
        ORDER BY sort_order ASC, id ASC
        `,
        [taskId]
      );

      const hints = await dbAll(
        `
        SELECT *
        FROM task_hints
        WHERE task_id = ?
        ORDER BY sort_order ASC, id ASC
        `,
        [taskId]
      );

      const answers = await dbAll(
        `
        SELECT
          id,
          answer_text,
          answer_type,
          description,
          time_modifier_seconds,
          comment,
          sort_order
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
        [taskId]
      );

      const foundAnswers = await dbAll(
        `
        SELECT
          team_found_answers.id,
          team_found_answers.found_at,
          task_answers.id AS task_answer_id,
          task_answers.answer_text,
          task_answers.answer_type,
          task_answers.description,
          task_answers.time_modifier_seconds,
          task_answers.comment,
          task_answers.sort_order
        FROM team_found_answers
        JOIN task_answers
          ON task_answers.id = team_found_answers.task_answer_id
        WHERE team_found_answers.team_id = ?
          AND task_answers.task_id = ?
        ORDER BY team_found_answers.found_at ASC, team_found_answers.id ASC
        `,
        [
          teamId,
          taskId
        ]
      );

      const answerLog = await dbAll(
        `
        SELECT
          id,
          answer,
          is_correct,
          created_at
        FROM team_answers
        WHERE team_id = ?
          AND task_id = ?
        ORDER BY created_at ASC, id ASC
        `,
        [
          teamId,
          taskId
        ]
      );

      const adjustments = await dbAll(
        `
        SELECT
          team_time_adjustments.id,
          team_time_adjustments.adjustment_type,
          team_time_adjustments.seconds,
          team_time_adjustments.comment,
          team_time_adjustments.created_at
        FROM team_time_adjustments
        WHERE team_time_adjustments.team_id = ?
          AND team_time_adjustments.task_id = ?
        ORDER BY created_at ASC, id ASC
        `,
        [
          teamId,
          taskId
        ]
      );

      res.json({
        team,
        task,
        content,
        hints,
        answers,
        found_answers: foundAnswers,
        answer_log: answerLog,
        adjustments
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Помилка отримання деталей завдання"
      });
    }
  }
);

router.get(
  "/public/run/:runCode",
  async (req, res) => {
    const runCode = String(req.params.runCode || "").trim().toUpperCase();

    try {
      const run = await getRunByCode(runCode);

      if (!run) {
        return res.status(404).json({
          error: "Статистику не знайдено"
        });
      }

      if (run.status !== "ARCHIVED") {
        return res.status(403).json({
          error: "Публічна статистика ще не опублікована"
        });
      }

      const statistics = await buildStatisticsForRun(run);

      res.json(statistics);

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Помилка отримання публічної статистики"
      });
    }
  }
);

router.post(
  "/team/:teamId/bonus",
  requireAuth,
  async (req, res) => {
    const teamId = req.params.teamId;

    const seconds = Math.abs(
      Number(req.body.seconds) || 0
    );

    const comment =
      String(req.body.comment || "").trim();

    if (!seconds) {
      return res.status(400).json({
        error: "Вкажіть кількість секунд"
      });
    }

    try {
      await new Promise((resolve, reject) => {
        db.run(
          `
          INSERT INTO team_time_adjustments (
            team_id,
            task_id,
            adjustment_type,
            seconds,
            comment
          )
          VALUES (
            ?,
            NULL,
            'MANUAL_BONUS',
            ?,
            ?
          )
          `,
          [
            teamId,
            seconds,
            comment
          ],
          error => {
            if (error) reject(error);
            else resolve();
          }
        );
      });

      res.json({
        message: "Бонус додано"
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Помилка додавання бонусу"
      });
    }
  }
);

router.post(
  "/team/:teamId/penalty",
  requireAuth,
  async (req, res) => {
    const teamId = req.params.teamId;

    const seconds = Math.abs(
      Number(req.body.seconds) || 0
    );

    const comment =
      String(req.body.comment || "").trim();

    if (!seconds) {
      return res.status(400).json({
        error: "Вкажіть кількість секунд"
      });
    }

    try {
      await new Promise((resolve, reject) => {
        db.run(
          `
          INSERT INTO team_time_adjustments (
            team_id,
            task_id,
            adjustment_type,
            seconds,
            comment
          )
          VALUES (
            ?,
            NULL,
            'MANUAL_PENALTY',
            ?,
            ?
          )
          `,
          [
            teamId,
            seconds,
            comment
          ],
          error => {
            if (error) reject(error);
            else resolve();
          }
        );
      });

      res.json({
        message: "Штраф додано"
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Помилка додавання штрафу"
      });
    }
  }
);

router.delete(
  "/team/:teamId/adjustment/:adjustmentId",
  requireAuth,
  async (req, res) => {
    const teamId = req.params.teamId;
    const adjustmentId = req.params.adjustmentId;

    try {
      const adjustment = await dbGet(
        `
        SELECT
          id,
          team_id,
          adjustment_type
        FROM team_time_adjustments
        WHERE id = ?
          AND team_id = ?
        `,
        [adjustmentId, teamId]
      );

      if (!adjustment) {
        return res.status(404).json({
          error: "Коригування не знайдено"
        });
      }

      if (
        adjustment.adjustment_type !== "MANUAL_BONUS" &&
        adjustment.adjustment_type !== "MANUAL_PENALTY"
      ) {
        return res.status(403).json({
          error: "Можна видаляти тільки ручні бонуси або штрафи"
        });
      }

      await new Promise((resolve, reject) => {
        db.run(
          `
          DELETE FROM team_time_adjustments
          WHERE id = ?
            AND team_id = ?
          `,
          [adjustmentId, teamId],
          error => {
            if (error) reject(error);
            else resolve();
          }
        );
      });

      res.json({
        message: "Коригування видалено"
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Помилка видалення коригування"
      });
    }
  }
);



router.post(
  "/run/:runId/move-teams",
  requireAuth,
  async (req, res) => {
    const runId = req.params.runId;
    const teamIds = Array.isArray(req.body.teamIds)
      ? req.body.teamIds.map(Number).filter(Boolean)
      : [];
    const targetTaskId = Number(req.body.targetTaskId) || 0;

    if (!teamIds.length) {
      return res.status(400).json({
        error: "Оберіть хоча б одну команду"
      });
    }

    if (!targetTaskId) {
      return res.status(400).json({
        error: "Оберіть завдання, на яке потрібно перевести команди"
      });
    }

    try {
      const run = await getRunById(runId);

      if (!run) {
        return res.status(404).json({
          error: "Запуск не знайдено"
        });
      }

      if (run.status === "ARCHIVED") {
        return res.status(409).json({
          error: "Архівний запуск не можна змінювати"
        });
      }

      const tasks = await getTasksForRun(runId);
      const targetTask = tasks.find(
        task => Number(task.id) === Number(targetTaskId)
      );

      if (!targetTask) {
        return res.status(404).json({
          error: "Цільове завдання не знайдено у цьому запуску"
        });
      }

      const completedAt = await getCurrentTimestamp();
      const results = [];

      await dbRun("BEGIN TRANSACTION");

      try {
        for (const teamId of teamIds) {
          const team = await dbGet(
            `
            SELECT id, name, run_id, finished_at
            FROM teams
            WHERE id = ?
              AND run_id = ?
            `,
            [teamId, runId]
          );

          if (!team) {
            results.push({
              team_id: teamId,
              status: "skipped",
              reason: "Команду не знайдено у цьому запуску"
            });
            continue;
          }

          if (team.finished_at) {
            results.push({
              team_id: teamId,
              team_name: team.name,
              status: "skipped",
              reason: "Команда вже фінішувала"
            });
            continue;
          }

          const activeTeamTask = await dbGet(
            `
            SELECT
              team_tasks.task_id,
              team_tasks.opened_at,
              tasks.sort_order
            FROM team_tasks
            JOIN tasks ON tasks.id = team_tasks.task_id
            WHERE team_tasks.team_id = ?
              AND team_tasks.opened_at IS NOT NULL
              AND team_tasks.completed_at IS NULL
            ORDER BY team_tasks.opened_at DESC, tasks.sort_order DESC
            LIMIT 1
            `,
            [teamId]
          );

          if (!activeTeamTask) {
            await openTargetTaskForTeam({
              teamId,
              targetTaskId: targetTask.id,
              openedAt: completedAt
            });

            results.push({
              team_id: teamId,
              team_name: team.name,
              status: "moved",
              reason: "Команда не мала активного завдання, цільове завдання відкрито"
            });
            continue;
          }

          if (
            Number(activeTeamTask.task_id) === Number(targetTask.id)
          ) {
            results.push({
              team_id: teamId,
              team_name: team.name,
              status: "skipped",
              reason: "Команда вже на цьому завданні"
            });
            continue;
          }

          if (
            Number(activeTeamTask.sort_order) > Number(targetTask.sort_order)
          ) {
            results.push({
              team_id: teamId,
              team_name: team.name,
              status: "skipped",
              reason: "Команда вже далі за цільове завдання"
            });
            continue;
          }

          const currentTask = tasks.find(
            task => Number(task.id) === Number(activeTeamTask.task_id)
          );

          if (!currentTask) {
            results.push({
              team_id: teamId,
              team_name: team.name,
              status: "skipped",
              reason: "Поточне завдання не знайдено"
            });
            continue;
          }

          const currentCompleted = await completeOpenedTeamTask({
            teamId,
            task: currentTask,
            completedAt,
            openedAt: activeTeamTask.opened_at,
            commentPrefix: "Коригування за групове переведення"
          });

          if (!currentCompleted) {
            results.push({
              team_id: teamId,
              team_name: team.name,
              status: "skipped",
              reason: "Поточне завдання вже завершене"
            });
            continue;
          }

          const skippedTasks = tasks.filter(task =>
            Number(task.sort_order) > Number(currentTask.sort_order) &&
            Number(task.sort_order) < Number(targetTask.sort_order)
          );

          let skippedCount = 0;

          for (const skippedTask of skippedTasks) {
            const created = await createSkippedCompletedTeamTask({
              teamId,
              task: skippedTask,
              completedAt
            });

            if (created) {
              skippedCount += 1;
            }
          }

          await openTargetTaskForTeam({
            teamId,
            targetTaskId: targetTask.id,
            openedAt: completedAt
          });

          results.push({
            team_id: teamId,
            team_name: team.name,
            status: "moved",
            skipped_tasks_count: skippedCount,
            reason: `Команду переведено на завдання №${targetTask.sort_order}`
          });
        }

        await dbRun("COMMIT");
      } catch (transactionError) {
        await dbRun("ROLLBACK");
        throw transactionError;
      }

      res.json({
        message: "Групову дію виконано",
        target_task_id: targetTask.id,
        target_task_sort_order: targetTask.sort_order,
        results
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Помилка групового переведення команд"
      });
    }
  }
);

router.post(
  "/team/:teamId/task/:taskId/finish",
  requireAuth,
  async (req, res) => {
    const teamId = req.params.teamId;
    const taskId = req.params.taskId;

    try {
      const team = await dbGet(
        `
        SELECT
          id,
          run_id,
          finished_at
        FROM teams
        WHERE id = ?
        `,
        [teamId]
      );

      if (!team) {
        return res.status(404).json({
          error: "Команду не знайдено"
        });
      }

      if (team.finished_at) {
        return res.status(409).json({
          error: "Команда вже завершила гру. Оновіть статистику."
        });
      }

      const task = await dbGet(
        `
        SELECT
          tasks.id,
          tasks.game_id,
          tasks.sort_order,
          tasks.title,
          tasks.auto_transition_minutes,
          tasks.auto_transition_penalty_seconds
        FROM tasks
        JOIN game_runs
          ON game_runs.game_id = tasks.game_id
        WHERE tasks.id = ?
          AND game_runs.id = ?
        `,
        [
          taskId,
          team.run_id
        ]
      );

      if (!task) {
        return res.status(404).json({
          error: "Завдання не знайдено"
        });
      }

      const teamTask = await dbGet(
        `
        SELECT
          id,
          opened_at,
          completed_at
        FROM team_tasks
        WHERE team_id = ?
          AND task_id = ?
        `,
        [
          teamId,
          taskId
        ]
      );

      if (!teamTask || !teamTask.opened_at) {
        return res.status(409).json({
          error: "Команда ще не отримала це завдання. Оновіть статистику."
        });
      }

      if (teamTask.completed_at) {
        return res.status(409).json({
          error: "Завдання вже завершено. Оновіть статистику."
        });
      }

      const activeTask = await dbGet(
        `
        SELECT
          task_id
        FROM team_tasks
        WHERE team_id = ?
          AND opened_at IS NOT NULL
          AND completed_at IS NULL
        ORDER BY opened_at DESC
        LIMIT 1
        `,
        [teamId]
      );

      if (
        !activeTask ||
        Number(activeTask.task_id) !== Number(taskId)
      ) {
        return res.status(409).json({
          error: "Команда вже перейшла на інше завдання. Оновіть статистику."
        });
      }

      const nowRow = await dbGet(
        `SELECT CURRENT_TIMESTAMP AS current_time`
      );

      const completedAt = nowRow.current_time;

      const actualSecondsOnTask =
        getSecondsBetween(
          teamTask.opened_at,
          completedAt
        ) || 0;

      const autoTransitionSeconds =
        Math.max(
          0,
          Number(task.auto_transition_minutes) || 0
        );

      const autoTransitionPenaltySeconds =
        Math.max(
          0,
          Number(task.auto_transition_penalty_seconds) || 0
        );

      const remainingAutoTransitionSeconds =
        autoTransitionSeconds > 0
          ? Math.max(
              0,
              autoTransitionSeconds - actualSecondsOnTask
            )
          : 0;

      const nextTask = await dbGet(
        `
        SELECT
          id
        FROM tasks
        WHERE game_id = ?
          AND sort_order > ?
        ORDER BY sort_order ASC
        LIMIT 1
        `,
        [
          task.game_id,
          task.sort_order
        ]
      );

      await dbRun("BEGIN TRANSACTION");

      try {
        const updateResult = await dbRun(
          `
          UPDATE team_tasks
          SET
            completed_at = ?,
            auto_transition = ?
          WHERE team_id = ?
            AND task_id = ?
            AND completed_at IS NULL
          `,
          [
            completedAt,
            autoTransitionSeconds > 0 ? 1 : 0,
            teamId,
            taskId
          ]
        );

        if (updateResult.changes === 0) {
          await dbRun("ROLLBACK");

          return res.status(409).json({
            error: "Завдання вже завершено. Оновіть статистику."
          });
        }

        if (remainingAutoTransitionSeconds > 0) {
          await dbRun(
            `
            INSERT INTO team_time_adjustments (
              team_id,
              task_id,
              adjustment_type,
              seconds,
              comment
            )
            VALUES (
              ?,
              ?,
              'AUTO_TRANSITION',
              ?,
              ?
            )
            `,
            [
              teamId,
              taskId,
              remainingAutoTransitionSeconds,
              `Коригування за примусове завершення завдання №${task.sort_order}`
            ]
          );
        }

        if (
          autoTransitionSeconds > 0 &&
          autoTransitionPenaltySeconds > 0
        ) {
          await dbRun(
            `
            INSERT INTO team_time_adjustments (
              team_id,
              task_id,
              adjustment_type,
              seconds,
              comment
            )
            VALUES (
              ?,
              ?,
              'AUTO_TRANSITION',
              ?,
              'Штраф за автоперехід'
            )
            `,
            [
              teamId,
              taskId,
              autoTransitionPenaltySeconds
            ]
          );
        }

        if (nextTask) {
          await dbRun(
            `
            INSERT INTO team_tasks (
              team_id,
              task_id,
              opened_at
            )
            VALUES (
              ?,
              ?,
              ?
            )
            `,
            [
              teamId,
              nextTask.id,
              completedAt
            ]
          );

          await dbRun("COMMIT");

          return res.json({
            message: "Завдання завершено, наступне завдання відкрито",
            finished_game: false,
            next_task_id: nextTask.id
          });
        }

        await dbRun(
          `
          UPDATE teams
          SET finished_at = ?
          WHERE id = ?
            AND finished_at IS NULL
          `,
          [
            completedAt,
            teamId
          ]
        );

        await dbRun("COMMIT");

        res.json({
          message: "Завдання завершено, команда фінішувала",
          finished_game: true
        });

      } catch (transactionError) {
        await dbRun("ROLLBACK");
        throw transactionError;
      }

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Помилка примусового завершення завдання"
      });
    }
  }
);

module.exports = router;
