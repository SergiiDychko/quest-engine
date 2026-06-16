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

router.get("/game/:gameId", requireAuth, (req, res) => {
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

router.get("/archive/game/:gameId", requireAuth, (req, res) => {
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


router.get("/archive", requireAuth, (req, res) => {
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

router.get("/:id", requireAuth, (req, res) => {
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

  db.run(
    `DELETE FROM game_runs WHERE id = ?`,
    [runId],
    function(error) {
      if (error) {
        return res.status(500).json({
          error: "Помилка видалення запуску"
        });
      }

      res.json({
        message: "Запуск видалено"
      });
    }
  );
});

router.put("/:id", requireAuth, (req, res) => {
  const runId = req.params.id;

  const {
    title,
    status,
    started_at,
    finished_at
  } = req.body;

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
    [
      title,
      status,
      started_at,
      finished_at,
      runId
    ],
    function(error) {
      if (error) {
        return res.status(500).json({
          error: "Помилка оновлення запуску"
        });
      }

      res.json({
        message: "Запуск оновлено"
      });
    }
  );
});

module.exports = router;
