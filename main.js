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
// NOTE: These metered.ca TURN credentials are visible to anyone who views this
// page's source (a static site can't hide them). They are fine to use, but if
// they ever stop working or get abused, sign up for your own free metered.ca
// account and paste your own username/credential here.
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

// Timings (ms)
const CONNECT_TIMEOUT = 15000;   // give up on a first join attempt after this
const HEARTBEAT_EVERY = 2000;    // ping the other device this often
const HEARTBEAT_STALE = 7000;    // this much silence = "paused" (keep link, re-dial)
const HEARTBEAT_DEAD = 45000;    // this much silence = link is dead, drop it
const PROBE_EVERY = 2500;        // re-dial the host this often while paused
const DIAL_TIMEOUT = 8000;       // give each re-dial this long to open
const RETRY_MAX_DELAY = 5000;    // cap for reconnect backoff

// ===============================
// 2. GLOBAL STATE + LOCAL STORAGE
// ===============================
//
// How syncing works:
// - The device that clicked "Create Room" is the HOST. The host owns the one
//   true copy of the match state.
// - Every button press on either device becomes an "action". The host checks
//   it (is it your turn? is that stage still open?) and applies it, then sends
//   the full state to the other device, which simply displays it.
// - Both devices save the room + their side in localStorage, so a refresh or
//   dropped connection rejoins the same room automatically.

const PERSIST_KEY = "ssbu_stage_state_v5"; // bump version to avoid old schema conflicts
const SESSION_KEY = "ssbu_session_v1";

function createDefaultCrew() {
  // Crew battle: 4 players per team, each starting with 3 stocks
  return {
    homePlayers: [3, 3, 3, 3], // Player 1–4 stocks
    awayPlayers: [3, 3, 3, 3],
    homeCurrent: 0,            // index 0..3 (4 = eliminated)
    awayCurrent: 0,
    round: 1,
    winner: null               // null | 'home' | 'away'
  };
}

function createDefaultGameState() {
  return {
    seq: 0,                 // bumps on every change
    phase: "teams",         // 'teams' | 'setup' | 'striking' | 'final'
    setupMode: "game1",     // which setup screen: 'game1' | 'subsequent'
    type: "",               // '', 'game1', 'subsequent'
    gameNumber: 0,
    available: [],
    bans: [],
    turn: "",               // 'striker_1' | 'striker_2' | 'banner' | 'picker'
    roles: {},              // role -> 'host' | 'client'
    banCount: 0,
    finalStage: null,
    history: [],            // [{ game, stage }] stages picked earlier in this set

    teamNames: { home: "Home", away: "Away" },
    crew: createDefaultCrew()
  };
}

function normalizeState(s) {
  const base = createDefaultGameState();
  if (!s || typeof s !== "object") return base;
  const out = { ...base, ...s };
  out.teamNames = { ...base.teamNames, ...(s.teamNames || {}) };
  out.crew = { ...createDefaultCrew(), ...(s.crew || {}) };
  out.roles = { ...(s.roles || {}) };
  out.available = Array.isArray(s.available) ? [...s.available] : [];
  out.bans = Array.isArray(s.bans) ? [...s.bans] : [];
  out.history = Array.isArray(s.history) ? [...s.history] : [];
  return out;
}

let gameState = createDefaultGameState();
let session = null; // { side: 'host' | 'client', roomId }

function saveState() {
  try { localStorage.setItem(PERSIST_KEY, JSON.stringify(gameState)); } catch (e) {}
}

function loadState() {
  try {
    gameState = normalizeState(JSON.parse(localStorage.getItem(PERSIST_KEY)));
  } catch (e) {
    gameState = createDefaultGameState();
  }
}

function saveSession() {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s && (s.side === "host" || s.side === "client") && typeof s.roomId === "string") {
      session = s;
    }
  } catch (e) {
    session = null;
  }
}

function mySide() { return session ? session.side : null; }
function otherSide(side) { return side === "host" ? "client" : "host"; }

// ===============================
// 3. DOM ELEMENTS
// ===============================

const el = {
  netBanner: document.getElementById("net-banner"),
  matchHistory: document.getElementById("match-history"),
  connArea: document.getElementById("connection-area"),
  connStatus: document.getElementById("conn-status"),
  connError: document.getElementById("conn-error"),
  hostControls: document.getElementById("host-controls"),
  hostBtn: document.getElementById("host-btn"),
  roomId: document.getElementById("room-id"),
  roomHint: document.getElementById("room-hint"),
  clientControls: document.getElementById("client-controls"),
  joinIdInput: document.getElementById("join-id-input"),
  joinBtn: document.getElementById("join-btn"),
  leaveBtn: document.getElementById("leave-btn"),

  teamNameArea: document.getElementById("team-name-area"),
  homeTeamInput: document.getElementById("home-team-input"),
  awayTeamInput: document.getElementById("away-team-input"),
  saveTeamNamesBtn: document.getElementById("save-team-names"),

  setupArea: document.getElementById("game-setup-area"),
  initialSetup: document.getElementById("initial-setup"),
  game1Btn: document.getElementById("game-1-btn"),
  subsequentSetup: document.getElementById("subsequent-setup"),
  iWonBtn: document.getElementById("host-won"),             // "I Won (I Ban)"
  opponentWonBtn: document.getElementById("client-won"),    // "Opponent Won (I Pick)"
  rolePrompt: document.getElementById("role-prompt"),
  iBanFirstBtn: document.getElementById("host-strikes-first"),        // "I Ban First"
  opponentBansFirstBtn: document.getElementById("client-strikes-first"), // "Opponent Bans First"
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
  finishRoundBtn: document.getElementById("finish-round"),
  crewResetBtn: document.getElementById("crew-reset")
};

// ===============================
// 4. FRIENDLY ERROR MESSAGES
// ===============================

const FRIENDLY_ERRORS = {
  "peer-unavailable": "Room not found. Double-check the Room ID, and make sure the other coach still has the page open.",
  "unavailable-id": "That room is still closing from before. Retrying…",
  "invalid-id": "That Room ID isn't valid. It should look like ssbu-abc123.",
  "network": "Can't reach the connection server. Check your internet connection.",
  "server-error": "The connection server is having trouble. Trying again…",
  "socket-error": "Lost contact with the connection server. Trying again…",
  "socket-closed": "Lost contact with the connection server. Trying again…",
  "disconnected": "Lost contact with the connection server. Trying again…",
  "browser-incompatible": "This browser doesn't support live connections. Try the latest Chrome, Edge, Firefox, or Safari.",
  "webrtc": "The direct connection failed. A school network or firewall may be blocking it.",
  "negotiation-failed": "The direct connection failed. A school network or firewall may be blocking it.",
  "connection-closed": "The connection closed."
};

const TIMEOUT_MSG =
  "Couldn't connect to that room. Check the Room ID. If it's correct, a school network or firewall may be blocking the connection — try another network (e.g. a phone hotspot) or ask IT to allow WebRTC.";

function friendlyError(err) {
  const type = err && err.type;
  return FRIENDLY_ERRORS[type] || "Connection problem. Please try again.";
}

// ===============================
// 5. VIEW / TAB SYSTEM
// ===============================
// view: 'connect' | 'teams' | 'flow' (current step of the match) | 'stocks'

let view = "connect";
let showRolePrompt = false;     // local: after clicking "Start Match (Game 1)"
let pendingAction = false;      // client: waiting for host to confirm a click
let pendingTimer = null;
let namesDirty = { home: false, away: false };
let netStatus = { state: "idle", text: "" }; // idle|connecting|waiting|connected|reconnecting|error
let connError = "";

const FLOW_SECTIONS = {
  teams: "team-name-area",
  setup: "game-setup-area",
  striking: "stage-select-area",
  final: "final-stage"
};

function showSection(id) {
  document.querySelectorAll(".screen-section").forEach(sec =>
    sec.classList.toggle("hidden", sec.id !== id)
  );
}

document.querySelectorAll("#tabs .tab").forEach(tab => {
  tab.addEventListener("click", () => {
    if (tab.classList.contains("disabled")) return;
    view = tab.dataset.view;
    render();
  });
});

function isConnected() { return !!(conn && conn.open); }
function canAct() { return isConnected() && !linkPaused && !pendingAction; }

function setPending(on) {
  pendingAction = on;
  clearTimeout(pendingTimer);
  if (on) {
    // Safety net: never leave buttons locked forever.
    pendingTimer = setTimeout(() => { pendingAction = false; render(); }, 5000);
  }
}

function render() {
  renderBanner();
  renderTabs();
  renderConnection();
  renderTeams();
  renderSetup();
  renderStages();
  renderFinal();
  setStockUI();
  renderHistory();

  let sectionId;
  if (!session || view === "connect") sectionId = "connection-area";
  else if (view === "teams") sectionId = "team-name-area";
  else if (view === "stocks") sectionId = "stock-area";
  else sectionId = FLOW_SECTIONS[gameState.phase] || "game-setup-area";
  showSection(sectionId);
}

function renderHistory() {
  const h = gameState.history || [];
  const show = !!session && h.length > 0;
  el.matchHistory.classList.toggle("hidden", !show);
  if (show) {
    el.matchHistory.textContent =
      "This set: " + h.map(x => `Game ${x.game} – ${x.stage}`).join(" · ");
  }
}

function renderTabs() {
  document.querySelectorAll("#tabs .tab").forEach(tab => {
    const v = tab.dataset.view;
    tab.classList.toggle("disabled", v !== "connect" && !session);
    let active = v === view;
    if (view === "flow" && gameState.phase === "teams") active = v === "teams";
    if (!session) active = v === "connect";
    tab.classList.toggle("active", active);
  });
}

function renderBanner() {
  if (!session && netStatus.state !== "connecting") {
    el.netBanner.classList.add("hidden");
    return;
  }
  el.netBanner.classList.remove("hidden");
  el.netBanner.className = "net-banner " + netStatus.state;
  const room = session ? ` · Room ${session.roomId}` : "";
  el.netBanner.textContent = (netStatus.text || "") + room;
}

function renderConnection() {
  const inRoom = !!session;
  const busy = netStatus.state === "connecting";

  el.connStatus.textContent = inRoom
    ? (isConnected() ? "Connected!" : (netStatus.text || "Reconnecting…"))
    : (busy ? netStatus.text : "1. Connect to Opponent");

  el.hostBtn.classList.toggle("hidden", inRoom);
  el.hostBtn.disabled = busy;
  el.joinBtn.disabled = busy;
  el.clientControls.classList.toggle("hidden", inRoom);
  el.roomId.textContent = inRoom ? session.roomId : "...";
  el.roomHint.classList.toggle("hidden", !(inRoom && mySide() === "host"));
  el.leaveBtn.classList.toggle("hidden", !inRoom);

  el.connError.textContent = connError;
  el.connError.classList.toggle("hidden", !connError);
}

// ===============================
// 6. TEAM NAMES
// ===============================

el.homeTeamInput.addEventListener("input", () => { namesDirty.home = true; });
el.awayTeamInput.addEventListener("input", () => { namesDirty.away = true; });

function renderTeams() {
  // Show the other device's names unless you're in the middle of editing.
  if (!namesDirty.home) el.homeTeamInput.value = gameState.teamNames.home;
  if (!namesDirty.away) el.awayTeamInput.value = gameState.teamNames.away;
  el.saveTeamNamesBtn.textContent =
    gameState.phase === "teams" ? "Save & Continue" : "Save Names";
  el.saveTeamNamesBtn.disabled = !canAct();
}

el.saveTeamNamesBtn.onclick = () => {
  const home = el.homeTeamInput.value.trim() || "Home";
  const away = el.awayTeamInput.value.trim() || "Away";
  namesDirty = { home: false, away: false };
  view = "flow";
  requestAction({ kind: "team-names", home, away });
};

// ===============================
// 7. GAME SETUP (host decides; the other side's clicks are requests)
// ===============================

function renderSetup() {
  const mode = gameState.setupMode;
  el.initialSetup.classList.toggle("hidden", mode !== "game1" || showRolePrompt);
  el.rolePrompt.classList.toggle("hidden", mode !== "game1" || !showRolePrompt);
  el.subsequentSetup.classList.toggle("hidden", mode !== "subsequent");
  el.setupStatus.textContent =
    mode === "game1" ? "3. Game Setup" : `3. Game ${gameState.gameNumber + 1} Setup`;

  const disabled = !canAct();
  [el.game1Btn, el.iBanFirstBtn, el.opponentBansFirstBtn, el.iWonBtn, el.opponentWonBtn]
    .forEach(b => { b.disabled = disabled; });
}

el.game1Btn.onclick = () => {
  showRolePrompt = true;
  render();
};

el.iBanFirstBtn.onclick = () =>
  requestAction({ kind: "start-game1", firstSide: mySide() });

el.opponentBansFirstBtn.onclick = () =>
  requestAction({ kind: "start-game1", firstSide: otherSide(mySide()) });

el.iWonBtn.onclick = () =>
  requestAction({ kind: "start-next", winnerSide: mySide() });

el.opponentWonBtn.onclick = () =>
  requestAction({ kind: "start-next", winnerSide: otherSide(mySide()) });

// ===============================
// 8. ACTIONS (all game changes go through here)
// ===============================

const processedActionIds = new Set();

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Called by button handlers on either device.
function requestAction(action) {
  if (!canAct()) return;
  action.id = makeId();
  if (mySide() === "host") {
    applyAction(action, "host");
  } else {
    setPending(true);
    render(); // lock buttons immediately
    sendData({ type: "action", action });
  }
}

// HOST ONLY: validate + apply an action, then broadcast the new state.
function applyAction(action, fromSide) {
  if (!action || typeof action !== "object") return false;
  if (action.id) {
    if (processedActionIds.has(action.id)) return false; // duplicate
    processedActionIds.add(action.id);
    if (processedActionIds.size > 500) processedActionIds.clear();
  }

  const before = JSON.stringify(gameState);
  const prevPhase = gameState.phase;
  const prevGame = gameState.gameNumber;

  const ok = runAction(action, fromSide);
  if (!ok || JSON.stringify(gameState) === before) return false;

  gameState.seq++;
  onStateChanged(prevPhase, prevGame);
  saveState();
  sendSnapshot();
  render();
  return true;
}

function cleanName(v, fallback) {
  return (typeof v === "string" ? v.trim().slice(0, 40) : "") || fallback;
}

function runAction(a, fromSide) {
  const s = gameState;
  switch (a.kind) {
    case "team-names":
      s.teamNames = {
        home: cleanName(a.home, "Home"),
        away: cleanName(a.away, "Away")
      };
      if (s.phase === "teams") {
        s.phase = "setup";
        s.setupMode = "game1";
      }
      return true;

    case "start-game1": {
      if (s.phase !== "setup" || s.setupMode !== "game1") return false;
      if (a.firstSide !== "host" && a.firstSide !== "client") return false;
      s.type = "game1";
      s.gameNumber = 1;
      s.roles = { striker_1: a.firstSide, striker_2: otherSide(a.firstSide) };
      s.available = [...STARTERS];
      s.bans = [];
      s.banCount = 0;
      s.turn = "striker_1";
      s.finalStage = null;
      s.phase = "striking";
      return true;
    }

    case "start-next": {
      if (s.phase !== "setup" || s.setupMode !== "subsequent") return false;
      if (a.winnerSide !== "host" && a.winnerSide !== "client") return false;
      s.type = "subsequent";
      s.gameNumber = (s.gameNumber || 1) + 1;
      s.roles = { banner: a.winnerSide, picker: otherSide(a.winnerSide) };
      s.available = [...FULL_STAGE_LIST];
      s.bans = [];
      s.banCount = 0;
      s.turn = "banner";
      s.finalStage = null;
      s.phase = "striking";
      return true;
    }

    case "strike":
      return runStrike(a.stage, fromSide);

    case "next-game":
      if (s.phase !== "final") return false;
      s.phase = "setup";
      s.setupMode = "subsequent";
      s.type = "";
      s.available = [];
      s.bans = [];
      s.banCount = 0;
      s.turn = "";
      s.roles = {};
      s.finalStage = null;
      return true;

    case "rematch": {
      // New set: keep team names, back to the Game 1 setup screen.
      const names = s.teamNames;
      const seq = s.seq;
      gameState = createDefaultGameState();
      gameState.teamNames = names;
      gameState.seq = seq;
      gameState.phase = "setup";
      gameState.setupMode = "game1";
      return true;
    }

    case "crew-minus":
      return adjustStock(a.team);

    case "crew-round":
      if (s.crew.winner) return false;
      s.crew.round++;
      return true;

    case "crew-reset":
      s.crew = createDefaultCrew();
      return true;
  }
  return false;
}

// Stage ban/pick. Rules unchanged:
// Game 1: 5 starters, striker 1 bans 1, striker 2 bans 2, striker 1 picks from the last 2.
// Later games: winner (banner) bans 3 of 10, loser (picker) picks.
function runStrike(stage, fromSide) {
  const s = gameState;
  if (s.phase !== "striking") return false;
  if (s.roles[s.turn] !== fromSide) return false;          // not your turn
  if (!s.available.includes(stage)) return false;          // already gone / bogus

  if (s.type === "game1") {
    if (s.available.length === 2) {                        // FINAL PICK
      s.finalStage = stage;
      s.phase = "final";
      s.history.push({ game: s.gameNumber, stage });
      return true;
    }
    s.bans.push(stage);
    s.available = s.available.filter(x => x !== stage);
    const r = s.available.length;
    if (r === 4 || r === 3) s.turn = "striker_2";
    else if (r === 2) s.turn = "striker_1";
    return true;
  }

  if (s.type === "subsequent") {
    if (s.banCount < 3) {
      s.bans.push(stage);
      s.available = s.available.filter(x => x !== stage);
      s.banCount++;
      s.turn = s.banCount < 3 ? "banner" : "picker";
    } else {
      s.finalStage = stage;
      s.phase = "final";
      s.history.push({ game: s.gameNumber, stage });
    }
    return true;
  }
  return false;
}

// When the match moves to a new step, bring both devices to it.
function onStateChanged(prevPhase, prevGame) {
  if (gameState.phase !== prevPhase || gameState.gameNumber !== prevGame) {
    view = "flow";
    showRolePrompt = false;
  }
}

// ===============================
// 9. UI: STAGES
// ===============================

const ROLE_LABELS = {
  striker_1: "Striker 1", striker_2: "Striker 2", banner: "Banning", picker: "Picking"
};

function renderStages() {
  el.starterList.innerHTML = "";
  el.counterpickList.innerHTML = "";
  if (!gameState.type) {
    el.instructions.textContent = "Waiting for setup...";
    el.counterpickList.parentElement.classList.add("hidden");
    return;
  }

  const list = gameState.type === "game1" ? STARTERS : FULL_STAGE_LIST;
  const myTurn = gameState.phase === "striking" &&
    gameState.roles[gameState.turn] === mySide();
  const clickable = myTurn && canAct();

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
    } else if (clickable && gameState.available.includes(stage)) {
      btn.classList.add("selectable");
      btn.onclick = () => {
        // Lock every stage button right away (no double clicks).
        document.querySelectorAll(".stage-btn").forEach(b => { b.disabled = true; });
        requestAction({ kind: "strike", stage });
      };
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

  el.instructions.textContent = stageInstructions(myTurn);
}

function stageInstructions(myTurn) {
  const text = turnText(myTurn);
  if (gameState.phase !== "final" && (!isConnected() || linkPaused)) {
    return text + " — paused until the connection is back (the board below is the last known state).";
  }
  return text;
}

function turnText(myTurn) {
  if (gameState.phase === "final") return `Stage selected: ${gameState.finalStage}`;

  const myRoles = Object.keys(gameState.roles).filter(r => gameState.roles[r] === mySide());
  const who = myRoles.length ? ` (You: ${ROLE_LABELS[myRoles[0]]})` : "";

  if (gameState.type === "game1") {
    const remaining = gameState.available.length;
    if (myTurn) {
      if (remaining === 2) return "Final Step: PICK the stage." + who;
      if (remaining === 5) return "Your Turn: Ban 1 stage." + who;
      if (remaining === 4) return "Your Turn: Ban 2 stages." + who;
      return "Your Turn: Ban 1 more stage." + who;
    }
    if (remaining === 2) return "Opponent is picking the final stage..." + who;
    return "Waiting for opponent..." + who;
  }

  if (myTurn) {
    return (gameState.banCount < 3
      ? `Ban ${3 - gameState.banCount} more stage(s).`
      : "Pick one stage.") + who;
  }
  return (gameState.banCount < 3
    ? "Waiting for opponent to ban..."
    : "Waiting for opponent to pick...") + who;
}

// ===============================
// 10. FINAL STAGE
// ===============================

function renderFinal() {
  el.finalStageName.textContent = gameState.finalStage || "";
  el.nextGameBtn.disabled = !canAct();
  el.rematchBtn.disabled = !canAct();
}

el.nextGameBtn.onclick = () => requestAction({ kind: "next-game" });
el.rematchBtn.onclick = () => requestAction({ kind: "rematch" });

// ===============================
// 11. CREW BATTLE (4 PLAYERS / TEAM)
// ===============================

function totalStocks(arr) {
  return arr.reduce((sum, s) => sum + Math.max(0, s), 0);
}

function setStockUI() {
  const c = gameState.crew;
  const homeArr = c.homePlayers;
  const awayArr = c.awayPlayers;

  const homeTotal = totalStocks(homeArr);
  const awayTotal = totalStocks(awayArr);

  const homeOut = c.homeCurrent >= homeArr.length || homeTotal === 0;
  const awayOut = c.awayCurrent >= awayArr.length || awayTotal === 0;

  const homeCurrentStocks = homeOut ? 0 : homeArr[c.homeCurrent];
  const awayCurrentStocks = awayOut ? 0 : awayArr[c.awayCurrent];

  const homeStatus = homeOut ? "Eliminated" : `Player ${c.homeCurrent + 1}/4`;
  const awayStatus = awayOut ? "Eliminated" : `Player ${c.awayCurrent + 1}/4`;

  el.homeTeamLabel.textContent = `${gameState.teamNames.home} (${homeStatus})`;
  el.awayTeamLabel.textContent = `${gameState.teamNames.away} (${awayStatus})`;

  el.homeTeamStocks.textContent = homeTotal;
  el.awayTeamStocks.textContent = awayTotal;

  el.homePlayerStocks.textContent = homeCurrentStocks;
  el.awayPlayerStocks.textContent = awayCurrentStocks;

  if (c.winner) {
    el.stockHeader.textContent =
      `🏆 ${gameState.teamNames[c.winner]} wins the crew battle!`;
    el.stockHeader.classList.add("winner-text");
  } else {
    el.stockHeader.textContent =
      `Crew Battle – Round ${c.round} | ` +
      `${gameState.teamNames.home} ${homeStatus} vs ` +
      `${gameState.teamNames.away} ${awayStatus}`;
    el.stockHeader.classList.remove("winner-text");
  }

  const locked = !canAct() || !!c.winner;
  el.homeMinusStock.disabled = locked;
  el.awayMinusStock.disabled = locked;
  el.finishRoundBtn.disabled = locked;
  el.crewResetBtn.classList.toggle("hidden", !c.winner);
  el.crewResetBtn.disabled = !canAct();
}

// HOST ONLY (via runAction). One stock off the active player; carry over.
function adjustStock(team) {
  const c = gameState.crew;
  if (team !== "home" && team !== "away") return false;
  if (c.winner) return false;

  const players = team === "home" ? c.homePlayers : c.awayPlayers;
  const curKey = team === "home" ? "homeCurrent" : "awayCurrent";
  const cur = c[curKey];

  if (cur >= players.length) return false;   // already eliminated
  if (players[cur] <= 0) return false;       // cannot go negative

  players[cur]--;
  if (players[cur] === 0) c[curKey] = cur + 1; // next player up (4 = eliminated)

  if (totalStocks(players) === 0) {
    c.winner = team === "home" ? "away" : "home";
  }
  return true;
}

el.homeMinusStock.onclick = () => requestAction({ kind: "crew-minus", team: "home" });
el.awayMinusStock.onclick = () => requestAction({ kind: "crew-minus", team: "away" });
el.finishRoundBtn.onclick = () => requestAction({ kind: "crew-round" });
el.crewResetBtn.onclick = () => requestAction({ kind: "crew-reset" });

// ===============================
// 12. PEERJS CONNECTION (TURN ENABLED, AUTO-RECONNECT)
// ===============================
//
// Phones pause a web page as soon as you switch apps. When that happens we do
// NOT throw the match away: both devices keep showing the last known board,
// the link is marked "paused", and the joining device keeps re-dialing the
// host every couple of seconds. The moment the host's page wakes up it
// re-registers its Room ID and the next re-dial gets through.
//
// If the connection server still holds the host's old (frozen) registration,
// the host temporarily registers as "<room>-b" instead. The joining device
// always dials both names, so it finds the host either way.

let peer = null;
let conn = null;                 // the one live data connection
let pendingConns = new Set();    // dial attempts / incoming links not open yet
let outbox = [];
let retryTimer = null;
let retryAttempt = 0;
let connectTimer = null;
let heartbeatTimer = null;
let probeTimer = null;
let lastSeen = 0;
let linkPaused = false;          // link exists but the other side went quiet
let joiningRoomId = null;        // room being joined for the first time
let unavailableIds = new Set();  // first join: names the server says don't exist
let hostIdIndex = 0;             // 0 = "<room>", 1 = "<room>-b"
let hostIdFlips = 0;
let unhealthySince = 0;          // when the link last went paused/down
let lastIncomingAt = 0;          // host: last time the opponent dialed in
let selfHealAt = 0;              // host: last time we re-opened the room
let selfHealDelay = 10000;
let hadOpponent = false;

const PAUSED_MSG =
  "Opponent's device paused (they may have switched apps or locked their phone) — waiting for them to come back…";

function setNet(state, text) {
  netStatus = { state, text };
  render();
}

function newRoomId() {
  return "ssbu-" + Math.random().toString(36).substring(2, 8);
}

function normalizeRoomId(raw) {
  let id = (raw || "").trim().toLowerCase().replace(/\s+/g, "");
  if (id && !id.startsWith("ssbu-")) id = "ssbu-" + id;
  return id.replace(/-b$/, "");
}

function hostIdsFor(roomId) {
  return [roomId, roomId + "-b"];
}

function closeQuietly(c) {
  if (!c) return;
  pendingConns.delete(c);
  try { c.close(); } catch (e) {}
}

function closePending() {
  [...pendingConns].forEach(closeQuietly);
  pendingConns.clear();
}

function destroyPeer() {
  clearTimeout(connectTimer);
  linkPaused = false;
  stopHeartbeat();
  stopProbing();
  closePending();
  const c = conn;
  conn = null;
  closeQuietly(c);
  const p = peer;
  peer = null;
  if (p) { try { p.destroy(); } catch (e) {} }
}

function scheduleRetry(fn) {
  clearTimeout(retryTimer);
  const delay = Math.min(RETRY_MAX_DELAY, 1000 * Math.pow(2, retryAttempt));
  retryAttempt++;
  retryTimer = setTimeout(fn, delay);
}

// ---------- HOST ----------
// resume = true when re-opening a room we already own (refresh / drop / wake).
function startHost(roomId, resume, idIndex = 0) {
  clearTimeout(retryTimer);
  destroyPeer();
  hostIdIndex = idIndex;

  const p = new Peer(hostIdsFor(roomId)[idIndex], { config: ICE_CONFIG });
  peer = p;

  p.on("open", () => {
    if (p !== peer) return;
    retryAttempt = 0;
    hostIdFlips = 0;
    connError = "";
    session = { side: "host", roomId };
    saveSession();
    if (!resume) {
      view = "connect";
      setNet("waiting", "Room created — waiting for opponent to join…");
    } else if (!isConnected()) {
      setNet("waiting", "Back online — waiting for opponent to reconnect…");
    } else {
      setNet("connected", "Connected to opponent");
    }
  });

  p.on("connection", c => {
    if (p !== peer) return;
    lastIncomingAt = Date.now();
    wireConnection(c);
  });

  p.on("disconnected", () => {
    // Lost the connection server (not necessarily the opponent).
    if (p !== peer || p.destroyed) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (p === peer && !p.destroyed && p.disconnected) p.reconnect();
    }, Math.min(5000, 1000 * Math.pow(2, Math.min(retryAttempt++, 3))));
  });

  p.on("error", err => {
    if (p !== peer) return;
    if (err.type === "unavailable-id") {
      if (!resume && !session) {
        startHost(newRoomId(), false); // brand-new room collided; pick another ID
        return;
      }
      if (isConnected() && !linkPaused) {
        // The data link to the opponent still works; keep it. Try the
        // server again later.
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (p === peer && !p.destroyed && p.disconnected) p.reconnect();
        }, 5000);
        return;
      }
      // Our frozen old registration hasn't expired yet. Use the other name.
      setNet("reconnecting", "Re-opening your room…");
      hostIdFlips++;
      const next = 1 - idIndex;
      if (hostIdFlips <= 2) startHost(roomId, true, next);
      else { destroyPeer(); scheduleRetry(() => startHost(roomId, true, next)); }
      return;
    }
    if (err.type === "peer-unavailable") return; // not relevant for the host

    if (!session) {
      destroyPeer();
      connError = friendlyError(err);
      setNet("error", connError);
      return;
    }
    if (p.destroyed) {
      setNet("reconnecting", friendlyError(err));
      scheduleRetry(() => startHost(roomId, true, hostIdIndex));
    }
    // otherwise the "disconnected" handler re-registers
  });
}

// ---------- CLIENT ----------
// One Peer per page; it keeps re-dialing the host while the link is down.
function startClient(roomId) {
  clearTimeout(retryTimer);
  destroyPeer();
  unavailableIds = new Set();

  const p = new Peer(undefined, { config: ICE_CONFIG });
  peer = p;

  p.on("open", () => {
    if (p !== peer) return;
    retryAttempt = 0;
    if (!session) {
      // First join: dial and give up after a while.
      dialHost(roomId);
      clearTimeout(connectTimer);
      connectTimer = setTimeout(() => {
        if (p !== peer || isConnected()) return;
        firstJoinFailed(TIMEOUT_MSG);
      }, CONNECT_TIMEOUT);
    } else if (!isConnected() || linkPaused) {
      probeNow();
    }
  });

  p.on("disconnected", () => {
    if (p !== peer || p.destroyed) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (p === peer && !p.destroyed && p.disconnected) p.reconnect();
    }, 1000);
  });

  p.on("error", err => {
    if (p !== peer) return;
    if (err.type === "peer-unavailable") {
      if (!session) {
        const m = /peer\s+(\S+)/i.exec(err.message || "");
        if (m) unavailableIds.add(m[1].replace(/[.,]$/, ""));
        const ids = hostIdsFor(roomId);
        if (ids.every(id => unavailableIds.has(id))) firstJoinFailed(FRIENDLY_ERRORS["peer-unavailable"]);
      }
      const m2 = /peer\s+(\S+)/i.exec(err.message || "");
      if (m2) dropDialsTo(m2[1].replace(/[.,]$/, ""));
      return; // during reconnects: host not back yet; the next re-dial retries
    }
    if (!session) {
      firstJoinFailed(friendlyError(err));
      return;
    }
    if (p.destroyed) {
      // Peer is unusable: build a new one (keeps showing the last state).
      peer = null;
      scheduleRetry(() => startClient(roomId));
    }
  });
}

function firstJoinFailed(message) {
  destroyPeer();
  joiningRoomId = null;
  connError = message;
  setNet("error", message);
}

// Dial both possible host names; whichever opens first wins.
// Each name gets its own attempt; a still-running attempt (setting up through
// a relay can take several seconds) is left alone, a stale one is replaced.
function dialHost(roomId) {
  if (!peer || peer.destroyed || peer.disconnected) return;
  const now = Date.now();
  hostIdsFor(roomId).forEach(id => {
    const inFlight = [...pendingConns].filter(x => x.peer === id);
    const stillGoing = x => {
      const age = now - (x._dialedAt || 0);
      const answered = !!(x.peerConnection && x.peerConnection.remoteDescription);
      // Host answered: give it time to finish. No answer yet: re-dial soon
      // (the host may have only just come back online).
      return answered ? age < DIAL_TIMEOUT : age < PROBE_EVERY - 200;
    };
    if (inFlight.some(stillGoing)) return;
    inFlight.forEach(closeQuietly);
    let c;
    try { c = peer.connect(id, { reliable: true }); } catch (e) { return; }
    if (!c) return;
    c._dialedAt = now;
    wireConnection(c);
    setTimeout(() => { if (pendingConns.has(c)) closeQuietly(c); }, DIAL_TIMEOUT);
  });
}

// The server says nobody is registered under that name (yet): drop that
// attempt so the next re-dial can try again right away.
function dropDialsTo(id) {
  [...pendingConns].filter(x => x.peer === id).forEach(closeQuietly);
}

// Re-dial the host every ~2.5 s until the link is healthy again.
function startProbing() {
  if (mySide() !== "client" || probeTimer) return;
  probeNow();
  probeTimer = setInterval(probeNow, PROBE_EVERY);
}

function stopProbing() {
  clearInterval(probeTimer);
  probeTimer = null;
}

function probeNow() {
  if (!session || mySide() !== "client") return;
  if (isConnected() && !linkPaused) { stopProbing(); return; }
  if (!peer || peer.destroyed) { startClient(session.roomId); return; }
  if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} return; }
  if (!peer.open) return; // still registering; "open" handler will probe
  dialHost(session.roomId);
}

// ---------- SHARED ----------
function wireConnection(c) {
  pendingConns.add(c);

  c.on("open", () => {
    pendingConns.delete(c);
    if (!peer || c.provider !== peer) { closeQuietly(c); return; }
    promote(c);
  });

  c.on("data", data => {
    if (c !== conn) return;
    lastSeen = Date.now();
    if (linkPaused) markHealthy();
    handleMessage(data);
  });

  c.on("close", () => {
    pendingConns.delete(c);
    if (c !== conn) return;
    conn = null;
    onConnectionLost();
  });

  c.on("error", () => {
    pendingConns.delete(c);
    if (c !== conn) return;
    conn = null;
    closeQuietly(c);
    onConnectionLost();
  });
}

// A freshly opened link becomes THE link (replacing any older one).
function promote(c) {
  const old = conn;
  conn = c;
  if (old && old !== c) closeQuietly(old);
  if (mySide() !== "host") closePending(); // other dial attempts no longer needed

  clearTimeout(connectTimer);
  clearTimeout(retryTimer);
  stopProbing();
  retryAttempt = 0;
  lastSeen = Date.now();
  linkPaused = false;
  unhealthySince = 0;
  hadOpponent = true;
  selfHealDelay = 10000;
  connError = "";

  if (!session) {
    // First successful join as client: remember the room.
    session = { side: "client", roomId: joiningRoomId || normalizeRoomId(c.peer) };
    saveSession();
    joiningRoomId = null;
    view = "flow";
  }
  setPending(false);
  startHeartbeat();
  watchIce(c);

  if (mySide() === "host") {
    if (gameState.phase === "teams" || view === "connect") view = "flow";
    sendSnapshot();
  }
  flushOutbox();
  setNet("connected", "Connected to opponent");
}

// The other side went quiet but the link may still recover (e.g. they
// switched apps for a moment). Keep the link, keep the board, re-dial.
function markPaused() {
  if (!linkPaused) {
    linkPaused = true;
    if (!unhealthySince) unhealthySince = Date.now();
    setPending(false);
    setNet("reconnecting", PAUSED_MSG);
  }
  startProbing();
}

function markHealthy() {
  linkPaused = false;
  unhealthySince = 0;
  stopProbing();
  setNet("connected", "Connected to opponent");
}

// Notice trouble within a few seconds without killing a link that may recover.
function watchIce(c) {
  const pc = c.peerConnection;
  if (!pc || !pc.addEventListener) return;
  pc.addEventListener("iceconnectionstatechange", () => {
    if (c !== conn) return;
    const st = pc.iceConnectionState;
    if (st === "failed" || st === "closed") {
      conn = null;
      closeQuietly(c);
      onConnectionLost();
    } else if (st === "disconnected") {
      markPaused();
    } else if ((st === "connected" || st === "completed") && linkPaused &&
               Date.now() - lastSeen < HEARTBEAT_STALE) {
      markHealthy();
    }
  });
}

function onConnectionLost() {
  stopHeartbeat();
  clearTimeout(connectTimer);
  setPending(false);
  linkPaused = false;
  if (!unhealthySince) unhealthySince = Date.now();
  if (!session) {
    // First join: ignore; the join timeout / errors report the problem.
    return;
  }
  if (mySide() === "host") {
    setNet("waiting", PAUSED_MSG);
  } else {
    setNet("reconnecting", PAUSED_MSG);
    startProbing();
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!conn) return;
    const silent = Date.now() - lastSeen;
    if (silent > HEARTBEAT_DEAD) {
      const c = conn;
      conn = null;
      closeQuietly(c);
      onConnectionLost();
      return;
    }
    if (silent > HEARTBEAT_STALE) markPaused();
    if (conn.open) { try { conn.send({ type: "ping" }); } catch (e) {} }
  }, HEARTBEAT_EVERY);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// Messages wait in the outbox until the connection is actually open.
function sendData(msg) {
  if (conn && conn.open) {
    try { conn.send(msg); return; } catch (e) {}
  }
  outbox.push(msg);
}

function flushOutbox() {
  const pending = outbox;
  outbox = [];
  pending.forEach(m => sendData(m));
}

function sendSnapshot() {
  if (mySide() !== "host") return;
  if (conn && conn.open) {
    try { conn.send({ type: "state", state: gameState }); } catch (e) {}
  }
}

// Page woke up (app switched back, screen unlocked, network back):
// check everything right away instead of waiting for timers.
// A 1-second "clock" lets us tell when this page itself was paused.
// (Timers don't run while a phone has the page paused, so a big gap between
// ticks means we just woke up.)
let lastTick = Date.now();
setInterval(() => {
  const gap = Date.now() - lastTick;
  if (gap > 5000) wakeUp(true);
  lastTick = Date.now();
  hostSelfHeal();
}, 1000);

// HOST: if the opponent has been unreachable for a while and none of their
// re-dials are getting through, our server connection is probably stuck
// (e.g. after a Wi-Fi drop). Re-open the room under the other name.
function hostSelfHeal() {
  if (!session || mySide() !== "host") return;
  if (!hadOpponent && gameState.seq === 0) return;
  if (isConnected() && !linkPaused) return;
  const now = Date.now();
  const since = Math.max(unhealthySince || now, lastIncomingAt, selfHealAt);
  if (now - since < selfHealDelay) return;
  selfHealAt = now;
  selfHealDelay = Math.min(20000, selfHealDelay * 2);
  startHost(session.roomId, true, 1 - hostIdIndex);
}

function wakeUp(justSlept) {
  if (!session) return;
  const slept = justSlept === true || Date.now() - lastTick > 5000; // page was frozen
  lastTick = Date.now();
  retryAttempt = 0;
  if (isConnected() && Date.now() - lastSeen > HEARTBEAT_STALE) markPaused();
  const unhealthy = !isConnected() || linkPaused;

  if (mySide() === "host") {
    if (!peer || peer.destroyed) {
      startHost(session.roomId, true, hostIdIndex);
      return;
    }
    if (slept && unhealthy) {
      // After a pause the old server connection is often stuck (the phone's
      // network was suspended), and the server may still be holding our
      // name. Re-open the room right away under the other name; the
      // opponent's device dials both names.
      startHost(session.roomId, true, 1 - hostIdIndex);
      return;
    }
    if (peer.disconnected) {
      try { peer.reconnect(); } catch (e) {}
    }
    if (conn && conn.open) {
      try { conn.send({ type: "ping" }); } catch (e) {}
      sendSnapshot();
    }
  } else {
    if (conn && conn.open) { try { conn.send({ type: "ping" }); } catch (e) {} }
    if (slept && unhealthy) {
      startClient(session.roomId); // fresh registration, then re-dial
    } else if (unhealthy) {
      probeNow();
    }
  }
}

// ===============================
// 13. MESSAGE HANDLER
// ===============================

function handleMessage(data) {
  if (!data || typeof data !== "object") return;

  switch (data.type) {
    case "ping":
      return;

    case "going-away": { // other page is refreshing/closing: drop now, rejoin fast
      const c = conn;
      conn = null;
      closeQuietly(c);
      retryAttempt = 0;
      onConnectionLost();
      return;
    }

    case "state": // host -> client: full authoritative state
      if (mySide() !== "client") return;
      adoptState(data.state);
      return;

    case "action": // client -> host: request
      if (mySide() !== "host") return;
      if (!applyAction(data.action, "client")) sendSnapshot(); // resync on reject
      return;

    case "bye":
      if (mySide() === "client") {
        leaveRoom("The host closed the room.");
      } else {
        setNet("waiting", "Opponent left the room — waiting for someone to join…");
      }
      return;
  }
}

function adoptState(s) {
  const prevPhase = gameState.phase;
  const prevGame = gameState.gameNumber;
  gameState = normalizeState(s);
  setPending(false);
  onStateChanged(prevPhase, prevGame);
  saveState();
  render();
}

// ===============================
// 14. CONNECT / JOIN / LEAVE BUTTONS
// ===============================

el.hostBtn.onclick = () => {
  if (session) return;
  connError = "";
  gameState = createDefaultGameState();
  namesDirty = { home: false, away: false };
  saveState();
  netStatus = { state: "connecting", text: "Creating room…" };
  render();
  startHost(newRoomId(), false);
};

el.joinBtn.onclick = () => {
  if (session) return;
  const joinId = normalizeRoomId(el.joinIdInput.value);
  if (!joinId) {
    connError = "Enter the Room ID the other coach gave you.";
    render();
    return;
  }
  el.joinIdInput.value = joinId;
  connError = "";
  gameState = createDefaultGameState();
  namesDirty = { home: false, away: false };
  retryAttempt = 0;
  netStatus = { state: "connecting", text: "Connecting to " + joinId + "…" };
  render();
  joiningRoomId = joinId;
  startClient(joinId);
};

el.joinIdInput.addEventListener("keydown", e => {
  if (e.key === "Enter") el.joinBtn.click();
});

el.leaveBtn.onclick = () => {
  if (!confirm("Leave this room? The match on this device will be cleared.")) return;
  leaveRoom("");
};

function leaveRoom(message) {
  if (conn && conn.open) { try { conn.send({ type: "bye" }); } catch (e) {} }
  clearTimeout(retryTimer);
  const p = peer;
  // Give the "bye" a moment to go out before tearing down.
  peer = null;
  const c = conn;
  conn = null;
  stopHeartbeat();
  stopProbing();
  closePending();
  joiningRoomId = null;
  linkPaused = false;
  setTimeout(() => {
    if (c) { try { c.close(); } catch (e) {} }
    if (p) { try { p.destroy(); } catch (e) {} }
  }, 300);

  session = null;
  saveSession();
  gameState = createDefaultGameState();
  saveState();
  outbox = [];
  retryAttempt = 0;
  showRolePrompt = false;
  namesDirty = { home: false, away: false };
  view = "connect";
  connError = message;
  netStatus = { state: "idle", text: "" };
  render();
}

// Tell the other device right away when this page refreshes or closes,
// so it starts reconnecting instead of waiting for a timeout.
function announceGoingAway() {
  if (conn && conn.open) {
    try { conn.send({ type: "going-away" }); } catch (e) {}
  }
}
window.addEventListener("beforeunload", announceGoingAway);
window.addEventListener("pagehide", announceGoingAway);

// If the browser restores this page from its back/forward cache, the old
// connection is gone; start fresh (the saved session rejoins the room).
window.addEventListener("pageshow", e => {
  if (e.persisted) location.reload();
  else wakeUp();
});

// When the page comes back (app switched back, screen unlocked, network
// back), reconnect right away instead of waiting for timers.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") wakeUp();
});
document.addEventListener("resume", wakeUp);   // Chrome page-lifecycle "unfrozen"
window.addEventListener("focus", wakeUp);
window.addEventListener("online", wakeUp);

// ===============================
// 15. LOAD STATE ON START
// ===============================

window.addEventListener("load", () => {
  loadSession();
  loadState();

  if (session) {
    view = "flow";
    netStatus = { state: "reconnecting", text: "Rejoining your room…" };
    render();
    if (session.side === "host") startHost(session.roomId, true);
    else startClient(session.roomId);
  } else {
    view = "connect";
    render();
  }
});
