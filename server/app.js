const express = require("express");
const path = require("path");
const session = require("express-session");

const authRoutes = require("./routes/auth");
const gameRoutes = require("./routes/games");
const taskRoutes = require("./routes/tasks");
const taskContentRoutes = require("./routes/task-content");
const taskHintRoutes = require("./routes/task-hints");
const runRoutes = require("./routes/runs");
const joinRoutes = require("./routes/join");
const playRoutes = require("./routes/play");
const pagesRoutes = require("./routes/pages");
const uploadRoutes = require("./routes/uploads");
const userRoutes = require("./routes/users");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "70mb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "quest-engine-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/task-content", taskContentRoutes);
app.use("/api/task-hints", taskHintRoutes);
app.use("/api/runs", runRoutes);
app.use("/api/join", joinRoutes);
app.use("/api/play", playRoutes);
app.use("/api/pages", pagesRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/users", userRoutes);

app.use(
  "/api/statistics",
  require("./routes/statistics")
);

const uploadsPath = process.env.UPLOADS_PATH || path.join(__dirname, "../uploads");
app.use("/uploads", express.static(uploadsPath));
app.use(express.static(path.join(__dirname, "../client"), { index: false }));

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});