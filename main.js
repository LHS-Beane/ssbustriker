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
// 1. GLOBAL STATE + PERSISTENCE
// ===============================
const PERSIST_KEY = "ssbu_stage_state_v2";

function createDefaultGameState() {
  return {
    // Stage selection info
    type: "",           // '', 'game1', 'subsequent'
    available: [],
    bans: [],
    turn: "",           // 'striker_1', 'striker_2', 'banner', 'picker'
    banCount: 0,
    finalStage: null,

    // Team names
    teamNames: {
      home: "Home",
      away: "Away"
    },

    // Crew battle stocks
    crew: {
      homeStocks: 12,
      awayStocks: 12,
      homePlayerStocks: 3,
      awayPlayerStocks: 3,
      round: 1
    }
  };
}

let peer;
let conn;
let isHost = false;
let myRole = "";
let gameState = createDefaultGameState();

// ---- Persistence helpers ----
function saveState() {
  try {
    const toStore = {
      type: gameState.type,
      available: gameState.available,
      bans: gameState.bans,
      turn: gameState.turn,
      banCount: gameState.banCount,
      finalStage: gameState.finalStage,
      teamNames: gameState.teamNames,
      crew: gameState.crew
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(toStore));
    updateShareUrl();
  } catch (e) {
    console.warn("Could not save state:", e);
  }
}

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Could not load from storage:", e);
    return null;
  }
}

function loadStateFromHash() {
  if (!location.hash.startsWith("#state=")) return null;
  try {
    const encoded = location.hash.slice(7);
    const json = decodeURIComponent(encoded);
    return JSON.parse(json);
  } catch (e) {
    console.warn("Could not parse state from hash:", e);
    return null;
  }
}

function updateShareUrl() {
  try {
    const payload = {
      type: gameState.type,
      available: gameState.available,
      bans: gameState.bans,
      turn: gameState.turn,
      banCount: gameState.banCount,
      finalStage: gameState.finalStage,
      teamNames: gameState.teamNames,
      crew: gameState.crew
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const newHash = "#state=" + encoded;
    const newUrl = location.pathname + location.search + newHash;
    if (location.hash !== newHash) {
      history.replaceState(null, "", newUrl);
    }
    // If you add an <input id="share-url"> you can auto-fill it here:
    const shareInput = document.getElementById("share-url");
    if (shareInput) {
      shareInput.value = window.location.href;
    }
  } catch (e) {
    console.warn("Could not update share URL:", e);
  }
}

// ===============================
// 2. DOM ELEMENTS
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
  setupStatus: document.getElementById("setup-status"),

  initialSetup: document.getElementById("initial-setup"),
  game1Btn: document.getElementById("game-1-btn"),

  subsequentSetup: document.getElementById("subsequent-setup"),
  hostWonBtn: document.getElementById("host-won"),
  clientWonBtn: document.getElementById("client-won"),

  rolePrompt: document.getElementById("role-prompt"),
  hostStrikesFirstBtn: document.getElementById("host-strikes-first"),
  clientStrikesFirstBtn: document.getElementById("client-strikes-first"),

  stageArea: document.getElementById("stage-select-area"),
  gameStatus: document.getElementById("game-status"),
  instructions: document.getElementById("instructions"),
  starterList: document.getElementById("starter-list"),
  counterpickList: document.getElementById("counterpick-list"),

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
// 3. NETWORKING (PeerJS)
// ===============================
el.hostBtn.addEventListener("click", () => {
  const newRoomId = "ssbu-" + Math.random().toString(36).substr(2, 6);
  peer = new Peer(newRoomId);

  peer.on("open", (id) => {
    el.roomId.textContent = id;
    el.hostBtn.disabled = true;
    el.clientControls.classList.add("hidden");
    el.connStatus.textContent = "Waiting for opponent...";
    isHost = true;
  });

  peer.on("connection", setupConnection);

  peer.on("error", (err) => {
    alert("Error: " + err.type);
    el.hostBtn.disabled = false;
    isHost = false;
  });
});

el.joinBtn.addEventListener("click", () => {
  const joinId = el.joinIdInput.value.trim();
  if (!joinId) return;

  peer = new Peer();
  peer.on("open", () => {
    const connection = peer.connect(joinId);
    setupConnection(connection);
  });
  peer.on("error", (err) => {
    alert("Connection failed: " + err.message);
  });
});

function setupConnection(connection) {
  conn = connection;
  el.connStatus.textContent = "✅ Opponent Connected!";
  el.connArea.classList.add("hidden");

  // After connecting, go to team-name step
  el.teamNameArea.classList.remove("hidden");

  conn.on("data", handleMessage);
  conn.on("close", () => {
    alert("Opponent has disconnected.");
    location.reload();
  });
}

function sendData(data) {
  if (conn && conn.open) {
    conn.send(data);
  }
}

// ===============================
// 4. TEAM NAMES
// ===============================
el.saveTeamNamesBtn.addEventListener("click", () => {
  const home = el.homeTeamInput.value.trim() || "Home";
  const away = el.awayTeamInput.value.trim() || "Away";

  gameState.teamNames = { home, away };
  saveState();
  sendData({ type: "team-names", names: gameState.teamNames });

  el.teamNameArea.classList.add("hidden");
  el.setupArea.classList.remove("hidden");
});

function applyTeamNamesToInputs() {
  if (el.homeTeamInput) el.homeTeamInput.value = gameState.teamNames.home;
  if (el.awayTeamInput) el.awayTeamInput.value = gameState.teamNames.away;
}

// ===============================
// 5. GAME SETUP LOGIC
// ===============================
el.game1Btn.addEventListener("click", () => {
  el.initialSetup.classList.add("hidden");
  el.rolePrompt.classList.remove("hidden");
});

el.hostStrikesFirstBtn.addEventListener("click", () => {
  myRole = "striker_1";
  sendData({ type: "setup", game: "game1", role: "striker_2" });
  initGame1("striker_1");
});

el.clientStrikesFirstBtn.addEventListener("click", () => {
  myRole = "striker_2";
  sendData({ type: "setup", game: "game1", role: "striker_1" });
  initGame1("striker_2");
});

el.hostWonBtn.addEventListener("click", () => {
  myRole = "banner";
  sendData({ type: "setup", game: "subsequent", role: "picker" });
  initSubsequentGame("banner");
});

el.clientWonBtn.addEventListener("click", () => {
  myRole = "picker";
  sendData({ type: "setup", game: "subsequent", role: "banner" });
  initSubsequentGame("picker");
});

// ===============================
// 6. INIT GAMES
// ===============================
function initGame1(role) {
  el.setupArea.classList.add("hidden");
  el.stageArea.classList.remove("hidden");
  el.rolePrompt.classList.add("hidden");
  el.stockArea.classList.add("hidden");
  el.finalStageArea.classList.add("hidden");

  myRole = role;
  gameState.type = "game1";
  gameState.available = [...STARTERS];
  gameState.bans = [];
  gameState.turn = "striker_1";
  gameState.banCount = 0;
  gameState.finalStage = null;

  renderStages();
  updateGame1Instructions();
  saveState();
}

function initSubsequentGame(role) {
  el.setupArea.classList.add("hidden");
  el.stageArea.classList.remove("hidden");
  el.stockArea.classList.add("hidden");
  el.finalStageArea.classList.add("hidden");

  myRole = role;
  gameState.type = "subsequent";
  gameState.available = [...FULL_STAGE_LIST];
  gameState.bans = [];
  gameState.banCount = 0;
  gameState.turn = "banner";
  gameState.finalStage = null;

  renderStages();
  updateSubsequentGameInstructions();
  saveState();
}

// ===============================
// 7. GAME LOGIC
// ===============================

// Game 1: 1–2–1 with final CLICK as PICK when 2 stages left
function runGame1Logic(stage, actor) {
  const remainingCount = gameState.available.length;

  // FINAL STEP: PICK (2 stages left)
  if (remainingCount === 2) {
    if (actor === "me") {
      sendData({ type: "pick", stage });
    }
    showFinalStage(stage);
    return;
  }

  // NORMAL STEP: BAN
  if (actor === "me") {
    sendData({ type: "ban", stage });
  }
  gameState.bans.push(stage);
  gameState.available = gameState.available.filter(s => s !== stage);

  const newRemaining = gameState.available.length;

  if (newRemaining === 4) {
    gameState.turn = "striker_2";
  } else if (newRemaining === 3) {
    gameState.turn = "striker_2";
  } else if (newRemaining === 2) {
    gameState.turn = "striker_1";
  }

  renderStages();
  updateGame1Instructions();
  saveState();
}

// Subsequent games: Winner bans 3, loser picks 1
function runSubsequentGameLogic(stage, actor) {
  // BANNING PHASE
  if (gameState.banCount < 3) {
    if (actor === "me") {
      sendData({ type: "ban", stage });
    }
    gameState.bans.push(stage);
    gameState.available = gameState.available.filter(s => s !== stage);
    gameState.banCount++;
  }
  // PICK PHASE
  else if (gameState.banCount === 3) {
    if (actor === "me") {
      sendData({ type: "pick", stage });
    }
    showFinalStage(stage);
    return;
  }

  if (gameState.banCount < 3) {
    gameState.turn = "banner";
  } else {
    gameState.turn = "picker";
  }

  renderStages();
  updateSubsequentGameInstructions();
  saveState();
}

// ===============================
// 8. UI RENDERING
// ===============================
function renderStages() {
  el.starterList.innerHTML = "";
  el.counterpickList.innerHTML = "";

  const allStages = (gameState.type === "game1") ? STARTERS : FULL_STAGE_LIST;

  allStages.forEach(stage => {
    const btn = document.createElement("button");
    btn.textContent = stage;
    btn.classList.add("stage-btn");
    btn.dataset.stage = stage;

    if (gameState.bans.includes(stage)) {
      btn.classList.add("banned");
      btn.disabled = true;
    } else {
      // Highlight remaining stages on final pick step for Game 1
      if (gameState.type === "game1" &&
          gameState.available.length === 2 &&
          !gameState.bans.includes(stage)) {
        btn.classList.add("pickable"); // style in CSS if you want
      }

      if (myRole === gameState.turn && !gameState.finalStage) {
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
    }

    if (STARTERS.includes(stage)) {
      el.starterList.appendChild(btn);
    } else {
      el.counterpickList.appendChild(btn);
    }
  });

  if (gameState.type === "game1") {
    el.counterpickList.parentElement.classList.add("hidden");
  } else {
    el.counterpickList.parentElement.classList.remove("hidden");
  }
}

function updateGame1Instructions() {
  const remaining = gameState.available.length;
  let text = "";

  if (myRole === gameState.turn) {
    if (remaining === 2) text = "Final Step: PICK the stage you want to play!";
    else if (remaining === 5) text = "Your Turn: Ban 1 stage.";
    else if (remaining === 4) text = "Your Turn: Ban 2 stages (1st Ban).";
    else if (remaining === 3) text = "Your Turn: Ban 2 stages (2nd Ban).";
  } else {
    if (remaining === 2) text = "Waiting for Opponent to PICK the stage...";
    else text = `Waiting for Opponent (${gameState.turn}) to ban...`;
  }

  el.instructions.textContent = text;
}

function updateSubsequentGameInstructions() {
  let text = "";
  if (myRole === gameState.turn) {
    if (myRole === "banner") {
      text = `Your Turn: Ban ${3 - gameState.banCount} more stages.`;
    } else {
      text = "Your Turn: Pick one stage from the remaining list.";
    }
  } else {
    if (gameState.turn === "banner") {
      text = "Waiting for Opponent to ban 3 stages...";
    } else {
      text = "Waiting for Opponent to pick a stage...";
    }
  }
  el.instructions.textContent = text;
}

function onStageClick(stage) {
  if (gameState.type === "game1") {
    runGame1Logic(stage, "me");
  } else {
    runSubsequentGameLogic(stage, "me");
  }
}

function showFinalStage(stage) {
  gameState.finalStage = stage;
  saveState();

  el.stageArea.classList.add("hidden");
  el.finalStageArea.classList.remove("hidden");
  el.finalStageName.textContent = stage;

  // Show stock tracker at this point
  el.stockArea.classList.remove("hidden");
  setStockUI();
}

// ===============================
// 9. CREW BATTLE STOCK TRACKER
// ===============================
function setStockUI() {
  el.homeTeamLabel.textContent = gameState.teamNames.home;
  el.awayTeamLabel.textContent = gameState.teamNames.away;

  el.homeTeamStocks.textContent = gameState.crew.homeStocks;
  el.awayTeamStocks.textContent = gameState.crew.awayStocks;

  el.homePlayerStocks.textContent = gameState.crew.homePlayerStocks;
  el.awayPlayerStocks.textContent = gameState.crew.awayPlayerStocks;

  el.stockHeader.textContent = `Crew Battle – Round ${gameState.crew.round}`;
}

function changeStock(team) {
  if (team === "home") {
    if (gameState.crew.homeStocks <= 0) return;
    gameState.crew.homeStocks--;
    gameState.crew.homePlayerStocks--;
    if (gameState.crew.homePlayerStocks <= 0 && gameState.crew.homeStocks > 0) {
      gameState.crew.homePlayerStocks = 3; // next player
    }
  } else {
    if (gameState.crew.awayStocks <= 0) return;
    gameState.crew.awayStocks--;
    gameState.crew.awayPlayerStocks--;
    if (gameState.crew.awayPlayerStocks <= 0 && gameState.crew.awayStocks > 0) {
      gameState.crew.awayPlayerStocks = 3; // next player
    }
  }

  sendData({ type: "stock-update", crew: gameState.crew });
  setStockUI();
  saveState();
}

function nextRound() {
  gameState.crew.round++;
  gameState.crew.homeStocks = 12;
  gameState.crew.awayStocks = 12;
  gameState.crew.homePlayerStocks = 3;
  gameState.crew.awayPlayerStocks = 3;

  setStockUI();
  saveState();
}

// Stock button bindings
if (el.homeMinusStock) {
  el.homeMinusStock.onclick = () => changeStock("home");
}
if (el.awayMinusStock) {
  el.awayMinusStock.onclick = () => changeStock("away");
}
if (el.finishRoundBtn) {
  el.finishRoundBtn.onclick = () => {
    sendData({ type: "finish-round" });
    nextRound();
  };
}

// ===============================
// 10. APP FLOW CONTROL
// ===============================
el.nextGameBtn.addEventListener("click", () => {
  sendData({ type: "next_game" });
  setupNextGameUI();
});

el.rematchBtn.addEventListener("click", () => {
  sendData({ type: "rematch" });
  resetToGame1Setup();
});

function handleMessage(data) {
  switch (data.type) {
    case "setup":
      myRole = data.role;
      if (data.game === "game1") {
        initGame1(myRole);
      } else if (data.game === "subsequent") {
        initSubsequentGame(myRole);
      }
      break;

    case "ban":
      if (gameState.type === "game1") {
        runGame1Logic(data.stage, "opponent");
      } else {
        runSubsequentGameLogic(data.stage, "opponent");
      }
      break;

    case "pick":
      showFinalStage(data.stage);
      break;

    case "next_game":
      setupNextGameUI();
      break;

    case "rematch":
      resetToGame1Setup();
      break;

    case "team-names":
      gameState.teamNames = data.names;
      applyTeamNamesToInputs();
      setStockUI();
      saveState();
      break;

    case "stock-update":
      gameState.crew = data.crew;
      setStockUI();
      saveState();
      break;

    case "finish-round":
      nextRound();
      break;
  }
}

function setupNextGameUI() {
  myRole = "";
  gameState.type = "";
  gameState.available = [];
  gameState.bans = [];
  gameState.turn = "";
  gameState.banCount = 0;
  gameState.finalStage = null;
  saveState();

  el.finalStageArea.classList.add("hidden");
  el.stageArea.classList.add("hidden");
  el.stockArea.classList.add("hidden");
  el.setupArea.classList.remove("hidden");

  if (isHost) {
    el.initialSetup.classList.add("hidden");
    el.subsequentSetup.classList.remove("hidden");
  } else {
    el.initialSetup.classList.add("hidden");
    el.subsequentSetup.classList.add("hidden");
    el.setupStatus.textContent = "Waiting for Host to set up Game...";
  }
}

function resetToGame1Setup() {
  myRole = "";
  gameState = createDefaultGameState();
  saveState();

  el.finalStageArea.classList.add("hidden");
  el.stageArea.classList.add("hidden");
  el.stockArea.classList.add("hidden");
  el.setupArea.classList.remove("hidden");

  if (isHost) {
    el.initialSetup.classList.remove("hidden");
    el.subsequentSetup.classList.add("hidden");
    el.rolePrompt.classList.add("hidden");
  } else {
    el.initialSetup.classList.add("hidden");
    el.subsequentSetup.classList.add("hidden");
    el.rolePrompt.classList.add("hidden");
    el.setupStatus.textContent = "Waiting for Host to start the match...";
  }
}

// ===============================
// 11. RESTORE FROM URL/STORAGE
// ===============================
window.addEventListener("load", () => {
  const hashState = loadStateFromHash();
  const storedState = loadStateFromStorage();
  const restored = hashState || storedState;

  if (restored) {
    // merge into default
    gameState = {
      ...createDefaultGameState(),
      ...restored
    };
  }

  applyTeamNamesToInputs();
  updateShareUrl();

  // If opened as a spectator (no connection) and finalStage exists:
  if (!peer && !conn && gameState.finalStage) {
    el.connArea.classList.add("hidden");
    el.teamNameArea?.classList.add("hidden");
    el.setupArea.classList.add("hidden");
    el.stageArea.classList.add("hidden");
    el.finalStageArea.classList.remove("hidden");
    el.finalStageName.textContent = gameState.finalStage;
    el.stockArea.classList.remove("hidden");
    setStockUI();
  }
});
