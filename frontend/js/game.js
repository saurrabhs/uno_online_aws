'use strict';

// ─── State ──────────────────────────────────────────────────────────────────
const State = {
  gameId: null, playerId: null, playerName: null,
  gameState: null, ws: null, wsReconnectTimer: null,
  wsReconnectAttempts: 0, timerInterval: null, timerSeconds: 30,
  selectedCard: null, pendingWildCard: null, drawnCard: null,
  playerPositions: {}, isMyTurn: false, chatOpen: false,
  restartVotes: 0, restartNeeded: 0, animating: false,
  _catchTimer: null
};

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  State.gameId   = params.get('gameId')   || sessionStorage.getItem('uno_game_id');
  State.playerId = params.get('playerId') || sessionStorage.getItem('uno_player_id');
  State.playerName = sessionStorage.getItem('uno_player_name') || 'You';

  if (!State.gameId || !State.playerId) { window.location.href = 'index.html'; return; }

  document.getElementById('gameIdBadge').textContent = `GAME: ${State.gameId}`;
  document.getElementById('name-bottom').textContent = State.playerName;
  document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // Handle orientation on mobile
  handleOrientation();
  window.addEventListener('orientationchange', () => setTimeout(handleOrientation, 300));
  window.addEventListener('resize', handleOrientation);

  connectWebSocket();
  fetchGameState();

  // Init sound on first interaction
  document.addEventListener('click', () => SoundEngine.resume(), { once: true });
  document.addEventListener('touchstart', () => SoundEngine.resume(), { once: true });
});

function requestFullscreenAndPlay() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (req) {
    req.call(el).then(() => {
      // Try to lock to landscape after fullscreen
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    }).catch(() => {});
  }
  document.getElementById('rotatePrompt').classList.add('hidden');
}

function handleOrientation() {
  const prompt = document.getElementById('rotatePrompt');
  if (!prompt) return;
  const isMobile = window.innerWidth <= 900 || ('ontouchstart' in window);
  const isPortrait = window.innerHeight > window.innerWidth;

  if (isMobile && isPortrait) {
    prompt.classList.remove('hidden');
  } else {
    prompt.classList.add('hidden');
    // Auto-request fullscreen on mobile landscape for immersive play
    if (isMobile && !document.fullscreenElement) {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
      if (req) req.call(el).catch(() => {});
    }
  }
}

// ─── WebSocket ───────────────────────────────────────────────────────────────
function connectWebSocket() {
  if (State.ws && State.ws.readyState === WebSocket.OPEN) return;
  const url = `${API_CONFIG.WEBSOCKET_URL}?gameId=${State.gameId}&playerId=${State.playerId}`;
  State.ws = new WebSocket(url);
  State.ws.onopen    = () => { State.wsReconnectAttempts = 0; clearTimeout(State.wsReconnectTimer); startPing(); };
  State.ws.onmessage = e  => { try { handleServerMessage(JSON.parse(e.data)); } catch(ex) { console.error(ex); } };
  State.ws.onclose   = () => scheduleReconnect();
  State.ws.onerror   = e  => console.error('WS error', e);
}

function scheduleReconnect() {
  if (State.wsReconnectAttempts >= 10) return;
  const delay = Math.min(1000 * Math.pow(1.5, State.wsReconnectAttempts), 15000);
  State.wsReconnectAttempts++;
  setStatus(`Reconnecting... (${State.wsReconnectAttempts})`);
  State.wsReconnectTimer = setTimeout(connectWebSocket, delay);
}

function startPing() {
  setInterval(() => { if (State.ws?.readyState === WebSocket.OPEN) wsSend({ action: 'ping' }); }, 25000);
}

function wsSend(data) {
  if (State.ws?.readyState === WebSocket.OPEN) State.ws.send(JSON.stringify(data));
}

// ─── Server Messages ─────────────────────────────────────────────────────────
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'connected':
    case 'gameState':
      if (msg.gameState) applyGameState(msg.gameState);
      break;
    case 'gameStarted':
      if (msg.gameState) applyGameState(msg.gameState);
      hideWaitingOverlay();
      document.getElementById('hostStartBtn')?.remove();
      addChat('system', 'Game started! Good luck!');
      SoundEngine.playGameStart();
      break;
    case 'gameRestarted':
      if (msg.gameState) applyGameState(msg.gameState);
      document.getElementById('winnerModal').classList.add('hidden');
      addChat('system', 'New game started!');
      SoundEngine.playGameStart();
      break;
    case 'playerJoined':
      addChat('system', `${msg.playerName} joined (${msg.playerCount}/6)`);
      if (msg.gameState) applyGameState(msg.gameState);
      SoundEngine.playPlayerJoin();
      break;
    case 'playerConnected':
      addChat('system', `${msg.playerName} reconnected`);
      if (msg.gameState) applyGameState(msg.gameState);
      SoundEngine.playPlayerJoin();
      break;
    case 'playerDisconnected':
      addChat('system', `${msg.playerName} disconnected`);
      if (msg.gameState) applyGameState(msg.gameState);
      break;
    case 'chat':
      addChat(msg.playerName, msg.message);
      if (msg.playerId !== State.playerId) SoundEngine.playChat();
      break;
    case 'unoCall':
      showUnoNotif(msg.playerName);
      document.getElementById('catchBtn').style.display = 'none';
      SoundEngine.playUnoCall();
      break;
    case 'unoPenalty':
      addChat('system', `${msg.targetName || 'A player'} was caught not calling UNO! +2 cards penalty.`);
      SoundEngine.playUnoPenalty();
      break;
    case 'catchFailed':
      showToast(msg.reason || 'Catch failed.');
      break;
    case 'restartVote':
      State.restartVotes  = msg.votes;
      State.restartNeeded = msg.needed;
      addChat('system', `${msg.playerName} wants to restart (${msg.votes}/${msg.needed})`);
      updateRestartBtn();
      break;
    case 'pong': break;
    case 'error': setStatus(`Error: ${msg.message}`); break;
  }
}

// ─── Fetch state ─────────────────────────────────────────────────────────────
async function fetchGameState() {
  try {
    const res  = await fetch(`${API_CONFIG.REST_API_URL}/games/${State.gameId}?playerId=${State.playerId}`);
    const data = await res.json();
    if (data.gameState) applyGameState(data.gameState);
  } catch(e) { setStatus('Failed to load game state'); }
}

// ─── Apply state ─────────────────────────────────────────────────────────────
function applyGameState(gs) {
  State.gameState = gs;
  // Reassign positions whenever player count changes
  const knownCount = Object.keys(State.playerPositions).length;
  if (knownCount === 0 || knownCount !== gs.players.length) {
    assignPositions(gs.players);
  }

  // Set isMyTurn FIRST before any rendering
  State.isMyTurn = gs.currentPlayerId === State.playerId;

  renderPlayers(gs);
  renderTopCard(gs.topCard, gs.currentColor);
  renderMyHand(gs.myHand, gs.topCard, gs.currentColor);
  updateColorBadge(gs.currentColor);
  updateDirection(gs.direction);
  document.getElementById('drawPileCount').textContent = `${gs.drawPileCount} cards`;
  highlightActive(gs.currentPlayerId);

  if (gs.status === 'waiting') {
    showWaitingOverlay(gs);
    stopTimer();
  } else if (gs.status === 'playing') {
    hideWaitingOverlay();
    // ALL clients run the timer so everyone sees it count down in sync
    startTimer(gs.turnStartedAt);
    if (State.isMyTurn) {
      setStatus("Your turn! Play a card or draw.");
      SoundEngine.playTurnStart();
    } else {
      const cp = gs.players.find(p => p.id === gs.currentPlayerId);
      setStatus(`${cp?.name || '?'}'s turn...`);
    }
  } else if (gs.status === 'finished') {
    stopTimer();
    setTimeout(() => showWinnerModal(gs), 600);
  }

  // UNO btn — enable when you have exactly 1 card
  const unoBtn = document.getElementById('unoBtn');
  unoBtn.disabled = (gs.myHand?.length || 0) !== 1;

  // Catch btn — show when someone has 1 card and hasn't called UNO yet
  // Show to everyone EXCEPT the player who needs to call UNO
  const catchBtn = document.getElementById('catchBtn');
  if (gs.unoCallRequired && gs.unoCallRequired !== State.playerId) {
    const targetPlayer = gs.players.find(p => p.id === gs.unoCallRequired);
    const timeLeft = gs.unoCallDeadline ? Math.max(0, Math.ceil((gs.unoCallDeadline - Date.now()) / 1000)) : 4;
    catchBtn.style.display = 'block';
    catchBtn.dataset.target = gs.unoCallRequired;
    catchBtn.textContent = `Catch! (${timeLeft}s)`;
    // Update countdown
    clearInterval(State._catchTimer);
    State._catchTimer = setInterval(() => {
      const tl = gs.unoCallDeadline ? Math.max(0, Math.ceil((gs.unoCallDeadline - Date.now()) / 1000)) : 0;
      catchBtn.textContent = `Catch! (${tl}s)`;
      if (tl <= 0) {
        clearInterval(State._catchTimer);
        catchBtn.style.display = 'none';
      }
    }, 500);
  } else {
    clearInterval(State._catchTimer);
    catchBtn.style.display = 'none';
  }

  // Challenge modal
  if (gs.pendingChallenge?.challengerId === State.playerId) showChallengeModal(gs);
}
// ─── Waiting Room Overlay ─────────────────────────────────────────────────────
function showWaitingOverlay(gs) {
  let overlay = document.getElementById('waitingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'waitingOverlay';
    overlay.className = 'waiting-overlay';
    document.querySelector('.game-arena').appendChild(overlay);
  }

  // Check host status: match by playerId OR by localStorage flag for this game
  const isHostByState = gs.hostId === State.playerId;
  const isHostByStorage = localStorage.getItem('uno_active_game_id') === State.gameId &&
                          localStorage.getItem('uno_active_is_host') === 'true' &&
                          localStorage.getItem('uno_active_player_id') === State.playerId;
  const isHost = isHostByState || isHostByStorage;
  const canStart = isHost && gs.players.length >= 2;
  console.log('Waiting overlay | hostId:', gs.hostId, '| myId:', State.playerId, '| isHost:', isHost, '| players:', gs.players.length);

  const players = gs.players.map(p =>
    `<div class="waiting-player ${p.connected === false ? 'disconnected' : ''}">
      <div class="waiting-avatar">${p.name.charAt(0).toUpperCase()}</div>
      <span>${esc(p.name)}${gs.hostId === p.id ? ' 👑' : ''}</span>
    </div>`
  ).join('');

  // Empty slots
  const emptySlots = Array.from({ length: Math.max(0, 6 - gs.players.length) }, () =>
    `<div class="waiting-player empty-slot">
      <div class="waiting-avatar" style="opacity:0.3">?</div>
      <span style="opacity:0.3">Waiting...</span>
    </div>`
  ).join('');

  overlay.innerHTML = `
    <div class="waiting-box">
      <div class="waiting-logo">UNO</div>
      <h2>${isHost ? 'Your Room' : 'Waiting for host...'}</h2>
      <p class="waiting-sub">${gs.players.length}/6 players joined</p>
      <div class="waiting-players">${players}${emptySlots}</div>
      <div class="waiting-code">
        Game Code: <strong>${gs.gameId}</strong>
        <button onclick="copyGameCode('${gs.gameId}')" class="copy-code-btn">📋 Copy</button>
      </div>
      ${isHost
        ? canStart
          ? `<button class="btn-host-start" id="overlayStartBtn" onclick="startGame()">
               🎮 Start Game (${gs.players.length} players)
             </button>`
          : `<button class="btn-host-start" id="overlayStartBtn" disabled style="opacity:0.5;cursor:not-allowed">
               Need at least 2 players (${gs.players.length}/2)
             </button>`
        : `<p class="waiting-hint">Waiting for the host to start the game...</p>`
      }
    </div>`;
}

function hideWaitingOverlay() {
  document.getElementById('waitingOverlay')?.remove();
}

function copyGameCode(code) {
  navigator.clipboard.writeText(code).then(() => showToast('Code copied!'));
}

// ─── Player positions ─────────────────────────────────────────────────────────
function assignPositions(players) {
  // Map player index (relative to me) to a screen position
  // Supports 2-6 players
  const n = players.length;
  const myIdx = players.findIndex(p => p.id === State.playerId);

  // Position arrays indexed by (playerIndex - myIndex) mod n
  // Index 0 = me (always bottom)
  const positionMaps = {
    2: ['bottom', 'top'],
    3: ['bottom', 'topleft', 'topright'],
    4: ['bottom', 'top', 'left', 'right'],
    5: ['bottom', 'topleft', 'top', 'topright', 'right'],
    6: ['bottom', 'topleft', 'top', 'topright', 'right', 'left']
  };

  const positions = positionMaps[n] || positionMaps[6];

  players.forEach((p, i) => {
    const relIdx = ((i - myIdx) + n) % n;
    State.playerPositions[p.id] = positions[relIdx] || 'top';
  });
}

function posOf(pid) { return State.playerPositions[pid] || 'top'; }

// ─── Render players ───────────────────────────────────────────────────────────
function renderPlayers(gs) {
  for (const player of gs.players) {
    const pos  = posOf(player.id);
    const isMe = player.id === State.playerId;
    const nameEl   = document.getElementById(`name-${pos}`);
    const countEl  = document.getElementById(`count-${pos}`);
    const avatarEl = document.getElementById(`avatar-${pos}`);
    const cardsEl  = document.getElementById(`cards-${pos}`);
    if (!nameEl) continue;

    nameEl.textContent  = isMe ? State.playerName : player.name;
    countEl.textContent = isMe ? `${gs.myHand?.length||0} cards` : `${player.cardCount} card${player.cardCount!==1?'s':''}`;
    avatarEl.textContent = isMe ? 'YOU' : player.name.charAt(0).toUpperCase();
    avatarEl.style.opacity = player.connected === false ? '0.35' : '1';
    // Disconnected badge
    avatarEl.title = player.connected === false ? `${player.name} (disconnected)` : player.name;

    if (!isMe && cardsEl) {
      const prev = cardsEl.children.length;
      const next = Math.min(player.cardCount, 15);
      // Only re-render if count changed (avoids flicker)
      if (prev !== next) {
        cardsEl.innerHTML = '';
        for (let i = 0; i < next; i++) cardsEl.appendChild(CardRenderer.createMiniCardBack());
      }
    }
  }
  ['top','topleft','topright','left','right'].forEach(pos => {
    const zone = document.getElementById(`player-${pos}`);
    if (!zone) return;
    zone.style.opacity = gs.players.some(p => posOf(p.id) === pos) ? '1' : '0.25';
  });
}

// ─── Render hand ──────────────────────────────────────────────────────────────
function renderMyHand(hand, topCard, currentColor) {
  const container = document.getElementById('myHand');
  if (!hand) return;

  const drawnPending  = State.gameState?.drawnCardPending;
  const myDrawnCardId = drawnPending?.playerId === State.playerId ? drawnPending.cardId : null;

  // Build map of existing card elements to reuse (avoids full re-render flicker)
  const existing = {};
  for (const el of container.children) {
    if (el.dataset.cardId) existing[el.dataset.cardId] = el;
  }

  const newIds = new Set(hand.map(c => c.id));

  // Remove cards no longer in hand with fly-out animation
  for (const [id, el] of Object.entries(existing)) {
    if (!newIds.has(id)) {
      el.classList.add('card-fly-out');
      setTimeout(() => el.remove(), 250);
    }
  }

  // Add / update cards
  hand.forEach((card) => {
    let el = existing[card.id];

    if (!el) {
      el = CardRenderer.createCardElement(card, { size: 'normal' });
      el.classList.add('card-deal-anim');
      // Click handler always re-evaluates playability at click time
      el.addEventListener('click', () => {
        const gs = State.gameState;
        const dp = gs?.drawnCardPending;
        const myDrawnId = dp?.playerId === State.playerId ? dp.cardId : null;
        const isPlayable = myDrawnId
          ? card.id === myDrawnId && isValidPlay(card, gs?.topCard, gs?.currentColor)
          : State.isMyTurn && isValidPlay(card, gs?.topCard, gs?.currentColor);
        onCardClick(card, el, isPlayable);
      });
      container.appendChild(el);
    }

    const gs = State.gameState;
    const dp = gs?.drawnCardPending;
    const myDrawnId = dp?.playerId === State.playerId ? dp.cardId : null;
    const playable = myDrawnId
      ? card.id === myDrawnId && isValidPlay(card, topCard, currentColor)
      : State.isMyTurn && isValidPlay(card, topCard, currentColor);

    // Never dim cards — always show at full opacity
    // Invalid plays are rejected with a shake animation instead
    el.classList.remove('unplayable');
    el.classList.toggle('drawn-card', card.id === myDrawnCardId);
  });

  // Re-order DOM to match hand order
  hand.forEach((card, i) => {
    const el = container.querySelector(`[data-card-id="${card.id}"]`);
    if (el && container.children[i] !== el) container.appendChild(el);
  });

  // Pass button
  const passBtn = document.getElementById('passBtn');
  if (passBtn) passBtn.style.display = myDrawnCardId ? 'block' : 'none';
}

// ─── Card click ───────────────────────────────────────────────────────────────
function onCardClick(card, el, playable) {
  const gs = State.gameState;

  // Debug: log turn info to help diagnose
  console.log('Card click:', card.id, '| myId:', State.playerId, '| currentPlayerId:', gs?.currentPlayerId, '| isMyTurn:', State.isMyTurn);

  if (!State.isMyTurn || gs?.status !== 'playing') {
    setStatus(`It's not your turn. Current: ${gs?.players?.find(p=>p.id===gs?.currentPlayerId)?.name || '?'}`);
    return;
  }
  const drawnPending = gs?.drawnCardPending;
  if (drawnPending?.playerId === State.playerId && card.id !== drawnPending.cardId) {
    setStatus("You can only play the card you just drew, or pass.");
    return;
  }
  // Re-evaluate playability at click time (not stale closure)
  const actuallyPlayable = isValidPlay(card, gs?.topCard, gs?.currentColor);
  if (!actuallyPlayable) {
    el.classList.add('shake-anim');
    setTimeout(() => el.classList.remove('shake-anim'), 400);
    setStatus("Can't play that card right now.");
    SoundEngine.playInvalidCard();
    return;
  }
  if (State.selectedCard?.id === card.id) {
    State.selectedCard = null; el.classList.remove('selected'); return;
  }
  document.querySelectorAll('#myHand .card.selected').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  State.selectedCard = card;
  if (card.type === 'wild' || card.type === 'wildDrawFour') {
    State.pendingWildCard = card; showColorPicker();
  } else {
    playCard(card, null);
  }
}

// ─── Optimistic play card ─────────────────────────────────────────────────────
async function playCard(card, chosenColor) {
  State.selectedCard = null;
  document.querySelectorAll('#myHand .card.selected').forEach(c => c.classList.remove('selected'));

  // ── Optimistic UI: remove card from hand immediately ──
  const cardEl = document.querySelector(`#myHand [data-card-id="${card.id}"]`);
  if (cardEl) {
    cardEl.classList.add('card-fly-to-discard');
    setTimeout(() => cardEl.remove(), 280);
  }

  // Play sound based on card type
  if (card.type === 'wild') SoundEngine.playWild();
  else if (card.type === 'wildDrawFour') SoundEngine.playWildDrawFour();
  else if (card.type === 'skip') SoundEngine.playSkip();
  else if (card.type === 'reverse') SoundEngine.playReverse();
  else if (card.type === 'drawTwo') SoundEngine.playDrawTwo();
  else SoundEngine.playCardPlay();

  // Optimistically update discard pile display
  const displayCard = { ...card, displayColor: chosenColor || card.color };
  renderTopCard(displayCard, chosenColor || card.color);
  if (chosenColor) updateColorBadge(chosenColor);

  try {
    const res = await fetch(`${API_CONFIG.REST_API_URL}/games/${State.gameId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: State.playerId, cardId: card.id, chosenColor })
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(`Invalid move: ${data.error}`);
      // Revert optimistic update
      if (State.gameState) applyGameState(State.gameState);
      return;
    }
    if (data.gameState) applyGameState(data.gameState);
  } catch (err) {
    console.error('playCard error:', err);
    setStatus('Failed to play card. Try again.');
    if (State.gameState) applyGameState(State.gameState);
  }
}

// ─── Draw card ────────────────────────────────────────────────────────────────
async function drawCard() {
  if (!State.isMyTurn || State.gameState?.status !== 'playing') return;
  if (State.gameState?.drawnCardPending?.playerId === State.playerId) return;

  // Optimistic: animate draw pile
  const drawPileEl = document.getElementById('drawPile');
  drawPileEl?.classList.add('draw-pile-pop');
  setTimeout(() => drawPileEl?.classList.remove('draw-pile-pop'), 300);
  SoundEngine.playCardDraw();

  try {
    const res = await fetch(`${API_CONFIG.REST_API_URL}/games/${State.gameId}/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: State.playerId })
    });
    const data = await res.json();
    if (!res.ok) { setStatus(`Error: ${data.error}`); return; }
    if (data.gameState) applyGameState(data.gameState);
    if (data.canPlay && data.drawnCard) {
      State.drawnCard = data.drawnCard;
      showDrawnOverlay(data.drawnCard, data.gameState?.topCard, data.gameState?.currentColor);
    }
  } catch (err) {
    console.error('drawCard error:', err);
    setStatus('Failed to draw card.');
  }
}

async function passAfterDraw() {
  try {
    const res = await fetch(`${API_CONFIG.REST_API_URL}/games/${State.gameId}/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: State.playerId, pass: true })
    });
    const data = await res.json();
    if (data.gameState) applyGameState(data.gameState);
  } catch (err) { console.error('passAfterDraw error:', err); }
}

function showDrawnOverlay(card, topCard, currentColor) {
  const overlay = document.getElementById('drawnCardOverlay');
  const display = document.getElementById('drawnCardDisplay');
  const playBtn = document.getElementById('playDrawnBtn');
  display.innerHTML = '';
  display.appendChild(CardRenderer.createCardElement(card, { size: 'large' }));
  playBtn.style.display = isValidPlay(card, topCard, currentColor) ? 'block' : 'none';
  overlay.classList.remove('hidden');
}

function playDrawnCard() {
  document.getElementById('drawnCardOverlay').classList.add('hidden');
  if (State.drawnCard) {
    if (State.drawnCard.type === 'wild' || State.drawnCard.type === 'wildDrawFour') {
      State.pendingWildCard = State.drawnCard; showColorPicker();
    } else {
      playCard(State.drawnCard, null);
    }
    State.drawnCard = null;
  }
}

function keepDrawnCard() {
  document.getElementById('drawnCardOverlay').classList.add('hidden');
  State.drawnCard = null;
  passAfterDraw();
}

// ─── Host start / restart ─────────────────────────────────────────────────────

async function startGame() {
  const btn = document.getElementById('hostStartBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API_CONFIG.REST_API_URL}/games/${State.gameId}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: State.playerId })
    });
    const data = await res.json();
    if (!res.ok) { setStatus(`Error: ${data.error}`); if (btn) btn.disabled = false; return; }
    if (data.gameState) applyGameState(data.gameState);
  } catch (err) { console.error(err); if (btn) btn.disabled = false; }
}

async function restartGame() {
  try {
    const res = await fetch(`${API_CONFIG.REST_API_URL}/games/${State.gameId}/restart`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: State.playerId })
    });
    const data = await res.json();
    if (!res.ok) {
      // Not host — send a vote instead
      wsSend({ action: 'requestRestart' });
      setStatus('Restart vote sent!');
      return;
    }
    if (data.gameState) applyGameState(data.gameState);
    document.getElementById('winnerModal').classList.add('hidden');
  } catch (err) { console.error(err); }
}

function updateRestartBtn() {
  const btn = document.getElementById('restartVoteBtn');
  if (btn) btn.textContent = `Play Again (${State.restartVotes}/${State.restartNeeded})`;
}

// ─── Color picker ─────────────────────────────────────────────────────────────
function showColorPicker() { document.getElementById('colorPickerModal').classList.remove('hidden'); }

function chooseColor(color) {
  document.getElementById('colorPickerModal').classList.add('hidden');
  if (State.pendingWildCard) {
    playCard(State.pendingWildCard, color);
    State.pendingWildCard = null;
  }
}

// ─── UNO ─────────────────────────────────────────────────────────────────────
function callUno() {
  wsSend({ action: 'callUno' });
  document.getElementById('unoBtn').disabled = true;
  setStatus('UNO called!');
}

function catchUno() {
  const targetId = document.getElementById('catchBtn').dataset.target;
  if (targetId) { wsSend({ action: 'catchUno', targetPlayerId: targetId }); document.getElementById('catchBtn').style.display = 'none'; }
}

function showUnoNotif(playerName) {
  const n = document.createElement('div');
  n.className = 'uno-notif';
  n.textContent = `${playerName} called UNO!`;
  document.body.appendChild(n);
  setTimeout(() => n.classList.add('show'), 10);
  setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 400); }, 2500);
}

// ─── Challenge ────────────────────────────────────────────────────────────────
function showChallengeModal(gs) {
  const modal = document.getElementById('challengeModal');
  if (modal.dataset.open === '1') return;
  modal.dataset.open = '1';
  const challenged = gs.players.find(p => p.id === gs.pendingChallenge.challengedId);
  document.getElementById('challengeDesc').textContent =
    `${challenged?.name || '?'} played Wild Draw Four. Challenge if you think they had a matching color!`;
  modal.classList.remove('hidden');
  let t = 10;
  const fill = document.getElementById('challengeTimerFill');
  const iv = setInterval(() => {
    t--; fill.style.width = `${t * 10}%`;
    if (t <= 0) { clearInterval(iv); acceptDrawFour(); }
  }, 1000);
  modal._iv = iv;
}

function challengeDrawFour() {
  const modal = document.getElementById('challengeModal');
  clearInterval(modal._iv); modal.dataset.open = ''; modal.classList.add('hidden');
  SoundEngine.playChallenge();
  wsSend({ action: 'challengeDrawFour' });
}

function acceptDrawFour() {
  const modal = document.getElementById('challengeModal');
  clearInterval(modal._iv); modal.dataset.open = ''; modal.classList.add('hidden');
}

// ─── Render top card ──────────────────────────────────────────────────────────
function renderTopCard(card, currentColor) {
  if (!card) return;
  const container = document.getElementById('topCardDisplay');
  const displayCard = { ...card };
  if ((card.type === 'wild' || card.type === 'wildDrawFour') && currentColor) displayCard.displayColor = currentColor;
  const el = CardRenderer.createCardElement(displayCard, { size: 'large' });
  el.classList.add('card-play-anim');
  container.innerHTML = '';
  container.appendChild(el);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function updateColorBadge(color) {
  const el = document.getElementById('currentColorIndicator');
  const tx = document.getElementById('currentColorText');
  el.className = `current-color-indicator color-${color}`;
  tx.textContent = color ? color.charAt(0).toUpperCase() + color.slice(1) : '-';
}

function updateDirection(dir) {
  document.getElementById('directionBadge').textContent = dir === 1 ? '▶ Clockwise' : '◀ Counter-clockwise';
}

function highlightActive(currentPlayerId) {
  document.querySelectorAll('.player-zone').forEach(z => z.classList.remove('active-turn'));
  if (!currentPlayerId) return;
  // Find the position for this player — check all zones by their player data
  const gs = State.gameState;
  if (!gs) return;
  const pos = posOf(currentPlayerId);
  const zone = document.getElementById(`player-${pos}`);
  if (zone) zone.classList.add('active-turn');
  // Also highlight bottom zone if it's our turn (always correct)
  if (currentPlayerId === State.playerId) {
    document.getElementById('player-bottom')?.classList.add('active-turn');
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer(turnStartedAt) {
  stopTimer();
  const SECS = 30;
  const elapsed = turnStartedAt ? Math.floor((Date.now() - turnStartedAt) / 1000) : 0;
  State.timerSeconds = Math.max(0, SECS - elapsed);
  updateTimerDisplay(State.timerSeconds, SECS);
  State.timerInterval = setInterval(() => {
    State.timerSeconds--;
    updateTimerDisplay(State.timerSeconds, SECS);
    // Sound warnings
    if (State.isMyTurn) {
      if (State.timerSeconds === 10) SoundEngine.playTimerWarning();
      if (State.timerSeconds <= 5 && State.timerSeconds > 0) SoundEngine.playTimerUrgent();
    }
    if (State.timerSeconds <= 0) {
      stopTimer();
      if (State.isMyTurn && State.gameState?.status === 'playing') drawCard();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(State.timerInterval);
  State.timerInterval = null;
  updateTimerDisplay(30, 30);
}

function updateTimerDisplay(s, total) {
  const pct = (s / total) * 100;
  const circle = document.getElementById('timerCircle');
  const text   = document.getElementById('timerText');
  if (circle) {
    circle.setAttribute('stroke-dasharray', `${pct} 100`);
    circle.setAttribute('stroke', s <= 10 ? '#e74c3c' : s <= 20 ? '#f1c40f' : '#3498db');
  }
  if (text) text.textContent = s;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function toggleChat() {
  const panel = document.getElementById('chatPanel');
  State.chatOpen = !State.chatOpen;
  panel.classList.toggle('hidden', !State.chatOpen);
  if (State.chatOpen) document.getElementById('chatInput').focus();
}

function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  wsSend({ action: 'chat', message: msg });
  input.value = '';
}

function addChat(name, message) {
  const container = document.getElementById('chatMessages');
  const isSystem = name === 'system';
  const div = document.createElement('div');
  div.className = `chat-msg${isSystem ? ' system' : ''}`;
  div.innerHTML = isSystem
    ? `<span class="msg-name">System</span> ${esc(message)}`
    : `<span class="msg-name">${esc(name)}</span>: ${esc(message)}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ─── Winner modal ─────────────────────────────────────────────────────────────
function showWinnerModal(gs) {
  const modal  = document.getElementById('winnerModal');
  const title  = document.getElementById('winnerTitle');
  const scores = document.getElementById('winnerScores');
  const cumEl  = document.getElementById('cumulativeScores');
  const emoji  = document.getElementById('winnerEmoji');
  const winner = gs.players.find(p => p.id === gs.winnerId);
  const isMe   = gs.winnerId === State.playerId;

  emoji.textContent = isMe ? '🏆' : '😢';
  title.textContent = isMe ? 'You Win!' : `${winner?.name || '?'} Wins!`;

  // Round scores (cards remaining in losers' hands)
  if (gs.scores) {
    scores.innerHTML = '<div class="scores-label">Round — cards remaining:</div>' +
      gs.players.map(p =>
        `<div class="score-row ${p.id === gs.winnerId ? 'winner-row' : ''}">
          ${p.id === gs.winnerId ? '🏆 ' : ''}${esc(p.name)}: ${gs.scores[p.id] || 0} pts
        </div>`
      ).join('');
  }

  // Cumulative scoreboard
  const cum = gs.cumulativeScores || {};
  const sorted = [...gs.players].sort((a, b) => (cum[b.id] || 0) - (cum[a.id] || 0));
  cumEl.innerHTML = sorted.map((p, i) =>
    `<div class="cum-row">
      <span class="cum-rank">#${i + 1}</span>
      <span class="cum-name">${esc(p.name)}</span>
      <span class="cum-score">${cum[p.id] || 0} pts</span>
    </div>`
  ).join('');

  // Actions
  const actions = modal.querySelector('.winner-actions');
  const connectedCount = gs.players.filter(p => p.connected !== false).length;
  actions.innerHTML = `
    <button class="btn btn-primary" id="restartVoteBtn" onclick="restartGame()">
      Play Again (${State.restartVotes}/${State.restartNeeded || connectedCount})
    </button>
    <button class="btn btn-secondary" onclick="goLobby()">Back to Lobby</button>`;

  modal.classList.remove('hidden');
  if (isMe) {
    launchConfetti();
    SoundEngine.playWin();
  } else {
    SoundEngine.playLose();
  }
}

function launchConfetti() {
  const colors = ['#e74c3c','#3498db','#2ecc71','#f1c40f','#9b59b6','#fff'];
  for (let i = 0; i < 80; i++) {
    setTimeout(() => {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.cssText = `left:${Math.random()*100}vw;background:${colors[Math.floor(Math.random()*colors.length)]};
        width:${Math.random()*10+5}px;height:${Math.random()*10+5}px;
        border-radius:${Math.random()>.5?'50%':'0'};
        animation-duration:${Math.random()*2+2}s;animation-delay:${Math.random()*.5}s;`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 4000);
    }, i * 30);
  }
}

function goLobby() {
  localStorage.removeItem('uno_active_game_id');
  localStorage.removeItem('uno_active_player_id');
  window.location.href = 'index.html';
}

function toggleSound() {
  const on = SoundEngine.toggle();
  const btn = document.getElementById('soundBtn');
  if (btn) btn.textContent = on ? '🔊' : '🔇';
  showToast(on ? 'Sound on' : 'Sound off');
}

// ─── Validation (client-side mirror of backend) ───────────────────────────────
function isValidPlay(card, topCard, currentColor) {
  if (!card || !topCard) return false;
  if (card.type === 'wild' || card.type === 'wildDrawFour') return true;
  if (card.color === currentColor) return true;
  if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;
  if (card.type !== 'number' && card.type === topCard.type) return true;
  return false;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function setStatus(msg) { document.getElementById('statusText').textContent = msg; }
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
