// main.js

// --- 0. S T A G E   D E F I N I T I O N S ---
const STARTERS = [
    "Battlefield", "Final Destination", "Town & City",
    "Pokémon Stadium 2", "Smashville"
];

const COUNTERPICKS = [
    "Kalos Pokémon League", "Lylat Cruise", "Small Battlefield",
    "Yoshi's Story", "Hollow Bastion"
];

const FULL_STAGE_LIST = [...STARTERS, ...COUNTERPICKS];

// --- P E R S I S T E N C E / S H A R E   K E Y S ---
const PERSIST_KEY = 'ssbu_stage_state_v1';

// --- 1. G L O B A L   V A R I A B L E S ---
let peer;
let conn;
let isHost = false;
let myRole = '';

let gameState = {
    type: '',        // '' | 'game1' | 'subsequent'
    available: [],
    bans: [],
    turn: '',        // 'striker_1', 'striker_2', 'banner', 'picker'
    banCount: 0,     // used in subsequent game
    finalStage: null // NEW: selected stage for this game
};

// --- P E R S I S T E N C E   H E L P E R S ---
function saveState() {
    try {
        const toStore = {
            type: gameState.type,
            available: gameState.available,
            bans: gameState.bans,
            turn: gameState.turn,
            banCount: gameState.banCount,
            finalStage: gameState.finalStage
        };
        localStorage.setItem(PERSIST_KEY, JSON.stringify(toStore));
        updateShareUrl(); // keep URL hash in sync
    } catch (e) {
        console.warn('Could not save state:', e);
    }
}

function loadStateFromStorage() {
    try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn('Could not load state from storage:', e);
        return null;
    }
}

function loadStateFromHash() {
    if (!location.hash.startsWith('#state=')) return null;
    try {
        const encoded = location.hash.slice(7);
        const json = decodeURIComponent(encoded);
        return JSON.parse(json);
    } catch (e) {
        console.warn('Could not parse state from URL hash:', e);
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
            finalStage: gameState.finalStage
        };
        const encoded = encodeURIComponent(JSON.stringify(payload));
        const newHash = '#state=' + encoded;
        const newUrl = location.pathname + location.search + newHash;

        if (location.hash !== newHash) {
            history.replaceState(null, '', newUrl);
        }

        // Optional: if you add <input id="share-url"> in your HTML, we'll fill it.
        const shareInput = document.getElementById('share-url');
        if (shareInput) {
            shareInput.value = window.location.href;
        }
    } catch (e) {
        console.warn('Could not update share URL:', e);
    }
}

// --- 2. D O M   E L E M E N T S ---
const el = {
    connArea: document.getElementById('connection-area'),
    connStatus: document.getElementById('conn-status'),
    hostBtn: document.getElementById('host-btn'),
    roomId: document.getElementById('room-id'),
    clientControls: document.getElementById('client-controls'),
    joinIdInput: document.getElementById('join-id-input'),
    joinBtn: document.getElementById('join-btn'),

    setupArea: document.getElementById('game-setup-area'),
    setupStatus: document.getElementById('setup-status'),

    initialSetup: document.getElementById('initial-setup'),
    game1Btn: document.getElementById('game-1-btn'),

    subsequentSetup: document.getElementById('subsequent-setup'),
    hostWonBtn: document.getElementById('host-won'),
    clientWonBtn: document.getElementById('client-won'),

    rolePrompt: document.getElementById('role-prompt'),
    hostStrikesFirstBtn: document.getElementById('host-strikes-first'),
    clientStrikesFirstBtn: document.getElementById('client-strikes-first'),

    stageArea: document.getElementById('stage-select-area'),
    gameStatus: document.getElementById('game-status'),
    instructions: document.getElementById('instructions'),
    starterList: document.getElementById('starter-list'),
    counterpickList: document.getElementById('counterpick-list'),

    finalStageArea: document.getElementById('final-stage'),
    finalStageName: document.getElementById('final-stage-name'),
    nextGameBtn: document.getElementById('next-game-btn'),
    rematchBtn: document.getElementById('rematch-btn')
};

// --- 3. N E T W O R K I N G ---

el.hostBtn.addEventListener('click', () => {
    const newRoomId = 'ssbu-' + Math.random().toString(36).substr(2, 6);
    peer = new Peer(newRoomId);

    peer.on('open', (id) => {
        el.roomId.textContent = id;
        el.hostBtn.disabled = true;
        el.clientControls.classList.add('hidden');
        el.connStatus.textContent = 'Waiting for opponent...';
        isHost = true;
    });

    peer.on('connection', (connection) => {
        setupConnection(connection);
    });

    peer.on('error', (err) => {
        alert('Error: ' + err.type);
        el.hostBtn.disabled = false;
        isHost = false;
    });
});

el.joinBtn.addEventListener('click', () => {
    const joinId = el.joinIdInput.value.trim();
    if (joinId) {
        peer = new Peer();
        peer.on('open', () => {
            const connection = peer.connect(joinId);
            setupConnection(connection);
        });
        peer.on('error', (err) => {
            alert('Connection failed: ' + err.message);
        });
    }
});

function setupConnection(connection) {
    conn = connection;
    el.connStatus.textContent = '✅ Opponent Connected!';
    el.connArea.classList.add('hidden');
    el.setupArea.classList.remove('hidden');
    resetToGame1Setup(); // will also clear old gameState and save

    conn.on('data', (data) => {
        handleMessage(data);
    });

    conn.on('close', () => {
        alert('Opponent has disconnected.');
        // Reload is OK; the stage state will still be in localStorage / URL
        location.reload();
    });
}

function sendData(data) {
    if (conn && conn.open) {
        conn.send(data);
    }
}

// --- 4. G A M E   S E T U P   L O G I C ---

// GAME 1 Setup
el.game1Btn.addEventListener('click', () => {
    el.initialSetup.classList.add('hidden');
    el.rolePrompt.classList.remove('hidden');
});

el.hostStrikesFirstBtn.addEventListener('click', () => {
    myRole = 'striker_1';
    sendData({ type: 'setup', game: 'game1', role: 'striker_2' });
    initGame1('striker_1');
});

el.clientStrikesFirstBtn.addEventListener('click', () => {
    myRole = 'striker_2';
    sendData({ type: 'setup', game: 'game1', role: 'striker_1' });
    initGame1('striker_2');
});

// SUBSEQUENT Setup
el.hostWonBtn.addEventListener('click', () => {
    myRole = 'banner';
    sendData({ type: 'setup', game: 'subsequent', role: 'picker' });
    initSubsequentGame('banner');
});

el.clientWonBtn.addEventListener('click', () => {
    myRole = 'picker';
    sendData({ type: 'setup', game: 'subsequent', role: 'banner' });
    initSubsequentGame('picker');
});

// --- 5. I N I T   G A M E S ---

function initGame1(role) {
    el.setupArea.classList.add('hidden');
    el.stageArea.classList.remove('hidden');
    el.rolePrompt.classList.add('hidden');

    myRole = role;
    gameState.type = 'game1';
    gameState.available = [...STARTERS];
    gameState.bans = [];
    gameState.turn = 'striker_1';
    gameState.banCount = 0;
    gameState.finalStage = null;

    renderStages();
    updateGame1Instructions();
    saveState();
}

function initSubsequentGame(role) {
    el.setupArea.classList.add('hidden');
    el.stageArea.classList.remove('hidden');

    myRole = role;
    gameState.type = 'subsequent';
    gameState.available = [...FULL_STAGE_LIST];
    gameState.bans = [];
    gameState.banCount = 0;
    gameState.turn = 'banner';
    gameState.finalStage = null;

    renderStages();
    updateSubsequentGameInstructions();
    saveState();
}

// --- 6. G A M E   L O G I C ---
// Game 1: 1–2–1 with LAST CLICK as a PICK (not a ban)

function runGame1Logic(stage, actor) {
    const remainingCount = gameState.available.length;

    // --- FINAL STEP: PICKING (2 Stages Left) ---
    if (remainingCount === 2) {
        // This click is a PICK, not a BAN.
        if (actor === 'me') {
            sendData({ type: 'pick', stage: stage });
        }
        showFinalStage(stage);
        return;
    }

    // --- NORMAL STEP: BANNING (5, 4, or 3 Stages Left) ---
    if (actor === 'me') {
        sendData({ type: 'ban', stage: stage });
    }

    gameState.bans.push(stage);
    gameState.available = gameState.available.filter(s => s !== stage);

    const newRemaining = gameState.available.length;

    if (newRemaining === 4) {
        gameState.turn = 'striker_2'; // S1 banned 1, now S2's turn
    } else if (newRemaining === 3) {
        gameState.turn = 'striker_2'; // S2 banned 1, still S2's turn
    } else if (newRemaining === 2) {
        gameState.turn = 'striker_1'; // S2 banned 2nd stage, now S1 picks
    }

    renderStages();
    updateGame1Instructions();
    saveState();
}

function runSubsequentGameLogic(stage, actor) {
    // PHASE 1: BANNING (Winner bans 3)
    if (gameState.banCount < 3) {
        if (actor === 'me') {
            sendData({ type: 'ban', stage: stage });
        }
        gameState.bans.push(stage);
        gameState.available = gameState.available.filter(s => s !== stage);
        gameState.banCount++;
    }
    // PHASE 2: PICKING (Loser picks 1)
    else if (gameState.banCount === 3) {
        if (actor === 'me') {
            sendData({ type: 'pick', stage: stage });
        }
        showFinalStage(stage);
        return;
    }

    if (gameState.banCount < 3) {
        gameState.turn = 'banner';
    } else {
        gameState.turn = 'picker';
    }

    renderStages();
    updateSubsequentGameInstructions();
    saveState();
}

// --- 7. U I   R E N D E R I N G ---

function renderStages() {
    el.starterList.innerHTML = '';
    el.counterpickList.innerHTML = '';

    const allStages = (gameState.type === 'game1') ? STARTERS : FULL_STAGE_LIST;

    allStages.forEach(stage => {
        const btn = document.createElement('button');
        btn.textContent = stage;
        btn.classList.add('stage-btn');
        btn.dataset.stage = stage;

        if (gameState.bans.includes(stage)) {
            btn.classList.add('banned');
            btn.disabled = true;
        } else {
            if (gameState.type === 'game1' &&
                gameState.available.length === 2 &&
                !gameState.bans.includes(stage)) {
                // Highlight final PICK step visually if you want
                btn.classList.add('pickable'); // add CSS if desired
            }

            // Check if it's my turn
            if (myRole === gameState.turn && !gameState.finalStage) {
                let canClick = true;
                if (gameState.type === 'game1' && !STARTERS.includes(stage)) {
                    canClick = false;
                }

                if (canClick) {
                    btn.classList.add('selectable');
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

    if (gameState.type === 'game1') {
        el.counterpickList.parentElement.classList.add('hidden');
    } else {
        el.counterpickList.parentElement.classList.remove('hidden');
    }
}

function updateGame1Instructions() {
    let text = '';
    const remaining = gameState.available.length;

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
    let text = '';
    if (myRole === gameState.turn) {
        if (myRole === 'banner') {
            text = `Your Turn: Ban ${3 - gameState.banCount} more stages.`;
        } else {
            text = "Your Turn: Pick one stage from the remaining list.";
        }
    } else {
        if (gameState.turn === 'banner') {
            text = "Waiting for Opponent to ban 3 stages...";
        } else {
            text = "Waiting for Opponent to pick a stage...";
        }
    }
    el.instructions.textContent = text;
}

function onStageClick(stage) {
    if (gameState.type === 'game1') {
        runGame1Logic(stage, 'me');
    } else {
        runSubsequentGameLogic(stage, 'me');
    }
}

function showFinalStage(stage) {
    gameState.finalStage = stage;
    saveState();

    el.stageArea.classList.add('hidden');
    el.finalStageArea.classList.remove('hidden');
    el.finalStageName.textContent = stage;
}

// --- 8. A P P   F L O W   C O N T R O L ---

el.nextGameBtn.addEventListener('click', () => {
    sendData({ type: 'next_game' });
    setupNextGameUI();
});

el.rematchBtn.addEventListener('click', () => {
    sendData({ type: 'rematch' });
    resetToGame1Setup();
});

function handleMessage(data) {
    switch (data.type) {
        case 'setup':
            myRole = data.role;
            if (data.game === 'game1') {
                initGame1(myRole);
            } else if (data.game === 'subsequent') {
                initSubsequentGame(myRole);
            }
            break;
        case 'ban':
            if (gameState.type === 'game1') {
                runGame1Logic(data.stage, 'opponent');
            } else {
                runSubsequentGameLogic(data.stage, 'opponent');
            }
            break;
        case 'pick':
            showFinalStage(data.stage);
            break;
        case 'next_game':
            setupNextGameUI();
            break;
        case 'rematch':
            resetToGame1Setup();
            break;
    }
}

function setupNextGameUI() {
    myRole = '';
    gameState = {
        type: '',
        available: [],
        bans: [],
        turn: '',
        banCount: 0,
        finalStage: null
    };
    saveState();

    el.finalStageArea.classList.add('hidden');
    el.stageArea.classList.add('hidden');
    el.setupArea.classList.remove('hidden');

    if (isHost) {
        el.initialSetup.classList.add('hidden');
        el.subsequentSetup.classList.remove('hidden');
    } else {
        el.initialSetup.classList.add('hidden');
        el.subsequentSetup.classList.add('hidden');
        el.setupStatus.textContent = 'Waiting for Host to set up Game...';
    }
}

function resetToGame1Setup() {
    myRole = '';
    gameState = {
        type: '',
        available: [],
        bans: [],
        turn: '',
        banCount: 0,
        finalStage: null
    };
    saveState();

    el.finalStageArea.classList.add('hidden');
    el.stageArea.classList.add('hidden');
    el.setupArea.classList.remove('hidden');

    if (isHost) {
        el.initialSetup.classList.remove('hidden');
        el.subsequentSetup.classList.add('hidden');
        el.rolePrompt.classList.add('hidden');
    } else {
        el.initialSetup.classList.add('hidden');
        el.subsequentSetup.classList.add('hidden');
        el.rolePrompt.classList.add('hidden');
        el.setupStatus.textContent = 'Waiting for Host to start the match...';
    }
}

// --- 9. R E S T O R E   F R O M   U R L   O R   S T O R A G E (Spectator / reload support) ---

window.addEventListener('load', () => {
    const hashState = loadStateFromHash();
    const storedState = loadStateFromStorage();

    const restored = hashState || storedState;
    if (restored) {
        gameState = {
            ...gameState,
            ...restored
        };
    }

    // If there's a finalStage, we can show it read-only for spectators.
    if (gameState.finalStage && !peer && !conn) {
        el.connArea.classList.add('hidden');
        el.setupArea.classList.add('hidden');
        el.stageArea.classList.add('hidden');
        el.finalStageArea.classList.remove('hidden');
        el.finalStageName.textContent = gameState.finalStage;
    }

    updateShareUrl();
});
