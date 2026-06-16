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

router.get("/:runCode", (req, res) => {
  const runCode = req.params.runCode;

  db.get(
    `
    SELECT
      game_runs.id,
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

      res.json({ run });
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
    `SELECT id FROM game_runs WHERE run_code = ?`,
    [runCode],
    (runError, run) => {
      if (runError) {
        return res.status(500).json({ error: "Помилка отримання запуску" });
      }

      if (!run) {
        return res.status(404).json({ error: "Запуск не знайдено" });
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