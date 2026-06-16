const express = require("express");
const db = require("../database");

const router = express.Router();

function generateCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  a = normalizeName(a);
  b = normalizeName(b);

  if (!a || !b) return 0;
  if (a === b) return 1;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  const longerLength = longer.length;
  if (longerLength === 0) return 1;

  return (longerLength - levenshtein(longer, shorter)) / longerLength;
}

function levenshtein(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
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

function isRunWaiting(run) {
  const startDate = parseUtcDate(run.started_at);
  return Boolean(startDate && new Date() < startDate);
}

function defaultPage(pageType) {
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

  if (pageType === "JOIN") {
    return {
      page_type: "JOIN",
      title: "Реєстрація команди",
      content: JSON.stringify({
        heading: "Реєстрація команди",
        description: "Введіть назву команди, щоб отримати посилання на гру.",
        button_text: "Створити команду"
      }),
      custom_css: ""
    };
  }

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
      callback(null, page || defaultPage(pageType));
    }
  );
}

router.get("/:runCode", (req, res) => {
  const runCode = req.params.runCode;

  db.get(
    `
    SELECT
      game_runs.id,
      game_runs.game_id,
      game_runs.title AS run_title,
      game_runs.run_code,
      game_runs.status,
      game_runs.started_at,
      games.title AS game_title
    FROM game_runs
    JOIN games ON games.id = game_runs.game_id
    WHERE game_runs.run_code = ?
    `,
    [runCode],
    (error, run) => {
      if (error) {
        return res.status(500).json({ error: "Помилка отримання запуску" });
      }

      if (!run) {
        return res.status(404).json({ error: "Запуск не знайдено" });
      }

      const pageType = isRunWaiting(run) ? "START" : "JOIN";

      getGamePage(run.game_id, pageType, (pageError, page) => {
        if (pageError) {
          return res.status(500).json({ error: "Помилка отримання сторінки гри" });
        }

        res.json({
          status: pageType === "START" ? "WAITING" : "READY",
          run,
          page
        });
      });
    }
  );
});

router.post("/:runCode", (req, res) => {
  const runCode = req.params.runCode;
  const { team_name } = req.body;

  const teamName = String(team_name || "").trim();

  if (!teamName) {
    return res.status(400).json({ error: "Введіть назву команди" });
  }

  db.get(
    `SELECT id, game_id, started_at FROM game_runs WHERE run_code = ?`,
    [runCode],
    (runError, run) => {
      if (runError) {
        return res.status(500).json({ error: "Помилка отримання запуску" });
      }

      if (!run) {
        return res.status(404).json({ error: "Запуск не знайдено" });
      }

      if (isRunWaiting(run)) {
        return res.status(403).json({ error: "Гра ще не почалась" });
      }

      db.all(
        `SELECT name FROM teams WHERE run_id = ?`,
        [run.id],
        (teamsError, teams) => {
          if (teamsError) {
            return res.status(500).json({ error: "Помилка перевірки команд" });
          }

          const similarTeam = teams.find(team => {
            return similarity(team.name, teamName) >= 0.85;
          });

          if (similarTeam) {
            return res.status(409).json({
              error:
                "Отакої! Команда з такою назвою уже зареєстрована на цю гру.\n" +
                "Можливо, це був хтось із ваших співкомандників? Запитайте, може у них уже є посилання на гру.\n" +
                "Якщо ні, то це суперники забрали собі таку назву прямо у вас перед носом :("
            });
          }

          const teamCode = generateCode();

          db.run(
            `
            INSERT INTO teams (
              run_id,
              name,
              pin
            )
            VALUES (?, ?, ?)
            `,
            [
              run.id,
              teamName,
              teamCode
            ],
            function (insertError) {
              if (insertError) {
                return res.status(500).json({ error: "Помилка створення команди" });
              }

              res.json({
                message: "Команду створено",
                team: {
                  id: this.lastID,
                  name: teamName,
                  code: teamCode
                }
              });
            }
          );
        }
      );
    }
  );
});

module.exports = router;
