const express = require("express");
const db = require("../database");

function generateCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars.charAt(
      Math.floor(Math.random() * chars.length)
    );
  }

  return result;
}

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Потрібна авторизація"
    });
  }

  next();
}

function buildPublicStatisticsUrl(req, runCode) {
  return `${req.protocol}://${req.get("host")}/public-statistics.html?run=${runCode}`;
}

function dbRunAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(error) {
      if (error) reject(error);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

async function finalizeRunData(runId) {
  await dbRunAsync(`
    UPDATE teams
    SET finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
    WHERE run_id = ?
  `, [runId]);

  await dbRunAsync(`
    UPDATE team_tasks
    SET completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
        auto_transition = CASE WHEN completed_at IS NULL THEN 1 ELSE auto_transition END
    WHERE team_id IN (SELECT id FROM teams WHERE run_id = ?)
  `, [runId]);

  await dbRunAsync(`
    INSERT INTO team_tasks (team_id, task_id, opened_at, completed_at, auto_transition)
    SELECT
      teams.id,
      tasks.id,
      COALESCE(game_runs.started_at, teams.created_at, CURRENT_TIMESTAMP),
      CURRENT_TIMESTAMP,
      1
    FROM teams
    JOIN game_runs ON game_runs.id = teams.run_id
    JOIN tasks ON tasks.game_id = game_runs.game_id
    LEFT JOIN team_tasks
      ON team_tasks.team_id = teams.id
      AND team_tasks.task_id = tasks.id
    WHERE teams.run_id = ?
      AND team_tasks.id IS NULL
  `, [runId]);
}

async function syncRunStatuses() {
  await dbRunAsync(`
    UPDATE game_runs
    SET status = 'ACTIVE'
    WHERE status = 'DRAFT'
      AND started_at IS NOT NULL
      AND datetime(started_at) <= datetime('now')
  `);

  const expiredRuns = await new Promise((resolve, reject) => {
    db.all(`
      SELECT id
      FROM game_runs
      WHERE status = 'ACTIVE'
        AND finished_at IS NOT NULL
        AND datetime(finished_at) <= datetime('now')
    `, [], (error, rows) => error ? reject(error) : resolve(rows || []));
  });

  for (const run of expiredRuns) {
    await finalizeRunData(run.id);
  }

  await dbRunAsync(`
    UPDATE game_runs
    SET status = 'ARCHIVED',
        finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
    WHERE status = 'ACTIVE'
      AND finished_at IS NOT NULL
      AND datetime(finished_at) <= datetime('now')
  `);
}

function syncStatusesMiddleware(req, res, next) {
  syncRunStatuses()
    .then(() => next())
    .catch(() => next());
}



router.get("/active", requireAuth, syncStatusesMiddleware, (req, res) => {
  db.all(
    `
    SELECT
      game_runs.id,
      game_runs.title,
      games.title AS game_title,
      game_runs.status,
      game_runs.started_at,
      game_runs.finished_at
    FROM game_runs
    JOIN games ON games.id = game_runs.game_id
    WHERE game_runs.status IN ('DRAFT', 'ACTIVE')
    ORDER BY game_runs.started_at DESC
    `,
    [],
    (error, runs) => {
      if (error) {
        return res.status(500).json({
          error: "Помилка отримання актуальних запусків"
        });
      }

      res.json({ runs });
    }
  );
});

router.post("/", requireAuth, (req, res) => {
  const {
    game_id,
    title,
    started_at
  } = req.body;

  if (!game_id) {
    return res.status(400).json({
      error: "Оберіть гру"
    });
  }

  if (!title || !title.trim()) {
    return res.status(400).json({
      error: "Вкажіть назву запуску"
    });
  }

  db.get(
    `
    SELECT id, status
    FROM games
    WHERE id = ?
    `,
    [game_id],
    (gameError, game) => {
      if (gameError) {
        return res.status(500).json({
          error: "Помилка перевірки гри"
        });
      }

      if (!game) {
        return res.status(404).json({
          error: "Гру не знайдено"
        });
      }

      if (game.status !== "READY") {
        return res.status(400).json({
          error: "Запуск можна створити лише для гри зі статусом READY"
        });
      }

      const runCode = generateCode();

      db.run(
        `
        INSERT INTO game_runs (
          game_id,
          title,
          run_code,
          status,
          created_by,
          started_at
        )
        VALUES (?, ?, ?, 'DRAFT', ?, ?)
        `,
        [
          game_id,
          title.trim(),
          runCode,
          req.session.user.id,
          started_at || null
        ],
        function(error) {
          if (error) {
            return res.status(500).json({
              error: "Помилка створення запуску"
            });
          }

          res.json({
            message: "Запуск створено",
            runId: this.lastID
          });
        }
      );
    }
  );
});

router.get("/game/:gameId", requireAuth, syncStatusesMiddleware, (req, res) => {
  const gameId = req.params.gameId;

  db.all(
    `
    SELECT
      id,
      title,
      status,
      started_at,
      finished_at
    FROM game_runs
    WHERE game_id = ?
      AND status != 'ARCHIVED'
    ORDER BY
      CASE
        WHEN status = 'ACTIVE' THEN 1
        WHEN status = 'DRAFT' THEN 2
        ELSE 3
      END,
      started_at ASC
    `,
    [gameId],
    (error, runs) => {
      if (error) {
        return res.status(500).json({
          error: "Помилка отримання запусків"
        });
      }

      res.json({ runs });
    }
  );
});

router.post("/game/:gameId", requireAuth, (req, res) => {
  const gameId = req.params.gameId;

  const {
    title,
    started_at
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      error: "Вкажіть назву запуску"
    });
  }

  const runCode = generateCode();

  db.run(
    `
    INSERT INTO game_runs (
      game_id,
      title,
      run_code,
      status,
      created_by,
      started_at
    )
    VALUES (
      ?,
      ?,
      ?,
      'DRAFT',
      ?,
      ?
    )
    `,
    [
      gameId,
      title.trim(),
      runCode,
      req.session.user.id,
      started_at || null
    ],
    function(error) {
      if (error) {
        return res.status(500).json({
          error: "Помилка створення запуску"
        });
      }

      res.json({
        message: "Запуск створено",
        runId: this.lastID
      });
    }
  );
});

router.get("/archive/game/:gameId", requireAuth, syncStatusesMiddleware, (req, res) => {
  const gameId = req.params.gameId;

  db.all(
    `
    SELECT
      id,
      title,
      status,
      started_at,
      finished_at
    FROM game_runs
    WHERE game_id = ?
      AND status = 'ARCHIVED'
    ORDER BY started_at DESC
    `,
    [gameId],
    (error, runs) => {
      if (error) {
        return res.status(500).json({
          error: "Помилка отримання архіву"
        });
      }

      res.json({ runs });
    }
  );
});


router.get("/archive", requireAuth, syncStatusesMiddleware, (req, res) => {
  db.all(
    `
    SELECT
      game_runs.id,
      game_runs.title,
      games.title AS game_title,
      game_runs.status,
      game_runs.started_at,
      game_runs.finished_at
    FROM game_runs
    JOIN games ON games.id = game_runs.game_id
    WHERE game_runs.status = 'ARCHIVED'
    ORDER BY game_runs.started_at DESC
    `,
    [],
    (error, runs) => {
      if (error) {
        return res.status(500).json({
          error: "Помилка отримання архіву всіх запусків"
        });
      }

      res.json({ runs });
    }
  );
});

router.get("/:id", requireAuth, syncStatusesMiddleware, (req, res) => {
  const runId = req.params.id;

  db.get(
    `
    SELECT
      game_runs.id,
      game_runs.game_id,
      game_runs.title,
      game_runs.run_code,
      game_runs.status,
      game_runs.started_at,
      game_runs.finished_at,
      COUNT(teams.id) AS teams_count
    FROM game_runs
    LEFT JOIN teams ON teams.run_id = game_runs.id
    WHERE game_runs.id = ?
    GROUP BY game_runs.id
    `,
    [runId],
    (error, run) => {
      if (error) {
        return res.status(500).json({
          error: "Помилка отримання запуску"
        });
      }

      if (!run) {
        return res.status(404).json({
          error: "Запуск не знайдено"
        });
      }

      res.json({ run });
    }
  );
});

router.get("/:id/teams", requireAuth, (req, res) => {
  const runId = req.params.id;

  db.all(
    `
    SELECT
      id,
      name,
      pin,
      created_at,
      finished_at
    FROM teams
    WHERE run_id = ?
    ORDER BY LOWER(name) ASC
    `,
    [runId],
    (error, teams) => {
      if (error) {
        return res.status(500).json({
          error: "Помилка отримання команд"
        });
      }

      res.json({ teams });
    }
  );
});

router.post("/:id/publish", requireAuth, (req, res) => {
  const runId = req.params.id;

  db.get(
    `
    SELECT
      id,
      title,
      run_code,
      status,
      started_at,
      finished_at
    FROM game_runs
    WHERE id = ?
    `,
    [runId],
    (selectError, run) => {
      if (selectError) {
        return res.status(500).json({
          error: "Помилка отримання запуску"
        });
      }

      if (!run) {
        return res.status(404).json({
          error: "Запуск не знайдено"
        });
      }

      db.run(
        `
        UPDATE game_runs
        SET
          status = 'ARCHIVED',
          finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
        WHERE id = ?
        `,
        [runId],
        updateError => {
          if (updateError) {
            return res.status(500).json({
              error: "Помилка публікації статистики"
            });
          }

          finalizeRunData(runId).catch(() => {});

          const publicStatisticsUrl =
            buildPublicStatisticsUrl(req, run.run_code);

          res.json({
            message: "Гру завершено і статистику опубліковано",
            run: {
              ...run,
              status: "ARCHIVED"
            },
            public_statistics_url: publicStatisticsUrl
          });
        }
      );
    }
  );
});

router.delete("/:runId/teams/:teamId", requireAuth, (req, res) => {
  const runId = req.params.runId;
  const teamId = req.params.teamId;

  db.get(
    `
    SELECT id, name
    FROM teams
    WHERE id = ?
      AND run_id = ?
    `,
    [teamId, runId],
    (teamError, team) => {
      if (teamError) {
        return res.status(500).json({
          error: "Помилка пошуку команди"
        });
      }

      if (!team) {
        return res.status(404).json({
          error: "Команду не знайдено"
        });
      }

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        db.run(
          `
          DELETE FROM team_answers
          WHERE team_id = ?
          `,
          [teamId]
        );

        db.run(
          `
          DELETE FROM team_found_answers
          WHERE team_id = ?
          `,
          [teamId]
        );

        db.run(
          `
          DELETE FROM team_time_adjustments
          WHERE team_id = ?
          `,
          [teamId]
        );

        db.run(
          `
          DELETE FROM team_tasks
          WHERE team_id = ?
          `,
          [teamId]
        );

        db.run(
          `
          DELETE FROM messages
          WHERE team_id = ?
             OR sender_team_id = ?
          `,
          [teamId, teamId]
        );

        db.run(
          `
          DELETE FROM teams
          WHERE id = ?
            AND run_id = ?
          `,
          [teamId, runId],
          function(deleteError) {
            if (deleteError) {
              db.run("ROLLBACK");

              return res.status(500).json({
                error: "Помилка видалення команди"
              });
            }

            db.run("COMMIT");

            res.json({
              message: `Команду "${team.name}" видалено`
            });
          }
        );
      });
    }
  );
});

router.delete("/:id", requireAuth, (req, res) => {
  const runId = req.params.id;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.all(`SELECT id FROM teams WHERE run_id = ?`, [runId], (teamError, teams) => {
      if (teamError) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: "Помилка видалення запуску" });
      }

      const teamIds = (teams || []).map(team => Number(team.id)).filter(Boolean);
      const placeholders = teamIds.map(() => "?").join(",");

      const afterTeamDataDeleted = () => {
        db.run(`DELETE FROM messages WHERE run_id = ?`, [runId]);
        db.run(`DELETE FROM run_pages WHERE run_id = ?`, [runId]);
        db.run(`DELETE FROM run_moderators WHERE run_id = ?`, [runId]);
        db.run(`DELETE FROM teams WHERE run_id = ?`, [runId]);
        db.run(`DELETE FROM game_runs WHERE id = ?`, [runId], function(error) {
          if (error) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: "Помилка видалення запуску" });
          }
          db.run("COMMIT");
          res.json({ message: "Запуск видалено" });
        });
      };

      if (!teamIds.length) {
        afterTeamDataDeleted();
        return;
      }

      db.run(`DELETE FROM team_answers WHERE team_id IN (${placeholders})`, teamIds);
      db.run(`DELETE FROM team_found_answers WHERE team_id IN (${placeholders})`, teamIds);
      db.run(`DELETE FROM team_time_adjustments WHERE team_id IN (${placeholders})`, teamIds);
      db.run(`DELETE FROM team_tasks WHERE team_id IN (${placeholders})`, teamIds);
      db.run(`DELETE FROM team_hint_purchases WHERE team_id IN (${placeholders})`, teamIds);
      db.run(`DELETE FROM team_multitask_hint_purchases WHERE team_id IN (${placeholders})`, teamIds);
      db.run(`DELETE FROM team_score_events WHERE team_id IN (${placeholders})`, teamIds);
      db.run(`DELETE FROM messages WHERE team_id IN (${placeholders}) OR sender_team_id IN (${placeholders})`, [...teamIds, ...teamIds]);
      afterTeamDataDeleted();
    });
  });
});

router.put("/:id", requireAuth, syncStatusesMiddleware, (req, res) => {
  const runId = req.params.id;

  const { title, status, started_at, finished_at } = req.body;
  const nextStatus = String(status || "DRAFT").toUpperCase();

  if (!["DRAFT", "ACTIVE", "ARCHIVED"].includes(nextStatus)) {
    return res.status(400).json({ error: "Некоректний статус запуску" });
  }

  db.get(`SELECT status FROM game_runs WHERE id = ?`, [runId], (selectError, existingRun) => {
    if (selectError) {
      return res.status(500).json({ error: "Помилка оновлення запуску" });
    }
    if (!existingRun) {
      return res.status(404).json({ error: "Запуск не знайдено" });
    }
    if (existingRun.status === "ARCHIVED" && nextStatus !== "ARCHIVED") {
      return res.status(400).json({ error: "Архівний запуск не можна повернути в активний стан" });
    }

    const normalizedFinishedAt = nextStatus === "ARCHIVED"
      ? (finished_at || new Date().toISOString().slice(0, 19).replace("T", " "))
      : (finished_at || null);

    db.run(
      `
      UPDATE game_runs
      SET
        title = ?,
        status = ?,
        started_at = ?,
        finished_at = ?
      WHERE id = ?
      `,
      [title, nextStatus, started_at || null, normalizedFinishedAt, runId],
      function(error) {
        if (error) {
          return res.status(500).json({ error: "Помилка оновлення запуску" });
        }

        if (nextStatus === "ARCHIVED") {
          finalizeRunData(runId).catch(() => {});
        }

        res.json({ message: "Запуск оновлено" });
      }
    );
  });
});

module.exports = router;
