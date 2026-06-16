const gameSlug = "demo-game";
const gameTitle = "Назва гри";

const startScreen = document.getElementById("startScreen");
const createdScreen = document.getElementById("createdScreen");
const gameScreen = document.getElementById("gameScreen");

const gameTitleElement = document.getElementById("gameTitle");
const teamNameInput = document.getElementById("teamNameInput");
const createTeamBtn = document.getElementById("createTeamBtn");

const teamLinkInput = document.getElementById("teamLinkInput");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const goToGameBtn = document.getElementById("goToGameBtn");

const teamNameDisplay = document.getElementById("teamNameDisplay");
const renameTeamBtn = document.getElementById("renameTeamBtn");

gameTitleElement.textContent = `“${gameTitle}”`;

function generateTeamId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getGameSlugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("game") || gameSlug;
}

function getTeamIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("team");
}

function getTeamStorageKey(gameSlug, teamId) {
  return `game_${gameSlug}_team_${teamId}`;
}

function saveTeam(team) {
  localStorage.setItem(
    getTeamStorageKey(team.gameSlug, team.id),
    JSON.stringify(team)
  );
}

function getTeam(gameSlug, teamId) {
  const savedTeam = localStorage.getItem(getTeamStorageKey(gameSlug, teamId));
  return savedTeam ? JSON.parse(savedTeam) : null;
}

function showScreen(screen) {
  startScreen.classList.add("hidden");
  createdScreen.classList.add("hidden");
  gameScreen.classList.add("hidden");

  screen.classList.remove("hidden");
}

function showGame(team) {
  teamNameDisplay.textContent = team.name;
  showScreen(gameScreen);
}

createTeamBtn.addEventListener("click", () => {
  const teamName = teamNameInput.value.trim();

  if (!teamName) {
    alert("Введіть назву команди");
    return;
  }

  const team = {
    id: generateTeamId(),
    gameSlug: gameSlug,
    name: teamName,
    createdAt: new Date().toISOString(),
    currentTask: 1
  };

  saveTeam(team);

  const teamLink = `${window.location.origin}${window.location.pathname}?game=${gameSlug}&team=${team.id}`;

  teamLinkInput.value = teamLink;

  goToGameBtn.onclick = () => {
    window.location.href = teamLink;
  };

  showScreen(createdScreen);
});

copyLinkBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(teamLinkInput.value);
  alert("Посилання скопійовано");
});

renameTeamBtn.addEventListener("click", () => {
  const currentGameSlug = getGameSlugFromUrl();
  const teamId = getTeamIdFromUrl();
  const team = getTeam(currentGameSlug, teamId);

  if (!team) return;

  const newName = prompt("Введіть нову назву команди:", team.name);

  if (!newName || !newName.trim()) return;

  team.name = newName.trim();
  saveTeam(team);
  showGame(team);
});

const currentGameSlug = getGameSlugFromUrl();
const teamIdFromUrl = getTeamIdFromUrl();

if (teamIdFromUrl) {
  const team = getTeam(currentGameSlug, teamIdFromUrl);

  if (team) {
    showGame(team);
  } else {
    alert("Команду не знайдено");
    showScreen(startScreen);
  }
} else {
  showScreen(startScreen);
}
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return `${minutes}хв ${String(restSeconds).padStart(2, "0")}сек`;
}

function startHintTimers() {
  const hintTimers = document.querySelectorAll(".hint-timer");

  hintTimers.forEach((timerElement) => {
    let secondsLeft = Number(timerElement.dataset.seconds);
    const hintId = timerElement.dataset.hintId;
    const timerValue = timerElement.querySelector(".timer-value");
    const hintElement = document.getElementById(`hint-${hintId}`);

    const interval = setInterval(() => {
      secondsLeft -= 1;

      if (secondsLeft <= 0) {
        clearInterval(interval);
        timerElement.classList.add("hidden");
        hintElement.classList.remove("hidden");
        return;
      }

      timerValue.textContent = formatTime(secondsLeft);
    }, 1000);
  });
}

startHintTimers();

const submitAnswerBtn = document.getElementById("submitAnswerBtn");
const answerInput = document.getElementById("answerInput");

submitAnswerBtn.addEventListener("click", () => {
  const answer = answerInput.value.trim();

  if (!answer) {
    alert("Введіть відповідь");
    return;
  }

  alert(`Відповідь відправлено: ${answer}`);
});