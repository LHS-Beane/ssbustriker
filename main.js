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
let myRole = ''; // 'banner', 'picker', 'striker_1', 'striker_2'
let gameState = {
    type: '', // 'game1' or 'subsequent'
    available: [],
    bans: [],
    turn: '', // 'striker_1', 'striker_2'
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
    roleSelect: document.getElementById('role-select'),
    game1Btn: document.getElementById('game-1-btn'),
    subsequentBtn: document.getElementById('subsequent-btn'),
    rolePrompt: document.getElementById('role-prompt'),
    
    stageArea: document.getElementById('stage-select-area'),
    gameStatus: document.getElementById('game-status'),
    instructions: document.getElementById('instructions'),
    starterList: document.getElementById('starter-list'),
    counterpickList: document.getElementById('counterpick-list'),
    
    finalStageArea: document.getElementById('final-stage'),
    finalStageName: document.getElementById('final-stage-name'),
    resetBtn: document.getElementById('reset-btn')
};

// --- 3. N E T W O R K I N G   L O G I C (Peer.js) ---

el.hostBtn.addEventListener('click', () => {
    // Generate a simple room ID
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
});

el.joinBtn.addEventListener('click', () => {
    const joinId = el.joinIdInput.value;
    if (joinId) {
        peer = new Peer(); // Create a client peer
        peer.on('open', () => {
            const connection = peer.connect(joinId);
            setupConnection(connection);
        });
    }
});

function setupConnection(connection) {
    conn = connection;
    el.connStatus.textContent = '✅ Opponent Connected!';
    el.connArea.classList.add('hidden');
    el.setupArea.classList.remove('hidden');

    // Host controls the game setup
    if (isHost) {
        el.roleSelect.classList.remove('hidden');
    } else {
        el.setupStatus.textContent = 'Waiting for Host to set up the game...';
    }

    conn.on('data', (data) => {
        handleMessage(data);
    });

    conn.on('close', () => {
        alert('Opponent has disconnected.');
        resetApp();
    });
}

function sendData(data) {
    if (conn && conn.open) {
        conn.send(data);
    }
}

// --- 4. G A M E   S E T U P   L O G I C ---

el.game1Btn.addEventListener('click', () => {
    // Host selected Game 1
    el.roleSelect.classList.add('hidden');
    el.rolePrompt.innerHTML = `
        <p>Who is banning first? (Per 6.3.3: Home Team in R1, Winner of previous Round in subsequent Rounds)</p>
        <button id="host-strikes-first">I Ban First (Striker 1)</button>
        <button id="client-strikes-first">Opponent Bans First (Striker 2)</button>
    `;

    document.getElementById('host-strikes-first').addEventListener('click', () => {
        // Host is Striker 1
        myRole = 'striker_1';
        sendData({ type: 'setup', game: 'game1', role: 'striker_2' });
        initGame1('striker_1');
    });

    document.getElementById('client-strikes-first').addEventListener('click', () => {
        // Host is Striker 2
        myRole = 'striker_2';
        sendData({ type: 'setup', game: 'game1', role: 'striker_1' });
        initGame1('striker_2');
    });
});

el.subsequentBtn.addEventListener('click', () => {
    // Host selected Subsequent Game
    el.roleSelect.classList.add('hidden');
    el.rolePrompt.innerHTML = `
        <p>Did you win the previous game? (Winner bans 3)</p>
        <button id="host-won">Yes, I Won (Banner)</button>
        <button id="client-won">No, I Lost (Picker)</button>
    `;
    
    document.getElementById('host-won').addEventListener('click', () => {
        // Host is Banner
        myRole = 'banner';
        sendData({ type: 'setup', game: 'subsequent', role: 'picker' });
        initSubsequentGame('banner');
    });

    document.getElementById('client-won').addEventListener('click', () => {
        // Host is Picker
        myRole = 'picker';
        sendData({ type: 'setup', game: 'subsequent', role: 'banner' });
        initSubsequentGame('picker');
    });
});

// --- 5. G A M E   L O G I C   H A N D L E R S ---

function handleMessage(data) {
    switch(data.type) {
        case 'setup':
            // Received setup from Host
            myRole = data.role;
            if (data.game === 'game1') {
                initGame1(myRole);
            } else if (data.game === 'subsequent') {
                initSubsequentGame(myRole);
            }
            break;
        case 'ban':
            // Opponent banned a stage
            gameState.bans.push(data.stage);
            gameState.available = gameState.available.filter(s => s !== data.stage);
            
            if (gameState.type === 'game1') {
                runGame1Logic(data.stage, 'opponent');
            } else {
                runSubsequentGameLogic(data.stage, 'opponent');
            }
            break;
        case 'pick':
            // Opponent picked a stage (Subsequent Game)
            showFinalStage(data.stage);
            break;
    }
}

function initGame1(myRole) {
    el.setupArea.classList.add('hidden');
    el.stageArea.classList.remove('hidden');
    
    gameState.type = 'game1';
    gameState.available = [...STARTERS];
    gameState.bans = [];
    gameState.turn = 'striker_1'; // Striker 1 always goes first
    gameState.banCount = 0; // Total bans in the 1-2-1 process

    renderStages();
    updateGame1Instructions();
}

function initSubsequentGame(myRole) {
    el.setupArea.classList.add('hidden');
    el.stageArea.classList.remove('hidden');

    gameState.type = 'subsequent';
    gameState.available = [...FULL_STAGE_LIST];
    gameState.bans = [];
    gameState.banCount = 0; // Winner bans 3
    gameState.turn = 'banner'; // Banner always goes first

    renderStages();
    updateSubsequentGameInstructions();
}

// --- 6. S T A T E   M A C H I N E S ---

function runGame1Logic(stage, actor) {
    // actor is 'me' or 'opponent'
    if (actor === 'me') {
        sendData({ type: 'ban', stage: stage });
    }
    
    gameState.banCount++;

    // 1-2-1 Striking logic
    // Ban 1 (by S1)
    if (gameState.banCount === 1) { 
        gameState.turn = 'striker_2';
    }
    // Ban 2 & 3 (by S2)
    else if (gameState.banCount === 2) {
        gameState.turn = 'striker_2'; // Stays S2's turn
    }
    else if (gameState.banCount === 3) {
        gameState.turn = 'striker_1';
    }
    // Ban 4 (by S1)
    else if (gameState.banCount === 4) {
        // Game is over
        showFinalStage(gameState.available[0]);
        return;
    }
    
    renderStages();
    updateGame1Instructions();
}

function runSubsequentGameLogic(stage, actor) {
    if (actor === 'me') {
        // This was a ban or a pick
        if (myRole === 'banner') {
            sendData({ type: 'ban', stage: stage });
            gameState.banCount++;
        } else if (myRole === 'picker') {
            sendData({ type: 'pick', stage: stage });
            showFinalStage(stage);
            return;
        }
    }

    // Winner (banner) bans 3
    if (gameState.banCount < 3) {
        gameState.turn = 'banner';
    } 
    // All 3 bans are in, it's the picker's turn
    else if (gameState.banCount === 3) {
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
            // Check if it's my turn and I can click this
            if (myRole === gameState.turn) {
                // For Game 1, can only click starter stages
                if (gameState.type === 'game1' && !STARTERS.includes(stage)) {
                     btn.disabled = true;
                } else {
                    btn.classList.add('selectable');
                    btn.onclick = () => onStageClick(stage);
                }
            } else {
                btn.disabled = true;
            }
        }

        // Put in correct list
        if (STARTERS.includes(stage)) {
            el.starterList.appendChild(btn);
        } else {
            el.counterpickList.appendChild(btn);
        }
    });

    // Hide counterpick list during Game 1
    if (gameState.type === 'game1') {
        el.counterpickList.parentElement.classList.add('hidden');
    } else {
        el.counterpickList.parentElement.classList.remove('hidden');
    }
}

function updateGame1Instructions() {
    let text = '';
    if (myRole === gameState.turn) {
        // My turn
        if (gameState.banCount === 0) text = "Your Turn: Ban 1 stage (1-2-1)";
        else if (gameState.banCount === 1) text = "Your Turn: Ban 2 stages (1-2-1)";
        else if (gameState.banCount === 2) text = "Your Turn: Ban 1 final stage (1-2-1)";
        else if (gameState.banCount === 3) text = "Your Turn: Ban 1 final stage (1-2-1)";
    } else {
        // Opponent's turn
        text = `Waiting for Opponent (${gameState.turn}) to ban...`;
    }
    el.instructions.textContent = text;
}

function updateSubsequentGameInstructions() {
    let text = '';
    if (myRole === gameState.turn) {
        // My turn
        if (myRole === 'banner') {
            text = `Your Turn: Ban ${3 - gameState.banCount} more stages.`;
        } else {
            text = "Your Turn: Pick one stage from the remaining list.";
        }
    } else {
        // Opponent's turn
        if (gameState.turn === 'banner') {
             text = "Waiting for Opponent (Winner) to ban 3 stages...";
        } else {
             text = "Waiting for Opponent (Loser) to pick a stage...";
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

// --- 8. A P P   R E S E T ---
el.resetBtn.addEventListener('click', resetApp);

function resetApp() {
    // Reset state
    myRole = '';
    gameState = { type: '', available: [], bans: [], turn: '', banCount: 0 };
    
    // Reset UI
    el.finalStageArea.classList.add('hidden');
    el.stageArea.classList.add('hidden');
    el.setupArea.classList.remove('hidden');
    
    // Only host can see setup controls
    if (isHost) {
        el.roleSelect.classList.remove('hidden');
        el.rolePrompt.innerHTML = ''; // Clear prompts
    } else {
        el.roleSelect.classList.add('hidden');
        el.setupStatus.textContent = 'Waiting for Host to set up the next game...';
    }
}
