const db = require("./database");

function addColumnIfMissing(tableName, columnName, columnDefinition) {
  db.all(`PRAGMA table_info(${tableName})`, (error, columns) => {
    if (error) {
      console.error(error.message);
      return;
    }

    const exists = columns.some((column) => column.name === columnName);

    if (exists) {
      console.log(`Колонка ${tableName}.${columnName} вже існує`);
      return;
    }

    db.run(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`,
      (alterError) => {
        if (alterError) {
          console.error(`Помилка додавання ${columnName}:`, alterError.message);
          return;
        }

        console.log(`Додано колонку ${tableName}.${columnName}`);
      }
    );
  });
}

addColumnIfMissing(
  "games",
  "game_type",
  "TEXT NOT NULL DEFAULT 'LINEAR'"
);

addColumnIfMissing(
  "games",
  "winner_type",
  "TEXT NOT NULL DEFAULT 'TIME'"
);

addColumnIfMissing(
  "tasks",
  "points_scoring_type",
  "TEXT"
);

addColumnIfMissing(
  "tasks",
  "fixed_points",
  "INTEGER"
);