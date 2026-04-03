'use strict';

// ─── Device ID ─────────────────────────────────────────────────────────────
// Persists across tabs on the same browser so the same person can't join twice
function getDeviceId() {
  let id = localStorage.getItem('uno_device_id');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('uno_device_id', id);
  }
  return id;
}

// ─── State ─────────────────────────────────────────────────────────────────
let createdGameId = null;
let createdPlayerId = null;

// ─── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('uno_player_name');
  if (saved) document.getElementById('playerName').value = saved;

  document.getElementById('joinCode').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });
  document.getElementById('joinCode').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame();
  });

  // If we already have a game in progress for this device, offer to rejoin
  checkExistingSession();

  loadOpenGames();
  createParticles();
  setInterval(loadOpenGames, 10000);
});

// ─── Existing session check ────────────────────────────────────────────────
function checkExistingSession() {
  const gameId   = localStorage.getItem('uno_active_game_id');
  const playerId = localStorage.getItem('uno_active_player_id');
  if (!gameId || !playerId) return;

  const banner = document.createElement('div');
  banner.className = 'card-panel rejoin-banner';
  banner.innerHTML = `
    <p>You were in game <strong>${gameId}</strong>.</p>
    <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="rejoinGame('${gameId}','${playerId}')">Rejoin Game</button>
      <button class="btn btn-secondary" onclick="clearSession(this.closest('.rejoin-banner'))">Leave & Start Fresh</button>
    </div>`;

  const container = document.querySelector('.lobby-container');
  container.insertBefore(banner, container.firstChild);
}

function rejoinGame(gameId, playerId) {
  window.location.href = `game.html?gameId=${gameId}&playerId=${playerId}`;
}

function clearSession(el) {
  localStorage.removeItem('uno_active_game_id');
  localStorage.removeItem('uno_active_player_id');
  el?.remove();
}

// ─── Create Game ───────────────────────────────────────────────────────────
async function createGame() {
  const name = getPlayerName();
  if (!name) return;

  const btn = document.getElementById('createGameBtn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  // Always clear old session when creating a new game
  localStorage.removeItem('uno_active_game_id');
  localStorage.removeItem('uno_active_player_id');

  try {
    const res = await fetch(`${API_CONFIG.REST_API_URL}/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name, deviceId: getDeviceId() })
    });

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    createdGameId   = data.gameId;
    createdPlayerId = data.playerId;

    // Store new session — also mark as host
    localStorage.setItem('uno_active_game_id',   createdGameId);
    localStorage.setItem('uno_active_player_id',  createdPlayerId);
    localStorage.setItem('uno_active_is_host',    'true');
    localStorage.setItem('uno_player_name', name);
    sessionStorage.setItem('uno_game_id',    createdGameId);
    sessionStorage.setItem('uno_player_id',  createdPlayerId);
    sessionStorage.setItem('uno_player_name', name);
    sessionStorage.setItem('uno_is_host', 'true');

    document.getElementById('gameCodeText').textContent = createdGameId;
    document.getElementById('gameCodeDisplay').classList.remove('hidden');
    btn.textContent = '✓ Game Created';
    showToast(`Game created! Share code: ${createdGameId}`);
    loadOpenGames();
  } catch (err) {
    console.error(err);
    showToast('Failed to create game. Check your connection.');
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">🎮</span> Create New Game';
  }
}

// ─── Join Game ─────────────────────────────────────────────────────────────
async function joinGame(gameIdOverride) {
  const name = getPlayerName();
  if (!name) return;

  const gameId = (gameIdOverride || document.getElementById('joinCode').value).trim().toUpperCase();
  if (!gameId || gameId.length < 4) {
    showError('joinError', 'Please enter a valid game code');
    return;
  }

  // Prevent double-join: if we already have a playerId for THIS EXACT game, just go there
  const existingGameId   = localStorage.getItem('uno_active_game_id');
  const existingPlayerId = localStorage.getItem('uno_active_player_id');
  if (existingGameId === gameId && existingPlayerId) {
    window.location.href = `game.html?gameId=${gameId}&playerId=${existingPlayerId}`;
    return;
  }

  // Clear old session if joining a different game
  if (existingGameId && existingGameId !== gameId) {
    localStorage.removeItem('uno_active_game_id');
    localStorage.removeItem('uno_active_player_id');
  }

  hideError('joinError');

  // Disable button immediately to prevent double-click
  const joinBtn = document.querySelector('.btn-secondary');
  if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = 'Joining...'; }

  try {
    const res = await fetch(`${API_CONFIG.REST_API_URL}/games/${gameId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name, deviceId: getDeviceId() })
    });

    const data = await res.json();
    if (!res.ok) {
      showError('joinError', data.error || 'Failed to join game');
      if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join →'; }
      return;
    }

    const playerId = data.playerId;

    localStorage.setItem('uno_active_game_id',   gameId);
    localStorage.setItem('uno_active_player_id',  playerId);
    localStorage.setItem('uno_player_name', name);

    sessionStorage.setItem('uno_game_id',    gameId);
    sessionStorage.setItem('uno_player_id',  playerId);
    sessionStorage.setItem('uno_player_name', name);
    sessionStorage.setItem('uno_is_host', data.isHost ? 'true' : 'false');

    window.location.href = `game.html?gameId=${gameId}&playerId=${playerId}`;
  } catch (err) {
    console.error(err);
    showError('joinError', 'Connection error. Please try again.');
    if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join →'; }
  }
}

function enterGame() {
  if (!createdGameId || !createdPlayerId) return;
  window.location.href = `game.html?gameId=${createdGameId}&playerId=${createdPlayerId}`;
}

function copyCode() {
  const code = document.getElementById('gameCodeText').textContent;
  navigator.clipboard.writeText(code).then(() => showToast('Code copied!'));
}

// ─── Open Games ────────────────────────────────────────────────────────────
async function loadOpenGames() {
  const list = document.getElementById('openGamesList');
  try {
    const res = await fetch(`${API_CONFIG.REST_API_URL}/games`);
    const data = await res.json();
    const games = data.games || [];

    if (games.length === 0) {
      list.innerHTML = '<div class="empty-text">No open games. Create one!</div>';
      return;
    }

    list.innerHTML = games.map(g => `
      <div class="game-item">
        <div class="game-item-info">
          <span class="game-item-code">${g.gameId}</span>
          <span class="game-item-players">${g.players.join(', ')}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="player-dots">
            ${Array.from({length: 6}, (_, i) =>
              `<div class="player-dot ${i < g.playerCount ? 'filled' : 'empty'}"></div>`
            ).join('')}
          </div>
          <button class="join-game-btn" onclick="quickJoin('${g.gameId}')">
            Join (${g.playerCount}/6)
          </button>
        </div>
      </div>
    `).join('');
  } catch {
    list.innerHTML = '<div class="empty-text">Could not load games</div>';
  }
}

function quickJoin(gameId) {
  document.getElementById('joinCode').value = gameId;
  joinGame(gameId);
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function getPlayerName() {
  const name = document.getElementById('playerName').value.trim();
  if (!name) {
    document.getElementById('playerName').focus();
    showToast('Please enter your name first');
    return null;
  }
  localStorage.setItem('uno_player_name', name);
  return name;
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(id) {
  document.getElementById(id).classList.add('hidden');
}

let toastTimer;
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function createParticles() {
  const container = document.getElementById('bgCards');
  const colors = ['#D32F2F','#1565C0','#2E7D32','#F9A825'];
  for (let i = 0; i < 12; i++) {
    const div = document.createElement('div');
    div.className = 'bg-card-float';
    const color = colors[i % colors.length];
    const size = Math.random() * 50 + 40;
    div.style.cssText = `
      width:${size}px; height:${size*1.5}px;
      background:${color};
      left:${Math.random()*100}%;
      animation-duration:${Math.random()*15+12}s;
      animation-delay:${Math.random()*-20}s;
    `;
    container.appendChild(div);
  }
}
