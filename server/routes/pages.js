const express = require("express");
const db = require("../database");
const { getGameAccess, getRunAccess, requireCapability, handleAccessError } = require("../services/access");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Потрібна авторизація"
    });
  }

  next();
}

function isValidPageType(pageType) {
  return ["START", "JOIN", "FINISH"].includes(pageType);
}

function defaultPage(pageType) {
  const defaults = {
    START: {
      title: "Старт гри",
      content: "Вітаємо на грі!"
    },
    JOIN: {
      title: "Реєстрація команди",
      content: JSON.stringify({
        heading: "Реєстрація команди",
        description: "Введіть назву команди, щоб отримати посилання на гру.",
        button_text: "Створити команду"
      })
    },
    FINISH: {
      title: "Гру завершено",
      content: "Вітаємо! Ви завершили гру."
    }
  };

  return defaults[pageType];
}

router.get("/game/:gameId", requireAuth, async (req, res) => {
  const gameId = Number(req.params.gameId);

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canView");
  } catch (error) {
    return handleAccessError(res, error, "Гру не знайдено");
  }

  db.all(
    `
    SELECT
      page_type,
      title,
      content,
      custom_css
    FROM game_pages
    WHERE game_id = ?
    `,
    [gameId],
    (error, rows) => {
      if (error) {
        return res.status(500).json({
          error: "Помилка отримання сторінок гри"
        });
      }

      const pages = {};

      ["START", "JOIN", "FINISH"].forEach(pageType => {
        const existing = rows.find(row => row.page_type === pageType);
        const fallback = defaultPage(pageType);

        pages[pageType] = existing || {
          page_type: pageType,
          title: fallback.title,
          content: fallback.content,
          custom_css: ""
        };
      });

      res.json({ pages });
    }
  );
});

router.put("/game/:gameId/:pageType", requireAuth, async (req, res) => {
  const gameId = Number(req.params.gameId);
  const pageType = String(req.params.pageType || "").toUpperCase();

  try {
    const access = await getGameAccess(req.session.user, gameId);
    requireCapability(access, "canEdit");
  } catch (error) {
    return handleAccessError(res, error, "Гру не знайдено");
  }

  if (!isValidPageType(pageType)) {
    return res.status(400).json({
      error: "Невідомий тип сторінки"
    });
  }

  const {
    title,
    content,
    custom_css
  } = req.body;

  db.run(
    `
    INSERT INTO game_pages (
      game_id,
      page_type,
      title,
      content,
      custom_css,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(game_id, page_type)
    DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      custom_css = excluded.custom_css,
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      gameId,
      pageType,
      title || "",
      content || "",
      custom_css || ""
    ],
    error => {
      if (error) {
        return res.status(500).json({
          error: "Помилка збереження сторінки гри"
        });
      }

      res.json({
        message: "Сторінку гри збережено"
      });
    }
  );
});

router.get("/run/:runId", requireAuth, async (req, res) => {
  const runId = Number(req.params.runId);

  try {
    const access = await getRunAccess(req.session.user, runId);
    requireCapability(access, "canManageRuns");
  } catch (error) {
    return handleAccessError(res, error, "Запуск не знайдено");
  }

  db.all(
    `
    SELECT
      page_type,
      title,
      content,
      custom_css
    FROM run_pages
    WHERE run_id = ?
    `,
    [runId],
    (error, rows) => {
      if (error) {
        return res.status(500).json({
          error: "Помилка отримання сторінок запуску"
        });
      }

      const pages = {};

      ["START", "JOIN", "FINISH"].forEach(pageType => {
        pages[pageType] = rows.find(row => row.page_type === pageType) || null;
      });

      res.json({ pages });
    }
  );
});

router.put("/run/:runId/:pageType", requireAuth, async (req, res) => {
  const runId = Number(req.params.runId);
  const pageType = String(req.params.pageType || "").toUpperCase();

  try {
    const access = await getRunAccess(req.session.user, runId);
    requireCapability(access, "canManageRuns");
  } catch (error) {
    return handleAccessError(res, error, "Запуск не знайдено");
  }

  if (!isValidPageType(pageType)) {
    return res.status(400).json({
      error: "Невідомий тип сторінки"
    });
  }

  const {
    title,
    content,
    custom_css
  } = req.body;

  db.run(
    `
    INSERT INTO run_pages (
      run_id,
      page_type,
      title,
      content,
      custom_css,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(run_id, page_type)
    DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      custom_css = excluded.custom_css,
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      runId,
      pageType,
      title || "",
      content || "",
      custom_css || ""
    ],
    error => {
      if (error) {
        return res.status(500).json({
          error: "Помилка збереження сторінки запуску"
        });
      }

      res.json({
        message: "Сторінку запуску збережено"
      });
    }
  );
});

router.delete("/run/:runId/:pageType", requireAuth, (req, res) => {
  const runId = req.params.runId;
  const pageType = String(req.params.pageType || "").toUpperCase();

  if (!isValidPageType(pageType)) {
    return res.status(400).json({
      error: "Невідомий тип сторінки"
    });
  }

  db.run(
    `
    DELETE FROM run_pages
    WHERE run_id = ?
      AND page_type = ?
    `,
    [runId, pageType],
    error => {
      if (error) {
        return res.status(500).json({
          error: "Помилка скидання сторінки запуску"
        });
      }

      res.json({
        message: "Перевизначення сторінки запуску скинуто"
      });
    }
  );
});

module.exports = router;