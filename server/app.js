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

const app = express();
const PORT = 3000;

app.use(express.json());

app.use(
  session({
    secret: "quest-engine-dev-secret",
    resave: false,
    saveUninitialized: false
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

app.use(
  "/api/statistics",
  require("./routes/statistics")
);

app.use(express.static(path.join(__dirname, "../client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

app.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});