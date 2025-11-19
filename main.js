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

// --- 1. G L O B A L   V A R I A B L E S ---
let peer;
let conn;
let isHost = false;
let myRole = ''; 
let gameState = {
    type: '', 
    available: [],
    bans: [],
    turn: '', 
    banCount: 0
};

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
    resetToGame1Setup();

    conn.on('data', (data) => {
        handleMessage(data);
    });

    conn.on('close', () => {
        alert('Opponent has disconnected.');
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
    // Game 1 Logic: 
    // 0 Bans: Striker 1 bans 1
    // 1 Ban:  Striker 2 bans 1
    // 2 Bans: Striker 2 bans 1
    // 3 Bans: Striker 1 PICKS winner
    gameState.turn = 'striker_1'; 
    gameState.banCount = 0; 

    renderStages();
    updateGame1Instructions();
}

function initSubsequentGame(role) {
    el.setupArea.classList.add('hidden');
    el.stageArea.classList.remove('hidden');

    myRole = role; 
    gameState.type = 'subsequent';
    gameState.available = [...FULL_STAGE_LIST];
    gameState.bans = [];
    // Game 2+ Logic:
    // 0-2 Bans: Winner bans 3
    // 3 Bans: Loser picks 1
    gameState.banCount = 0; 
    gameState.turn = 'banner'; 

    renderStages();
    updateSubsequentGameInstructions();
}

// --- 6. G A M E   L O G I C (STRICT MODE) ---

function runGame1Logic(stage, actor) {
    // This function runs whenever a stage button is clicked (by me or opponent)
    
    // PHASE 1, 2, 3: BANNING (When banCount is 0, 1, or 2)
    if (gameState.banCount < 3) {
        if (actor === 'me') {
            sendData({ type: 'ban', stage: stage });
        }
        // Update State
        gameState.bans.push(stage);
        gameState.available = gameState.available.filter(s => s !== stage);
        gameState.banCount++;
    }
    // PHASE 4: PICKING (When banCount is 3)
    else if (gameState.banCount === 3) {
        // This click determines the winner
        if (actor === 'me') {
            sendData({ type: 'pick', stage: stage });
        }
        showFinalStage(stage);
        return; // Stop here
    }

    // Determine Next Turn based on new Ban Count
    if (gameState.banCount === 1) { 
        gameState.turn = 'striker_2';
    }
    else if (gameState.banCount === 2) {
        gameState.turn = 'striker_2'; // Striker 2 bans twice in a row
    }
    else if (gameState.banCount === 3) {
        gameState.turn = 'striker_1'; // Striker 1 returns to PICK
    }
    
    renderStages();
    updateGame1Instructions();
}

function runSubsequentGameLogic(stage, actor) {
    // PHASE 1: BANNING (Winner bans 3)
    if (gameState.banCount < 3) {
        if (actor === 'me') {
            // Only 'banner' can click here, handled by renderStages
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

    // Determine Turn
    if (gameState.banCount < 3) {
        gameState.turn = 'banner';
    } else {
        gameState.turn = 'picker';
    }
    
    renderStages();
    updateSubsequentGameInstructions();
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
            // Check if it's my turn
            if (myRole === gameState.turn) {
                // Ensure I'm clicking valid stages for Game 1
                let canClick = true;
                if (gameState.type === 'game1' && !STARTERS.includes(stage)) canClick = false;
                
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
    if (myRole === gameState.turn) {
        // Custom text for the final step (Picking)
        if (gameState.banCount === 3) text = "Final Step: PICK the stage you want to play!";
        else if (gameState.banCount === 0) text = "Your Turn: Ban 1 stage";
        else if (gameState.banCount === 1) text = "Your Turn: Ban 2 stages (1st Ban)";
        else if (gameState.banCount === 2) text = "Your Turn: Ban 2 stages (2nd Ban)";
    } else {
        // Opponent's turn
        if (gameState.banCount === 3) text = "Waiting for Opponent to PICK the stage...";
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
    el.stageArea.classList.add('hidden');
    el.finalStageArea.classList.remove('hidden');
    el.finalStageName.textContent = stage;
}

// --- 8. A P P   F L O W   C O N T R O L ---

// "Next Game" Button
el.nextGameBtn.addEventListener('click', () => {
    sendData({ type: 'next_game' });
    setupNextGameUI();
});

// "Rematch / Reset" Button
el.rematchBtn.addEventListener('click', () => {
    sendData({ type: 'rematch' });
    resetToGame1Setup();
});

function handleMessage(data) {
    switch(data.type) {
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
    // Reset state but keep connection
    myRole = '';
    gameState = { type: '', available: [], bans: [], turn: '', banCount: 0 };
    
    el.finalStageArea.classList.add('hidden');
    el.stageArea.classList.add('hidden');
    el.setupArea.classList.remove('hidden');
    
    // Show the "Next Game" specific controls
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
    // Full Reset
    myRole = '';
    gameState = { type: '', available: [], bans: [], turn: '', banCount: 0 };
    
    el.finalStageArea.classList.add('hidden');
    el.stageArea.classList.add('hidden');
    el.setupArea.classList.remove('hidden');
    
    // Show Game 1 controls
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
