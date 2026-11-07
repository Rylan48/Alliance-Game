const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const stateFile = path.join(dataDir, 'alliance-state.json');

let store = { lobbies: [] };

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, JSON.stringify(store, null, 2));
    return;
  }

  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    store = JSON.parse(raw);
    if (!Array.isArray(store.lobbies)) {
      store.lobbies = [];
    }
  } catch (error) {
    console.warn('Unable to parse stored state, starting fresh.', error);
    store = { lobbies: [] };
  }
}

function persistStore() {
  ensureDataDir();
  fs.writeFileSync(stateFile, JSON.stringify(store, null, 2));
}

function createId(prefix = 'item') {
  return `${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseQuickRefreshMinutes(value) {
  const raw = String(value || '12:00').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return 12 * 60;
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes <= 0) {
    return 12 * 60;
  }
  return Math.min(totalMinutes, 24 * 60);
}

function getQuickRefreshDelayMs(value) {
  return parseQuickRefreshMinutes(value) * 60 * 1000;
}

function getNextRefreshAt(now, pstTimeValue = '20:00', mode = 'standard', quickValue = '12:00') {
  if (mode === 'quick') {
    return new Date(now.getTime() + getQuickRefreshDelayMs(quickValue)).toISOString();
  }

  const [hourRaw = '20', minuteRaw = '00'] = String(pstTimeValue || '20:00').split(':');
  const hour = clamp(Number(hourRaw) || 20, 0, 23);
  const minute = clamp(Number(minuteRaw) || 0, 0, 59);

  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.toISOString();
}

function getCellKey(x, y) {
  return `${x},${y}`;
}

function isInRange(from, to, range) {
  const dx = Math.abs(from.x - to.x);
  const dy = Math.abs(from.y - to.y);
  if (dx === 0 && dy === 0) {
    return false;
  }
  if (dx === 0 || dy === 0) {
    return dx + dy <= range;
  }
  const maxDiagonal = Math.max(0, range - 1);
  return dx <= maxDiagonal && dy <= maxDiagonal && dx + dy <= range + 1;
}

function getZoneBounds(game) {
  const bounds = game.zoneBounds || { minX: 0, maxX: game.gridSize - 1, minY: 0, maxY: game.gridSize - 1 };
  return {
    minX: Number.isFinite(bounds.minX) ? bounds.minX : 0,
    maxX: Number.isFinite(bounds.maxX) ? bounds.maxX : game.gridSize - 1,
    minY: Number.isFinite(bounds.minY) ? bounds.minY : 0,
    maxY: Number.isFinite(bounds.maxY) ? bounds.maxY : game.gridSize - 1
  };
}

function getZoneProgress(game) {
  if (!game.allowZoneShrink) {
    return { preview: false, shrinking: false, roundsUntilShrink: 0 };
  }

  const interval = Math.max(1, Number(game.zoneShrinkEvery) || 1);
  const countdown = Number(game.zoneCountdown ?? (interval + 1));

  if (countdown <= 0) {
    return { preview: false, shrinking: true, roundsUntilShrink: 0 };
  }
  if (countdown === 1) {
    return { preview: true, shrinking: false, roundsUntilShrink: 1 };
  }
  return { preview: false, shrinking: false, roundsUntilShrink: countdown };
}

function setZonePreview(game) {
  if (!game.allowZoneShrink) {
    game.zonePreview = [];
    return;
  }

  const zoneState = getZoneProgress(game);
  if (!zoneState.preview) {
    game.zonePreview = [];
    return;
  }

  const bounds = getZoneBounds(game);
  const nextBounds = {
    minX: bounds.minX + 1,
    maxX: bounds.maxX - 1,
    minY: bounds.minY + 1,
    maxY: bounds.maxY - 1
  };

  const preview = new Set();
  for (let y = 0; y < game.gridSize; y += 1) {
    for (let x = 0; x < game.gridSize; x += 1) {
      const insideCurrent = x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
      const insideNext = x >= nextBounds.minX && x <= nextBounds.maxX && y >= nextBounds.minY && y <= nextBounds.maxY;
      if (insideCurrent && !insideNext) {
        preview.add(getCellKey(x, y));
      }
    }
  }

  game.zonePreview = Array.from(preview);
}

function applyZoneShrink(game) {
  if (!game.allowZoneShrink) {
    return;
  }

  const interval = Math.max(1, Number(game.zoneShrinkEvery) || 1);
  game.zoneCountdown = interval;

  const bounds = getZoneBounds(game);
  const nextBounds = {
    minX: Math.min(bounds.minX + 1, game.gridSize - 1),
    maxX: Math.max(bounds.maxX - 1, 0),
    minY: Math.min(bounds.minY + 1, game.gridSize - 1),
    maxY: Math.max(bounds.maxY - 1, 0)
  };

  game.zoneBounds = nextBounds;
  game.zonePreview = [];

  game.players.forEach((player) => {
    if (player.isDowned) {
      return;
    }

    const inBadZone = player.x < nextBounds.minX || player.x > nextBounds.maxX || player.y < nextBounds.minY || player.y > nextBounds.maxY;
    if (!inBadZone) {
      return;
    }

    player.health -= 1;
    if (player.health <= 0) {
      player.health = 0;
      player.isDowned = true;
      player.alive = false;
      player.ap = 0;
      game.logs.unshift(`${player.name} was swallowed by the shrinking zone.`);
    }
  });
}

function applyBadZoneDamage(game) {
  if (!game.allowZoneShrink) {
    return;
  }

  const bounds = getZoneBounds(game);
  const hasDanger = bounds.minX > 0 || bounds.maxX < game.gridSize - 1 || bounds.minY > 0 || bounds.maxY < game.gridSize - 1;
  if (!hasDanger) {
    return;
  }

  game.players.forEach((player) => {
    if (player.isDowned) {
      return;
    }

    const inBadZone = player.x < bounds.minX || player.x > bounds.maxX || player.y < bounds.minY || player.y > bounds.maxY;
    if (!inBadZone) {
      return;
    }

    player.health -= 1;
    if (player.health <= 0) {
      player.health = 0;
      player.isDowned = true;
      player.alive = false;
      player.ap = 0;
      game.logs.unshift(`${player.name} was lost in the danger zone.`);
    }
  });
}

function advanceRefresh(lobby) {
  if (!lobby || !lobby.game) {
    return false;
  }

  const game = lobby.game;
  const refreshIntervalMs = game.refreshMode === 'quick' ? getQuickRefreshDelayMs(game.quickRefresh || '12:00') : 24 * 60 * 60 * 1000;

  let advanced = false;
  while (new Date(game.nextRefreshAt).getTime() <= Date.now()) {
    advanced = true;
    game.roundNumber = (game.roundNumber || 0) + 1;

    if (game.allowZoneShrink) {
      const interval = clamp(Number(game.zoneShrinkEvery) || 1, 1, 10);
      const countdown = Number(game.zoneCountdown ?? (interval + 1));

      if (countdown <= 1) {
        applyZoneShrink(game);
        game.zoneCountdown = interval;
      } else {
        game.zoneCountdown = countdown - 1;
        const bounds = getZoneBounds(game);
        const hasActiveDanger = bounds.minX > 0 || bounds.maxX < game.gridSize - 1 || bounds.minY > 0 || bounds.maxY < game.gridSize - 1;

        if (hasActiveDanger) {
          applyBadZoneDamage(game);
        } else {
          const zoneState = getZoneProgress(game);
          if (zoneState.preview) {
            setZonePreview(game);
          } else {
            game.zonePreview = [];
          }
        }
      }
    }

    game.players.forEach((player) => {
      if (!player.isDowned) {
        player.ap += 1;
      }
    });

    game.jury = [];
    game.logs.unshift(`${game.refreshMode === 'quick' ? 'AP interval refresh' : 'Daily refresh'}: all living players gained +1 AP.`);
    game.logs = game.logs.slice(0, 25);
    game.nextRefreshAt = new Date(new Date(game.nextRefreshAt).getTime() + refreshIntervalMs).toISOString();
  }

  return advanced;
}

function serializeGame(game) {
  return {
    id: game.id,
    lobbyId: game.lobbyId,
    gridSize: game.gridSize,
    allowZoneShrink: Boolean(game.allowZoneShrink),
    zoneShrinkEvery: clamp(Number(game.zoneShrinkEvery) || 1, 1, 10),
    zoneBounds: getZoneBounds(game),
    zoneCountdown: Number(game.zoneCountdown ?? 0),
    zonePreview: Array.isArray(game.zonePreview) ? game.zonePreview : [],
    refreshMode: game.refreshMode || 'standard',
    quickRefresh: game.quickRefresh || '12:00',
    nextRefreshAt: game.nextRefreshAt,
    roundNumber: Number(game.roundNumber || 0),
    logs: Array.isArray(game.logs) ? game.logs : [],
    jury: Array.isArray(game.jury) ? game.jury : [],
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      icon: player.icon,
      color: player.color,
      x: player.x,
      y: player.y,
      health: player.health,
      maxHealth: player.maxHealth,
      range: player.range,
      upgradeCost: player.upgradeCost ?? 2,
      ap: player.ap,
      isDowned: Boolean(player.isDowned),
      alive: Boolean(player.alive),
      isHost: Boolean(player.isHost)
    }))
  };
}

function serializeLobby(lobby) {
  return {
    id: lobby.id,
    name: lobby.name,
    hostId: lobby.hostId,
    settings: {
      ...lobby.settings,
      gridSize: Number(lobby.settings.gridSize || 14),
      refreshMode: lobby.settings.refreshMode || 'standard',
      refreshTimePst: lobby.settings.refreshTimePst || '20:00',
      quickRefresh: lobby.settings.quickRefresh || '12:00',
      allowZoneShrink: Boolean(lobby.settings.allowZoneShrink),
      zoneShrinkEvery: clamp(Number(lobby.settings.zoneShrinkEvery) || 1, 1, 10),
      isTestLobby: Boolean(lobby.settings.isTestLobby),
      fakePlayerCount: Number(lobby.settings.fakePlayerCount || 0)
    },
    players: lobby.players.map((player) => ({
      id: player.id,
      name: player.name,
      icon: player.icon,
      color: player.color,
      isHost: Boolean(player.isHost)
    })),
    game: lobby.game ? serializeGame(lobby.game) : null,
    gameId: lobby.game ? lobby.game.id : null
  };
}

function findLobbyById(lobbyId) {
  return store.lobbies.find((lobby) => lobby.id === lobbyId) || null;
}

function findGameById(gameId) {
  for (const lobby of store.lobbies) {
    if (lobby.game && lobby.game.id === gameId) {
      return lobby.game;
    }
  }
  return null;
}

function getPlayerById(game, playerId) {
  return game.players.find((player) => player.id === playerId) || null;
}

function createLobby(req, res) {
  const { name, hostId, settings = {} } = req.body || {};
  if (!hostId) {
    return res.status(400).json({ ok: false, error: 'hostId required' });
  }

  const lobby = {
    id: createId('lobby'),
    name: String(name || 'Alliance lobby').trim() || 'Alliance lobby',
    hostId,
    settings: {
      gridSize: clamp(Number(settings.gridSize) || 14, 8, 24),
      refreshMode: settings.refreshMode || 'standard',
      refreshTimePst: settings.refreshTimePst || '20:00',
      quickRefresh: settings.quickRefresh || '12:00',
      allowZoneShrink: Boolean(settings.allowZoneShrink),
      zoneShrinkEvery: clamp(Number(settings.zoneShrinkEvery) || 1, 1, 10),
      isTestLobby: Boolean(settings.isTestLobby),
      fakePlayerCount: clamp(Number(settings.fakePlayerCount) || 0, 0, 19)
    },
    players: [{
      id: hostId,
      name: String(settings.hostName || 'Player').trim() || 'Player',
      icon: settings.hostIcon || '⚔️',
      color: settings.hostColor || '#4a7ae8',
      isHost: true
    }],
    game: null,
    winner: null
  };

  store.lobbies.unshift(lobby);
  persistStore();
  res.json({ ok: true, lobby: serializeLobby(lobby) });
}

function joinLobby(req, res) {
  const { lobbyId, player } = req.body || {};
  const lobby = findLobbyById(lobbyId);
  if (!lobby) {
    return res.status(404).json({ ok: false, error: 'lobby not found' });
  }
  if (lobby.game) {
    return res.status(409).json({ ok: false, error: 'match already started' });
  }

  const existing = lobby.players.find((entry) => entry.id === player.id);
  if (!existing) {
    lobby.players.push({
      id: player.id,
      name: String(player.name || 'Player').trim() || 'Player',
      icon: player.icon || '⚔️',
      color: player.color || '#4a7ae8',
      isHost: false
    });
  }

  persistStore();
  res.json({ ok: true, lobby: serializeLobby(lobby) });
}

function startMatch(req, res) {
  const { lobbyId } = req.params || {};
  const lobby = findLobbyById(lobbyId);
  if (!lobby) {
    return res.status(404).json({ ok: false, error: 'lobby not found' });
  }
  if (lobby.game) {
    return res.json({ ok: true, game: serializeGame(lobby.game), lobby: serializeLobby(lobby) });
  }

  const occupied = new Set();
  const players = lobby.players.map((member) => {
    let x = 0;
    let y = 0;
    do {
      x = Math.floor(Math.random() * lobby.settings.gridSize);
      y = Math.floor(Math.random() * lobby.settings.gridSize);
    } while (occupied.has(getCellKey(x, y)));

    occupied.add(getCellKey(x, y));
    return {
      id: member.id,
      name: member.name || 'Player',
      icon: member.icon || '⚔️',
      color: member.color || '#4a7ae8',
      x,
      y,
      health: 3,
      maxHealth: 3,
      range: 3,
      upgradeCost: 2,
      ap: 1,
      isDowned: false,
      alive: true,
      isHost: Boolean(member.isHost)
    };
  });

  lobby.game = {
    id: createId('game'),
    lobbyId: lobby.id,
    gridSize: lobby.settings.gridSize,
    allowZoneShrink: Boolean(lobby.settings.allowZoneShrink),
    zoneShrinkEvery: clamp(Number(lobby.settings.zoneShrinkEvery) || 1, 1, 10),
    zoneBounds: {
      minX: 0,
      maxX: lobby.settings.gridSize - 1,
      minY: 0,
      maxY: lobby.settings.gridSize - 1
    },
    zoneCountdown: lobby.settings.allowZoneShrink ? clamp(Number(lobby.settings.zoneShrinkEvery) || 1, 1, 10) + 1 : 0,
    zonePreview: [],
    refreshMode: lobby.settings.refreshMode || 'standard',
    quickRefresh: lobby.settings.quickRefresh || '12:00',
    nextRefreshAt: getNextRefreshAt(new Date(), lobby.settings.refreshTimePst || '20:00', lobby.settings.refreshMode || 'standard', lobby.settings.quickRefresh || '12:00'),
    roundNumber: 0,
    logs: [`${lobby.name} has started. Everyone begins with 1 AP.`],
    jury: [],
    players,
    winner: null
  };

  persistStore();
  res.json({ ok: true, game: serializeGame(lobby.game), lobby: serializeLobby(lobby) });
}

function listLobbies(req, res) {
  store.lobbies.forEach((lobby) => {
    if (lobby.game) {
      advanceRefresh(lobby);
    }
  });
  persistStore();

  res.json({
    ok: true,
    lobbies: store.lobbies.map((lobby) => serializeLobby(lobby))
  });
}

function getGameState(req, res) {
  const { gameId } = req.params || {};
  const game = findGameById(gameId);
  if (!game) {
    return res.status(404).json({ ok: false, error: 'game not found' });
  }

  const lobby = findLobbyById(game.lobbyId);
  if (lobby) {
    advanceRefresh(lobby);
  }
  persistStore();

  res.json({ ok: true, game: serializeGame(game) });
}

function submitAction(req, res) {
  const { gameId } = req.params || {};
  const game = findGameById(gameId);
  if (!game) {
    return res.status(404).json({ ok: false, error: 'game not found' });
  }

  const lobby = findLobbyById(game.lobbyId);
  if (lobby) {
    advanceRefresh(lobby);
  }

  const { profile_id, action_type, payload = {} } = req.body || {};
  const actor = getPlayerById(game, profile_id);
  if (!actor) {
    return res.status(404).json({ ok: false, error: 'player not found' });
  }

  if (actor.isDowned) {
    return res.status(400).json({ ok: false, error: 'downed players cannot act' });
  }

  function sendFailure(message) {
    return res.status(400).json({ ok: false, error: message });
  }

  if (action_type === 'move') {
    const x = Number(payload.x);
    const y = Number(payload.y);
    const isAdjacent = Math.abs(actor.x - x) + Math.abs(actor.y - y) === 1;
    const isWithinBoard = x >= 0 && x < game.gridSize && y >= 0 && y < game.gridSize;
    const occupied = game.players.some((other) => other.id !== actor.id && other.x === x && other.y === y);

    if (actor.ap < 1 || !isAdjacent || !isWithinBoard || occupied) {
      return sendFailure('Move is not valid');
    }

    actor.x = x;
    actor.y = y;
    actor.ap -= 1;
    game.logs.unshift(`${actor.name} moved to ${String.fromCharCode(65 + x)}${y + 1}.`);
  } else if (action_type === 'attack') {
    const targetId = payload.target_profile_id || payload.targetId;
    const target = getPlayerById(game, targetId);
    if (!target || target.id === actor.id || target.isDowned || actor.ap < 1 || !isInRange({ x: actor.x, y: actor.y }, { x: target.x, y: target.y }, actor.range)) {
      return sendFailure('Attack target is invalid');
    }

    actor.ap -= 1;
    target.health -= 1;
    game.logs.unshift(`${actor.name} hit ${target.name} for 1 heart.`);
    if (target.health <= 0) {
      target.health = 0;
      target.isDowned = true;
      target.alive = false;
      target.ap = 0;
      game.logs.unshift(`${target.name} was downed.`);
    }
  } else if (action_type === 'gift_ap') {
    const targetId = payload.target_profile_id || payload.targetId;
    const target = getPlayerById(game, targetId);
    if (!target || target.id === actor.id || target.isDowned || actor.ap < 1 || !isInRange({ x: actor.x, y: actor.y }, { x: target.x, y: target.y }, actor.range)) {
      return sendFailure('Gift AP target is invalid');
    }

    actor.ap -= 1;
    target.ap += 1;
    game.logs.unshift(`${actor.name} gifted 1 AP to ${target.name}.`);
  } else if (action_type === 'gift_heart') {
    const targetId = payload.target_profile_id || payload.targetId;
    const target = getPlayerById(game, targetId);
    if (!target || target.id === actor.id || !isInRange({ x: actor.x, y: actor.y }, { x: target.x, y: target.y }, actor.range)) {
      return sendFailure('Gift heart target is invalid');
    }

    if (actor.health >= actor.maxHealth) {
      return sendFailure('You cannot gift a heart while at full health');
    }

    actor.health -= 1;
    if (target.isDowned) {
      target.isDowned = false;
      target.alive = true;
      target.health = 1;
      target.ap = 0;
      game.logs.unshift(`${actor.name} revived ${target.name} with a heart.`);
    } else {
      target.health = Math.min(target.maxHealth, target.health + 1);
      game.logs.unshift(`${actor.name} gifted a heart to ${target.name}.`);
    }

    if (actor.health <= 0) {
      actor.health = 0;
      actor.isDowned = true;
      actor.alive = false;
      actor.ap = 0;
      game.logs.unshift(`${actor.name} gave a heart and was downed.`);
    }
  } else if (action_type === 'upgrade_range') {
    const cost = actor.upgradeCost ?? 2;
    if (actor.ap < cost) {
      return sendFailure('Not enough AP to upgrade range');
    }
    actor.ap -= cost;
    actor.range += 1;
    actor.upgradeCost = cost + 1;
    game.logs.unshift(`${actor.name} upgraded range to ${actor.range}.`);
  } else if (action_type === 'forfeit') {
    actor.isDowned = true;
    actor.health = 0;
    actor.ap = 0;
    actor.alive = false;
    game.logs.unshift(`${actor.name} forfeited the match.`);
  } else if (action_type === 'vote') {
    const targetId = payload.target_profile_id || payload.targetId;
    const target = getPlayerById(game, targetId);
    if (!actor.isDowned || !target || target.id === actor.id) {
      return sendFailure('Vote target is invalid');
    }
    game.jury = game.jury || [];
    const existingVote = game.jury.find((vote) => vote.playerId === actor.id);
    if (existingVote) {
      existingVote.voteTargetId = target.id;
    } else {
      game.jury.push({ playerId: actor.id, voteTargetId: target.id });
    }
    game.logs.unshift(`${actor.name} cast a secret vote.`);
  } else {
    return sendFailure('Unsupported action type');
  }

  persistStore();
  res.json({ ok: true, game: serializeGame(game), lobby: serializeLobby(lobby) });
}

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'Alliance',
    status: 'running',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/lobbies', listLobbies);
app.post('/api/lobbies', createLobby);
app.post('/api/lobbies/join', joinLobby);
app.post('/api/lobbies/:lobbyId/join', joinLobby);
app.post('/api/lobbies/:lobbyId/start', startMatch);
app.get('/api/games/:gameId/state', getGameState);
app.post('/api/games/:gameId/actions', submitAction);

app.use(express.static(rootDir));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Route not found' });
  }
  res.sendFile(path.join(rootDir, 'index.html'));
});

loadStore();
app.listen(PORT, () => {
  console.log(`Alliance app running at http://localhost:${PORT}`);
});
