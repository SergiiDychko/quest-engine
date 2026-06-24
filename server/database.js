const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");

const dbPath =
  process.env.DB_PATH ||
  path.join(__dirname, "../database/quest-engine.db");

fs.mkdirSync(path.dirname(dbPath), {
  recursive: true
});

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      recovery_email TEXT,
      password_hash TEXT NOT NULL,
      reset_token_hash TEXT,
      reset_token_expires_at TEXT,
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'AUTHOR', 'MODERATOR')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT
    )
  `);

  db.run(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'uk',
    description TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',

    game_type TEXT NOT NULL DEFAULT 'LINEAR',
    winner_type TEXT NOT NULL DEFAULT 'TIME',

    default_css TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )
`);

  db.run(`
    CREATE TABLE IF NOT EXISTS game_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL CHECK(permission IN ('VIEW', 'EDIT')),
      FOREIGN KEY (game_id) REFERENCES games(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

db.run(`
  CREATE TABLE IF NOT EXISTS game_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    game_id INTEGER NOT NULL,

    title TEXT NOT NULL,

    run_code TEXT UNIQUE NOT NULL,

    status TEXT NOT NULL DEFAULT 'DRAFT',

    created_by INTEGER NOT NULL,

    started_at TEXT,
    finished_at TEXT,
    pre_registration_enabled INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS game_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    page_type TEXT NOT NULL CHECK(page_type IN ('START', 'JOIN', 'FINISH')),
    title TEXT,
    content TEXT,
    custom_css TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, page_type),
    FOREIGN KEY (game_id) REFERENCES games(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS run_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    page_type TEXT NOT NULL CHECK(page_type IN ('START', 'JOIN', 'FINISH')),
    title TEXT,
    content TEXT,
    custom_css TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, page_type),
    FOREIGN KEY (run_id) REFERENCES game_runs(id)
  )
`);

  db.run(`
    CREATE TABLE IF NOT EXISTS run_moderators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES game_runs(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      FOREIGN KEY (run_id) REFERENCES game_runs(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'STANDARD',
      sort_order INTEGER NOT NULL,
      notes TEXT,
      is_scored INTEGER NOT NULL DEFAULT 1,
      auto_transition_minutes INTEGER,
      auto_transition_penalty_seconds INTEGER NOT NULL DEFAULT 0,
      required_main_answers INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS task_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS task_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      answer_text TEXT NOT NULL,
      answer_type TEXT NOT NULL CHECK(answer_type IN ('MAIN', 'BONUS', 'PENALTY')),
      description TEXT,
      time_modifier_seconds INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS task_hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      show_after_seconds INTEGER NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);



  db.run(`
    CREATE TABLE IF NOT EXISTS multitask_settings (
      task_id INTEGER PRIMARY KEY,
      completion_type TEXT NOT NULL DEFAULT 'ALL',
      required_count INTEGER,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS multitask_subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      content TEXT,
      answer_text TEXT NOT NULL DEFAULT '',
      description TEXT,
      comment TEXT,
      hint_type TEXT NOT NULL DEFAULT 'NONE',
      hint_text TEXT,
      hint_after_seconds INTEGER NOT NULL DEFAULT 0,
      hint_purchase_after_seconds INTEGER NOT NULL DEFAULT 0,
      hint_purchase_value INTEGER NOT NULL DEFAULT 0,
      task_answer_id INTEGER,
      reveal_condition TEXT NOT NULL DEFAULT 'IMMEDIATE',
      reveal_code TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (task_answer_id) REFERENCES task_answers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS team_multitask_hint_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      multitask_subtask_id INTEGER NOT NULL,
      purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, multitask_subtask_id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (multitask_subtask_id) REFERENCES multitask_subtasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS team_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      opened_at TEXT,
      completed_at TEXT,
      auto_transition INTEGER NOT NULL DEFAULT 0,
      bonus_seconds INTEGER NOT NULL DEFAULT 0,
      penalty_seconds INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS team_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      answer TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS team_found_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      task_answer_id INTEGER NOT NULL,
      found_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (task_answer_id) REFERENCES task_answers(id)
    )
  `);

db.run(`
  CREATE TABLE IF NOT EXISTS team_time_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    task_id INTEGER,
    adjustment_type TEXT NOT NULL CHECK(adjustment_type IN (
      'BONUS_CODE',
      'PENALTY_CODE',
      'AUTO_TRANSITION',
      'MANUAL_BONUS',
      'MANUAL_PENALTY'
    )),
    seconds INTEGER NOT NULL,
    comment TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )
`);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      team_id INTEGER,
      sender_user_id INTEGER,
      sender_team_id INTEGER,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES game_runs(id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (sender_user_id) REFERENCES users(id),
      FOREIGN KEY (sender_team_id) REFERENCES teams(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS olympiad_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL UNIQUE,
      association_count INTEGER NOT NULL,
      level_count INTEGER NOT NULL,
      completion_type TEXT NOT NULL DEFAULT 'TOP_CELL',
      required_cells_count INTEGER,
      purchase_available_after_seconds INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS olympiad_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      cell_number INTEGER NOT NULL,
      level_number INTEGER NOT NULL,
      content TEXT,
      answer_text TEXT NOT NULL,
      comment TEXT,
      purchase_value INTEGER NOT NULL DEFAULT 0,
      task_answer_id INTEGER,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (task_answer_id) REFERENCES task_answers(id)
    )
  `);

  // Lightweight migrations for profile/auth fields.
  db.run(`ALTER TABLE users ADD COLUMN username TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN recovery_email TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN reset_token_hash TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN reset_token_expires_at TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN updated_at TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN last_login_at TEXT`, () => {});
  db.run(`UPDATE users SET username = email WHERE username IS NULL OR username = ''`, () => {});
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL AND username <> ''`, () => {});
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash ON users(reset_token_hash)`, () => {});

  // Lightweight migrations for newer task mechanics.

  db.run(`ALTER TABLE game_runs ADD COLUMN pre_registration_enabled INTEGER NOT NULL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE tasks ADD COLUMN score_points INTEGER NOT NULL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE task_hints ADD COLUMN hint_type TEXT NOT NULL DEFAULT 'TIMED'`, () => {});
  db.run(`ALTER TABLE task_hints ADD COLUMN purchase_after_seconds INTEGER NOT NULL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE task_hints ADD COLUMN purchase_value INTEGER NOT NULL DEFAULT 0`, () => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS team_hint_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      task_hint_id INTEGER NOT NULL,
      purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, task_hint_id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (task_hint_id) REFERENCES task_hints(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS team_score_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      task_id INTEGER,
      event_type TEXT NOT NULL,
      points INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  db.run(`ALTER TABLE tasks ADD COLUMN hide_answers_block INTEGER NOT NULL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE tasks ADD COLUMN unlock_type TEXT NOT NULL DEFAULT 'IMMEDIATE'`, () => {});
  db.run(`ALTER TABLE tasks ADD COLUMN unlock_delay_seconds INTEGER NOT NULL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE tasks ADD COLUMN unlock_task_id INTEGER`, () => {});
  db.run(`ALTER TABLE tasks ADD COLUMN unlock_code TEXT`, () => {});
  db.run(`ALTER TABLE olympiad_settings ADD COLUMN purchase_available_after_seconds INTEGER NOT NULL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE olympiad_cells ADD COLUMN purchase_value INTEGER NOT NULL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE olympiad_cells ADD COLUMN task_answer_id INTEGER`, () => {});
  db.run(`ALTER TABLE multitask_subtasks ADD COLUMN reveal_condition TEXT NOT NULL DEFAULT 'IMMEDIATE'`, () => {});
  db.run(`ALTER TABLE multitask_subtasks ADD COLUMN reveal_code TEXT`, () => {});
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_olympiad_cells_task_cell ON olympiad_cells(task_id, cell_number)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_game_permissions_game_user ON game_permissions(game_id, user_id)`);
  db.run(`UPDATE users SET role = 'AUTHOR' WHERE role = 'MODERATOR'`, () => {});
  db.run(`UPDATE users SET username = LOWER(email) WHERE (username IS NULL OR username = '') AND email IS NOT NULL`, () => {});

});

db.get(
  "SELECT COUNT(*) AS count FROM users",
  async (error, row) => {
    if (error) {
      console.error(error);
      return;
    }

    if (row.count === 0) {
      const passwordHash =
        await bcrypt.hash("admin123", 10);

      db.run(
        `
        INSERT INTO users (
          name,
          email,
          password_hash,
          role
        )
        VALUES (?, ?, ?, ?)
        `,
        [
          "Administrator",
          "admin@example.com",
          passwordHash,
          "ADMIN"
        ]
      );

      console.log(
        "Створено адміністратора: admin@example.com / admin123"
      );
    }
  }
);

console.log("База даних успішно ініціалізована");
module.exports = db;