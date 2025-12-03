// ===============================
// 0. STAGE DEFINITIONS
// ===============================
const STARTERS = [
  "Battlefield", "Final Destination", "Town & City",
  "Pokémon Stadium 2", "Smashville"
];

const COUNTERPICKS = [
  "Kalos Pokémon League", "Lylat Cruise", "Small Battlefield",
  "Yoshi's Story", "Hollow Bastion"
];

const FULL_STAGE_LIST = [...STARTERS, ...COUNTERPICKS];

// ===============================
// 1. TURN / STUN CONFIG (MOBILE FIX)
// ===============================
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.relay.metered.ca:80" },

    {
      urls: "turn:global.relay.metered.ca:80",
      username: "d1c0795c35b8302516e6c4a6",
      credential: "4YoedDIk1I0HTBlU"
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "d1c0795c35b8302516e6c4a6",
      credential: "4YoedDIk1I0HTBlU"
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "d1c0795c35b8302516e6c4a6",
      credential: "4YoedDIk1I0HTBlU"
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "d1c0795c35b8302516e6c4a6",
      credential: "4YoedDIk1I0HTBlU"
    }
  ]
};

// ===============================
// 2. GLOBAL STATE + LOCAL STORAGE
// ===============================

const PERSIST_KEY = "ssbu_stage_state_v4"; // bump version to avoid old schema conflicts

function createDefaultGameState() {
  return {
    type: "",           // '', 'game1', 'subsequent'
    available: [],
    bans: [],
    turn: "",
    banCount: 0,
    finalStage: null,

    teamNames: { home: "Home", away: "Away" },

    // Crew battle: 4 players per team, each starting with 3 stocks
    crew: {
      homePlayers: [3, 3, 3, 3], // Player 1–4 stocks
      awayPlayers: [3, 3, 3, 3],
      homeCurrent: 0,           // index 0..3
      awayCurrent: 0,
      round: 1
    }
  };
}

let gameState = createDefaultGameState();
let peer, conn, isHost = false, myRole = "";

// Save to browser
function saveState() {
  localStorage.setItem(PERSIST_KEY, JSON.stringify(gameState));
}

function loadState() {
  const data = localStorage.getItem(PERSIST_KEY);
  if (!data) return;
  try {
    const parsed = JSON.parse(data);
    // Shallow merge to ensure new fields exist
    gameState = { ...createDefaultGameState(), ...parsed };
  } catch (e) {
    console.warn("Failed to parse saved state", e);
  }
}

// ===============================
// 3. DOM ELEMENTS
// ===============================

const el = {
  connArea: document.getElementById("connection-area"),
  connStatus: document.getElementById("conn-status"),
  hostBtn: document.getElementById("host-btn"),
  roomId: document.getElementById("room-id"),
  clientControls: document.getElementById("client-controls"),
  joinIdInput: document.getElementById("join-id-input"),
  joinBtn: document.getElementById("join-btn"),

  teamNameArea: document.getElementById("team-name-area"),
  homeTeamInput: document.getElementById("home-team-input"),
  awayTeamInput: document.getElementById("away-team-input"),
  saveTeamNamesBtn: document.getElementById("save-team-names"),

  setupArea: document.getElementById("game-setup-area"),
  initialSetup: document.getElementById("initial-setup"),
  game1Btn: document.getElementById("game-1-btn"),
  subsequentSetup: document.getElementById("subsequent-setup"),
  hostWonBtn: document.getElementById("host-won"),
  clientWonBtn: document.getElementById("client-won"),
  rolePrompt: document.getElementById("role-prompt"),
  hostStrikesFirstBtn: document.getElementById("host-strikes-first"),
  clientStrikesFirstBtn: document.getElementById("client-strikes-first"),
  setupStatus: document.getElementById("setup-status"),

  stageArea: document.getElementById("stage-select-area"),
  starterList: document.getElementById("starter-list"),
  counterpickList: document.getElementById("counterpick-list"),
  instructions: document.getElementById("instructions"),

  finalStageArea: document.getElementById("final-stage"),
  finalStageName: document.getElementById("final-stage-name"),
  nextGameBtn: document.getElementById("next-game-btn"),
  rematchBtn: document.getElementById("rematch-btn"),

  stockArea: document.getElementById("stock-area"),
  stockHeader: document.getElementById("stock-header"),
  homeTeamLabel: document.getElementById("home-team-label"),
  awayTeamLabel: document.getElementById("away-team-label"),
  homeTeamStocks: document.getElementById("home-team-stocks"),
  awayTeamStocks: document.getElementById("away-team-stocks"),
  homePlayerStocks: document.getElementById("home-player-stocks"),
  awayPlayerStocks: document.getElementById("away-player-stocks"),
  homeMinusStock: document.getElementById("home-minus-stock"),
  awayMinusStock: document.getElementById("away-minus-stock"),
  finishRoundBtn: document.getElementById("finish-round")
};

// ===============================
// 4. TAB SYSTEM LOGIC
// ===============================

function showSection(id) {
  document.querySelectorAll(".screen-section").forEach(sec =>
    sec.classList.add("hidden")
  );
  const sec = document.getElementById(id);
  if (sec) sec.classList.remove("hidden");

  document.querySelectorAll("#tabs .tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.target === id);
  });
}

document.querySelectorAll("#tabs .tab").forEach(tab => {
  tab.addEventListener("click", () => {
    showSection(tab.dataset.target);
  });
});

// ===============================
// 5. PEERJS CONNECTION (TURN ENABLED)
// ===============================

el.hostBtn.onclick = () => {
  const roomId = "ssbu-" + Math.random().toString(36).substring(2, 8);

  peer = new Peer(roomId, { config: ICE_CONFIG });

  peer.on("open", id => {
    el.roomId.textContent = id;
    el.connStatus.textContent = "Waiting for opponent...";
    el.clientControls.classList.add("hidden");
    isHost = true;
  });

  peer.on("connection", setupConnection);

  peer.on("error", err => alert(err.type));
};

el.joinBtn.onclick = () => {
  const joinId = el.joinIdInput.value.trim();
  if (!joinId) return;

  peer = new Peer(undefined, { config: ICE_CONFIG });

  peer.on("open", () => {
    const connection = peer.connect(joinId);
    setupConnection(connection);
  });

  peer.on("error", err => alert(err.type));
};

function setupConnection(connection) {
  conn = connection;

  el.connStatus.textContent = "Connected!";
  showSection("team-name-area");

  conn.on("data", handleMessage);
  conn.on("close", () => location.reload());
}

function sendData(data) {
  if (conn && conn.open) conn.send(data);
}

// ===============================
// 6. TEAM NAMES
// ===============================

el.saveTeamNamesBtn.onclick = () => {
  gameState.teamNames.home = el.homeTeamInput.value.trim() || "Home";
  gameState.teamNames.away = el.awayTeamInput.value.trim() || "Away";

  sendData({ type: "team-names", names: gameState.teamNames });
  saveState();

  // Also refresh stock labels
  setStockUI();

  showSection("game-setup-area");
};

function applyTeamNames() {
  el.homeTeamInput.value = gameState.teamNames.home;
  el.awayTeamInput.value = gameState.teamNames.away;
}

// ===============================
// 7. GAME SETUP
// ===============================

el.game1Btn.onclick = () => {
  el.initialSetup.classList.add("hidden");
  el.rolePrompt.classList.remove("hidden");
};

el.hostStrikesFirstBtn.onclick = () => {
  myRole = "striker_1";
  sendData({ type: "setup", game: "game1", role: "striker_2" });
  initGame1("striker_1");
};

el.clientStrikesFirstBtn.onclick = () => {
  myRole = "striker_2";
  sendData({ type: "setup", game: "game1", role: "striker_1" });
  initGame1("striker_2");
};

el.hostWonBtn.onclick = () => {
  myRole = "banner";
  sendData({ type: "setup", game: "subsequent", role: "picker" });
  initSubsequentGame("banner");
};

el.clientWonBtn.onclick = () => {
  myRole = "picker";
  sendData({ type: "setup", game: "subsequent", role: "banner" });
  initSubsequentGame("picker");
};

// ===============================
// 8. INIT GAMES
// ===============================

function initGame1(role) {
  myRole = role;
  gameState.type = "game1";
  gameState.available = [...STARTERS];
  gameState.bans = [];
  gameState.turn = "striker_1";
  gameState.banCount = 0;
  gameState.finalStage = null;

  showSection("stage-select-area");
  renderStages();
  updateGame1Instructions();
  saveState();
}

function initSubsequentGame(role) {
  myRole = role;
  gameState.type = "subsequent";
  gameState.available = [...FULL_STAGE_LIST];
  gameState.bans = [];
  gameState.banCount = 0;
  gameState.turn = "banner";
  gameState.finalStage = null;

  showSection("stage-select-area");
  renderStages();
  updateSubsequentGameInstructions();
  saveState();
}

// ===============================
// 9. STAGE LOGIC
// ===============================

function onStageClick(stage) {
  if (gameState.type === "game1")
    runGame1Logic(stage, "me");
  else
    runSubsequentGameLogic(stage, "me");
}

function runGame1Logic(stage, source) {
  const remaining = gameState.available.length;

  // FINAL PICK
  if (remaining === 2) {
    if (source === "me") sendData({ type: "pick", stage });
    showFinalStage(stage);
    return;
  }

  // BAN
  if (source === "me") sendData({ type: "ban", stage });

  gameState.bans.push(stage);
  gameState.available = gameState.available.filter(s => s !== stage);

  const r = gameState.available.length;
  if (r === 4) gameState.turn = "striker_2";
  else if (r === 3) gameState.turn = "striker_2";
  else if (r === 2) gameState.turn = "striker_1";

  renderStages();
  updateGame1Instructions();
  saveState();
}

function runSubsequentGameLogic(stage, source) {
  if (gameState.banCount < 3) {
    if (source === "me") sendData({ type: "ban", stage });

    gameState.bans.push(stage);
    gameState.available = gameState.available.filter(s => s !== stage);
    gameState.banCount++;
  } else {
    if (source === "me") sendData({ type: "pick", stage });
    showFinalStage(stage);
    return;
  }

  gameState.turn = gameState.banCount < 3 ? "banner" : "picker";
  renderStages();
  updateSubsequentGameInstructions();
  saveState();
}

// ===============================
// 10. UI: STAGES
// ===============================

function renderStages() {
  el.starterList.innerHTML = "";
  el.counterpickList.innerHTML = "";

  let list = gameState.type === "game1" ? STARTERS : FULL_STAGE_LIST;

  list.forEach(stage => {
    const btn = document.createElement("button");
    btn.textContent = stage;
    btn.classList.add("stage-btn");

    const banned = gameState.bans.includes(stage);
    if (banned) {
      btn.classList.add("banned");
      btn.disabled = true;
    } else if (gameState.finalStage) {
      btn.disabled = true;
    } else if (myRole === gameState.turn) {
      let canClick = true;
      if (gameState.type === "game1" && !STARTERS.includes(stage)) {
        canClick = false;
      }
      if (canClick) {
        btn.classList.add("selectable");
        btn.onclick = () => onStageClick(stage);
      } else {
        btn.disabled = true;
      }
    } else {
      btn.disabled = true;
    }

    // Highlight last two pickable in Game 1
    if (gameState.type === "game1" &&
        gameState.available.length === 2 &&
        !banned) {
      btn.classList.add("pickable");
    }

    if (STARTERS.includes(stage))
      el.starterList.appendChild(btn);
    else
      el.counterpickList.appendChild(btn);
  });

  el.counterpickList.parentElement.classList.toggle(
    "hidden",
    gameState.type === "game1"
  );
}

function updateGame1Instructions() {
  const remaining = gameState.available.length;
  let txt = "";

  if (myRole === gameState.turn) {
    if (remaining === 2) txt = "Final Step: PICK the stage.";
    else if (remaining === 5) txt = "Your Turn: Ban 1 stage.";
    else txt = "Your Turn: Continue banning.";
  } else {
    if (remaining === 2) txt = "Opponent is picking the final stage...";
    else txt = "Waiting for opponent...";
  }

  el.instructions.textContent = txt;
}

function updateSubsequentGameInstructions() {
  const txt =
    (myRole === gameState.turn)
      ? (gameState.banCount < 3
          ? `Ban ${3 - gameState.banCount} more stage(s).`
          : "Pick one stage.")
      : "Waiting for opponent...";
  el.instructions.textContent = txt;
}

// ===============================
// 11. FINAL STAGE
// ===============================

function showFinalStage(stage) {
  gameState.finalStage = stage;
  saveState();

  showSection("final-stage");
  el.finalStageName.textContent = stage;

  // preload stock UI
  setStockUI();
}

// ===============================
// 12. CREW BATTLE (4 PLAYERS / TEAM)
// ===============================

// Helper to compute total team stocks
function totalStocks(arr) {
  return arr.reduce((sum, s) => sum + Math.max(0, s), 0);
}

// Update all stock UI elements
function setStockUI() {
  const c = gameState.crew;
  const homeArr = c.homePlayers;
  const awayArr = c.awayPlayers;

  const homeTotal = totalStocks(homeArr);
  const awayTotal = totalStocks(awayArr);

  const homeCurrentStocks =
    c.homeCurrent < homeArr.length ? homeArr[c.homeCurrent] : 0;
  const awayCurrentStocks =
    c.awayCurrent < awayArr.length ? awayArr[c.awayCurrent] : 0;

  // Label with team name and which player is active
  const homeStatus = c.homeCurrent < 4 ? `Player ${c.homeCurrent + 1}/4` : "Eliminated";
  const awayStatus = c.awayCurrent < 4 ? `Player ${c.awayCurrent + 1}/4` : "Eliminated";

  el.homeTeamLabel.textContent = `${gameState.teamNames.home} (${homeStatus})`;
  el.awayTeamLabel.textContent = `${gameState.teamNames.away} (${awayStatus})`;

  el.homeTeamStocks.textContent = homeTotal;
  el.awayTeamStocks.textContent = awayTotal;

  el.homePlayerStocks.textContent = homeCurrentStocks;
  el.awayPlayerStocks.textContent = awayCurrentStocks;

  el.stockHeader.textContent =
    `Crew Battle – Round ${c.round} | ` +
    `${gameState.teamNames.home} ${homeStatus} vs ` +
    `${gameState.teamNames.away} ${awayStatus}`;
}

// Adjust stock for one team, carryover between players
function adjustStock(team) {
  const c = gameState.crew;

  if (team === "home") {
    if (c.homeCurrent >= c.homePlayers.length) return; // already eliminated
    if (c.homePlayers[c.homeCurrent] <= 0) return;     // cannot go negative

    c.homePlayers[c.homeCurrent]--;

    // If current player is KO'd and there are more players, advance
    if (c.homePlayers[c.homeCurrent] === 0 && c.homeCurrent < c.homePlayers.length - 1) {
      c.homeCurrent++;
    }
  } else {
    if (c.awayCurrent >= c.awayPlayers.length) return;
    if (c.awayPlayers[c.awayCurrent] <= 0) return;

    c.awayPlayers[c.awayCurrent]--;

    if (c.awayPlayers[c.awayCurrent] === 0 && c.awayCurrent < c.awayPlayers.length - 1) {
      c.awayCurrent++;
    }
  }

  // Broadcast full crew state
  sendData({ type: "crew-update", crew: c });
  setStockUI();
  saveState();
}

el.homeMinusStock.onclick = () => adjustStock("home");
el.awayMinusStock.onclick = () => adjustStock("away");

// Finish Round: only increments round counter, NO stock reset
el.finishRoundBtn.onclick = () => {
  gameState.crew.round++;
  sendData({ type: "crew-update", crew: gameState.crew });
  setStockUI();
  saveState();
};

// ===============================
// 13. MESSAGE HANDLER
// ===============================

function handleMessage(data) {
  switch (data.type) {
    case "team-names":
      gameState.teamNames = data.names;
      setStockUI();
      break;

    case "setup":
      myRole = data.role;
      if (data.game === "game1") initGame1(myRole);
      else initSubsequentGame(myRole);
      break;

    case "ban":
      if (gameState.type === "game1")
        runGame1Logic(data.stage, "opponent");
      else
        runSubsequentGameLogic(data.stage, "opponent");
      break;

    case "pick":
      showFinalStage(data.stage);
      break;

    case "crew-update":
    case "stock-update": // legacy name, treat same
      gameState.crew = data.crew;
      setStockUI();
      break;

    case "next_game":
      setupNextGame();
      break;

    case "rematch":
      gameState = createDefaultGameState();
      applyTeamNames();
      setStockUI();
      showSection("game-setup-area");
      break;
  }

  saveState();
}

// ===============================
// 14. FLOW CONTROL BUTTONS
// ===============================

el.nextGameBtn.onclick = () => {
  sendData({ type: "next_game" });
  setupNextGame();
};

function setupNextGame() {
  gameState.type = "";
  gameState.bans = [];
  gameState.banCount = 0;
  gameState.finalStage = null;

  showSection("game-setup-area");
  el.initialSetup.classList.add("hidden");
  el.subsequentSetup.classList.remove("hidden");
  saveState();
}

el.rematchBtn.onclick = () => {
  sendData({ type: "rematch" });
  gameState = createDefaultGameState();
  applyTeamNames();
  setStockUI();
  showSection("game-setup-area");
  saveState();
};

// ===============================
// 15. LOAD STATE ON START
// ===============================

window.addEventListener("load", () => {
  loadState();
  applyTeamNames();
  setStockUI();
  showSection("connection-area");
});
