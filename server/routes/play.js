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

function getGameDataByPin(pin, callback) {
  db.get(
    `
    SELECT
      teams.id AS team_id,
      teams.name AS team_name,
      teams.pin AS team_pin,
      teams.finished_at AS team_finished_at,

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
      team_tasks.completed_at
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

function getTaskHints(taskId, callback) {
  db.all(
    `
    SELECT *
    FROM task_hints
    WHERE task_id = ?
    ORDER BY sort_order ASC, id ASC
    `,
    [taskId],
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
      }
    );
  }
);
        }
      );
    }
  );
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
      return res.json({
        status: "ARCHIVED",
        game: gameData
      });
    }

    if (gameData.started_at && gameData.run_status !== "ACTIVE") {
      const startDate = new Date(String(gameData.started_at).replace(" ", "T"));
      const now = new Date();

      if (!Number.isNaN(startDate.getTime()) && now < startDate) {
        return res.json({
          status: "WAITING",
          game: gameData
        });
      }
    }

    getCurrentTask(gameData.team_id, gameData.game_id, (taskError, task) => {
      if (taskError) {
        return res.status(500).json({
          error: "Помилка завантаження завдання"
        });
      }

      if (!task) {
        return res.json({
          status: "FINISHED",
          game: gameData
        });
      }

      getTaskContent(task.id, (contentError, content) => {
        if (contentError) {
          return res.status(500).json({
            error: "Помилка завантаження контенту"
          });
        }

        getTaskHints(task.id, (hintsError, hints) => {
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

                res.json({
                  status: "READY",
                  game: gameData,
                  task,
                  content,
                  hints,
                  answers,
                  found_answers: foundAnswers
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

    const task = await new Promise((resolve, reject) => {
      getCurrentTask(gameData.team_id, gameData.game_id, (error, currentTask) => {
        if (error) reject(error);
        else resolve(currentTask);
      });
    });

    if (!task) {
      return res.status(404).json({
        error: "Команда вже завершила гру"
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

      if (foundAnswer.answer_type === "BONUS") {
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

      if (foundAnswer.answer_type === "PENALTY") {
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
      completeResult = await new Promise((resolve, reject) => {
        completeTaskIfNeeded(gameData.team_id, task, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        });
      });

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

    return res.json({
      accepted: acceptedCount > 0 || repeatedCount > 0,
      repeated: acceptedCount === 0 && repeatedCount > 0,
      task_completed: completeResult.completed,
      has_next_task: nextExists,
      message: results.map(item => item.message).join(", "),
      results,
      found_items: newlyFound,
      found: newlyFound[0] || null,
      found_main: completeResult.found_main,
      required_main_answers: completeResult.required_main_answers
    });

  } catch (error) {
    return res.status(500).json({
      error: "Помилка перевірки відповіді"
    });
  }
});

router.post("/:pin/auto-transition", (req, res) => {
  const pin = String(req.params.pin || "").trim().toUpperCase();

  getGameDataByPin(pin, (error, gameData) => {
    if (error) {
      return res.status(500).json({ error: "Помилка завантаження гри" });
    }

    if (!gameData) {
      return res.status(404).json({ error: "Команду не знайдено" });
    }

    getCurrentTask(gameData.team_id, gameData.game_id, (taskError, task) => {
      if (taskError) {
        return res.status(500).json({ error: "Помилка завантаження завдання" });
      }

      if (!task) {
        return res.json({
          transitioned: false,
          message: "Поточне завдання не знайдено"
        });
      }

      const requestedTaskId = Number(req.body?.task_id);
      const currentTaskId = Number(task.id);

      if (
        requestedTaskId &&
        requestedTaskId !== currentTaskId
      ) {
        return res.status(409).json({
          error: "Автоперехід уже не актуальний"
        });
      }

      const autoTransitionSeconds =
        Number(task.auto_transition_minutes) || 0;

      if (autoTransitionSeconds <= 0) {
        return res.status(400).json({
          error: "Для цього завдання автоперехід не передбачений"
        });
      }

      db.get(
        `
        SELECT
          datetime(opened_at, '+' || ? || ' seconds') AS completed_at
        FROM team_tasks
        WHERE team_id = ?
          AND task_id = ?
        `,
        [
          autoTransitionSeconds,
          gameData.team_id,
          task.id
        ],
        (timeError, timeRow) => {
          if (timeError || !timeRow || !timeRow.completed_at) {
            return res.status(500).json({
              error: "Помилка розрахунку часу автопереходу"
            });
          }

          const completedAt = timeRow.completed_at;
          const autoPenalty =
            Number(task.auto_transition_penalty_seconds) || 0;

          db.run(
            `
            UPDATE team_tasks
            SET
              completed_at = ?,
              auto_transition = 1,
              penalty_seconds = ?
            WHERE team_id = ?
              AND task_id = ?
              AND completed_at IS NULL
            `,
            [
              completedAt,
              autoPenalty,
              gameData.team_id,
              task.id
            ],
            function(updateError) {
              if (updateError) {
                return res.status(500).json({
                  error: "Помилка автопереходу"
                });
              }

              if (this.changes === 0) {
                return res.status(409).json({
                  error: "Завдання вже завершене"
                });
              }

              const continueAfterAdjustment = () => {
                openNextTaskAt(
                  gameData.team_id,
                  gameData.game_id,
                  task.sort_order,
                  completedAt,
                  (nextTaskError, nextExists) => {
                    if (nextTaskError) {
                      return res.status(500).json({
                        error: "Помилка відкриття наступного завдання"
                      });
                    }

                    if (!nextExists) {
                      db.run(
                        `
                        UPDATE teams
                        SET finished_at = ?
                        WHERE id = ?
                          AND finished_at IS NULL
                        `,
                        [
                          completedAt,
                          gameData.team_id
                        ]
                      );
                    }

                    res.json({
                      transitioned: true,
                      has_next_task: nextExists,
                      message: nextExists
                        ? "Час вийшов. Переходимо до наступного завдання."
                        : "Час вийшов. Гру завершено."
                    });
                  }
                );
              };

              if (autoPenalty > 0) {
                db.run(
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
                    gameData.team_id,
                    task.id,
                    autoPenalty,
                    "Штраф за автоперехід"
                  ],
                  adjustmentError => {
                    if (adjustmentError) {
                      return res.status(500).json({
                        error: "Помилка збереження штрафу автопереходу"
                      });
                    }

                    continueAfterAdjustment();
                  }
                );
              } else {
                continueAfterAdjustment();
              }
            }
          );
        }
      );
    });
  });
});

module.exports = router;