const bcrypt = require("bcrypt");
const db = require("./database");

const admin = {
  name: "Сергій",
  email: "admin@example.com",
  password: "admin12345",
  role: "ADMIN"
};

async function createAdmin() {
  const passwordHash = await bcrypt.hash(admin.password, 10);

  db.run(
    `
    INSERT INTO users (name, email, password_hash, role)
    VALUES (?, ?, ?, ?)
    `,
    [admin.name, admin.email, passwordHash, admin.role],
    function (error) {
      if (error) {
        console.error("Помилка створення адміністратора:", error.message);
        return;
      }

      console.log("Адміністратора створено");
      console.log("Email:", admin.email);
      console.log("Password:", admin.password);
    }
  );
}

createAdmin();