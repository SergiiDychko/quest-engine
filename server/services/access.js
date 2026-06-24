const db = require("../database");

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

async function getGameAccess(user, gameId) {
  if (!user || !gameId) return { exists: false, canView: false, canEdit: false, canDelete: false, canManageRuns: false, isOwner: false, permission: null };

  const game = await dbGet(
    `
    SELECT id, created_by
    FROM games
    WHERE id = ?
    `,
    [gameId]
  );

  if (!game) return { exists: false, canView: false, canEdit: false, canDelete: false, canManageRuns: false, isOwner: false, permission: null };

  const isAdmin = user.role === "ADMIN";
  const isOwner = Number(game.created_by) === Number(user.id);
  const permissionRow = await dbGet(
    `
    SELECT permission
    FROM game_permissions
    WHERE game_id = ? AND user_id = ?
    ORDER BY CASE permission WHEN 'EDIT' THEN 1 WHEN 'VIEW' THEN 2 ELSE 3 END
    LIMIT 1
    `,
    [gameId, user.id]
  );

  const permission = permissionRow?.permission || null;
  const canView = isAdmin || isOwner || permission === "VIEW" || permission === "EDIT";
  const canEdit = isAdmin || isOwner || permission === "EDIT";
  const canDelete = isAdmin || isOwner;
  const canManageRuns = isAdmin || isOwner || permission === "VIEW" || permission === "EDIT";

  return { exists: true, canView, canEdit, canDelete, canManageRuns, isOwner, permission };
}

async function getTaskAccess(user, taskId) {
  const task = await dbGet(`SELECT id, game_id FROM tasks WHERE id = ?`, [taskId]);
  if (!task) return { exists: false, canView: false, canEdit: false, canDelete: false, canManageRuns: false, isOwner: false, permission: null };
  return getGameAccess(user, task.game_id);
}

async function getRunAccess(user, runId) {
  const run = await dbGet(`SELECT id, game_id FROM game_runs WHERE id = ?`, [runId]);
  if (!run) return { exists: false, canView: false, canEdit: false, canDelete: false, canManageRuns: false, isOwner: false, permission: null };
  return getGameAccess(user, run.game_id);
}

function requireCapability(access, capability) {
  if (!access.exists) {
    const error = new Error("NOT_FOUND");
    error.statusCode = 404;
    throw error;
  }
  if (!access[capability]) {
    const error = new Error("FORBIDDEN");
    error.statusCode = 403;
    throw error;
  }
}

function handleAccessError(res, error, notFoundMessage = "Обʼєкт не знайдено") {
  if (error.statusCode === 404 || error.message === "NOT_FOUND") {
    return res.status(404).json({ error: notFoundMessage });
  }
  if (error.statusCode === 403 || error.message === "FORBIDDEN") {
    return res.status(403).json({ error: "Недостатньо прав" });
  }
  console.error(error);
  return res.status(500).json({ error: "Помилка перевірки доступу" });
}

module.exports = {
  dbGet,
  getGameAccess,
  getTaskAccess,
  getRunAccess,
  requireCapability,
  handleAccessError
};
