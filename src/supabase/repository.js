const { getSupabaseClient } = require('./client');

function makeShareCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

async function ensureProfile({ displayName, icon = '⚔️', color = '#4a7ae8', authUserId = null } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured. Add SUPABASE_URL and a key to your environment.');
  }

  const payload = {
    auth_user_id: authUserId,
    display_name: displayName,
    icon,
    color
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: authUserId ? 'auth_user_id' : 'id' })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function listLobbies() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured. Add SUPABASE_URL and a key to your environment.');
  }

  const { data, error } = await supabase
    .from('lobbies')
    .select('*, lobby_players(*)')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data || []).map((lobby) => {
    const players = Array.isArray(lobby.lobby_players) ? lobby.lobby_players : [];
    return {
      id: lobby.id,
      name: lobby.name,
      hostId: lobby.host_profile_id,
      status: lobby.status,
      shareCode: lobby.share_code,
      settings: lobby.settings || {},
      players: players.map((entry) => ({
        id: entry.profile_id,
        isHost: Boolean(entry.is_host),
        isReady: Boolean(entry.is_ready),
        joinedAt: entry.joined_at,
        seatName: entry.seat_name || null
      })),
      gameId: null,
      game: null,
      playerCount: players.length
    };
  });
}

async function createLobby({ name, hostProfileId, settings = {} } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured. Add SUPABASE_URL and a key to your environment.');
  }

  const lobbyPayload = {
    name: String(name || 'Alliance lobby').trim() || 'Alliance lobby',
    host_profile_id: hostProfileId,
    status: 'queue',
    share_code: makeShareCode(),
    settings: {
      ...settings,
      gridSize: Number(settings.gridSize || settings.grid_size || 14),
      refreshMode: settings.refreshMode || settings.refresh_mode || 'standard',
      refreshTimePst: settings.refreshTimePst || settings.refresh_time_pst || '20:00',
      quickRefresh: settings.quickRefresh || settings.quick_refresh || '12:00',
      allowZoneShrink: Boolean(settings.allowZoneShrink ?? settings.allow_zone_shrink),
      zoneShrinkEvery: Number(settings.zoneShrinkEvery || settings.zone_shrink_every || 1),
      isTestLobby: Boolean(settings.isTestLobby ?? settings.is_test_lobby)
    }
  };

  const { data, error } = await supabase
    .from('lobbies')
    .insert(lobbyPayload)
    .select()
    .single();

  if (error) {
    throw error;
  }

  const playerPayload = {
    lobby_id: data.id,
    profile_id: hostProfileId,
    is_host: true,
    is_ready: true,
    last_seen_at: new Date().toISOString()
  };

  const { error: memberError } = await supabase
    .from('lobby_players')
    .upsert(playerPayload, { onConflict: 'lobby_id,profile_id' });

  if (memberError) {
    throw memberError;
  }

  return {
    id: data.id,
    name: data.name,
    hostId: data.host_profile_id,
    status: data.status,
    shareCode: data.share_code,
    settings: data.settings || {},
    players: [{ id: hostProfileId, isHost: true, isReady: true }],
    gameId: null,
    game: null
  };
}

async function joinLobby({ lobbyId, profileId, displayName, icon = '⚔️', color = '#4a7ae8' } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured. Add SUPABASE_URL and a key to your environment.');
  }

  if (!lobbyId || !profileId) {
    throw new Error('lobbyId and profileId are required');
  }

  let lobby = null;
  let lobbyError = null;

  const { data: shareCodeLobby, error: shareCodeError } = await supabase
    .from('lobbies')
    .select('*')
    .eq('share_code', lobbyId)
    .maybeSingle();

  if (shareCodeError) {
    lobbyError = shareCodeError;
  } else if (shareCodeLobby) {
    lobby = shareCodeLobby;
  } else {
    const { data: idLobby, error: idError } = await supabase
      .from('lobbies')
      .select('*')
      .eq('id', lobbyId)
      .maybeSingle();

    if (idError) {
      lobbyError = idError;
    } else {
      lobby = idLobby;
    }
  }

  if (lobbyError) {
    throw lobbyError;
  }

  if (!lobby) {
    throw new Error('lobby not found');
  }

  const resolvedLobbyId = lobby.id;

  const { data: existing } = await supabase
    .from('lobby_players')
    .select('id')
    .eq('lobby_id', resolvedLobbyId)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase
      .from('lobby_players')
      .insert({
        lobby_id: resolvedLobbyId,
        profile_id: profileId,
        is_host: false,
        is_ready: true,
        last_seen_at: new Date().toISOString()
      });

    if (error) {
      throw error;
    }
  }

  const { data: members } = await supabase
    .from('lobby_players')
    .select('*')
    .eq('lobby_id', resolvedLobbyId);

  return {
    id: lobby.id,
    name: lobby.name,
    hostId: lobby.host_profile_id,
    status: lobby.status,
    shareCode: lobby.share_code,
    settings: lobby.settings || {},
    players: (members || []).map((member) => ({
      id: member.profile_id,
      isHost: Boolean(member.is_host),
      isReady: Boolean(member.is_ready),
      displayName,
      icon,
      color
    })),
    gameId: null,
    game: null
  };
}

async function startGameForLobby({ lobbyId } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured. Add SUPABASE_URL and a key to your environment.');
  }

  if (!lobbyId) {
    throw new Error('lobbyId is required');
  }

  const { data: lobby, error: lobbyError } = await supabase
    .from('lobbies')
    .select('*')
    .eq('id', lobbyId)
    .maybeSingle();

  if (lobbyError) {
    throw lobbyError;
  }

  if (!lobby) {
    throw new Error('lobby not found');
  }

  const { data: existingGame } = await supabase
    .from('games')
    .select('*')
    .eq('lobby_id', lobby.id)
    .maybeSingle();

  if (existingGame) {
    const { data: players } = await supabase
      .from('game_players')
      .select('*')
      .eq('game_id', existingGame.id);

    return {
      id: existingGame.id,
      lobbyId: existingGame.lobby_id,
      gridSize: existingGame.grid_size,
      status: existingGame.status,
      startedAt: existingGame.started_at,
      nextRefreshAt: existingGame.next_refresh_at,
      roundNumber: existingGame.round_number,
      refreshMode: existingGame.refresh_mode,
      refreshTimePst: existingGame.refresh_time_pst,
      quickRefreshMinutes: existingGame.quick_refresh_minutes,
      allowZoneShrink: existingGame.allow_zone_shrink,
      zoneShrinkInterval: existingGame.zone_shrink_interval,
      zoneBounds: existingGame.zone_bounds || { minX: 0, maxX: 11, minY: 0, maxY: 11 },
      zonePreview: existingGame.zone_preview || [],
      dangerZone: existingGame.danger_zone || [],
      winnerProfileId: existingGame.winner_profile_id,
      players: (players || []).map((player) => ({
        id: player.profile_id,
        displayName: player.display_name,
        icon: player.icon,
        color: player.color,
        x: player.x,
        y: player.y,
        health: player.health,
        maxHealth: player.max_health,
        range: player.range,
        ap: player.ap,
        isDowned: Boolean(player.is_downed),
        alive: Boolean(player.alive),
        lastActionAt: player.last_action_at,
        lastRefreshAt: player.last_refresh_at,
        revivedAt: player.revived_at
      }))
    };
  }

  const { data: members } = await supabase
    .from('lobby_players')
    .select('*')
    .eq('lobby_id', lobby.id);

  const playerRows = members || [];
  const gridSize = Number(lobby.settings && lobby.settings.gridSize ? lobby.settings.gridSize : 14);
  const occupied = new Set();
  const spawnedPlayers = playerRows.map((member) => {
    let x = 0;
    let y = 0;
    do {
      x = Math.floor(Math.random() * gridSize);
      y = Math.floor(Math.random() * gridSize);
    } while (occupied.has(`${x},${y}`));
    occupied.add(`${x},${y}`);

    return {
      profile_id: member.profile_id,
      x,
      y,
      display_name: member.seat_name || 'Player',
      icon: '⚔️',
      color: '#4a7ae8',
      health: 3,
      max_health: 3,
      range: 3,
      ap: 1,
      is_downed: false,
      alive: true,
      last_action_at: null,
      last_refresh_at: null,
      revived_at: null
    };
  });

  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      lobby_id: lobby.id,
      grid_size: gridSize,
      status: 'started',
      started_at: new Date().toISOString(),
      next_refresh_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      round_number: 0,
      refresh_mode: lobby.settings && lobby.settings.refreshMode === 'quick' ? 'quick' : 'standard',
      refresh_time_pst: (lobby.settings && lobby.settings.refreshTimePst) || '20:00',
      quick_refresh_minutes: 720,
      allow_zone_shrink: Boolean(lobby.settings && lobby.settings.allowZoneShrink),
      zone_shrink_interval: Number((lobby.settings && lobby.settings.zoneShrinkEvery) || 1),
      zone_bounds: { minX: 0, maxX: gridSize - 1, minY: 0, maxY: gridSize - 1 },
      zone_preview: [],
      danger_zone: [],
      winner_profile_id: null
    })
    .select()
    .single();

  if (gameError) {
    throw gameError;
  }

  const enrichedPlayers = spawnedPlayers.map((player) => ({
    ...player,
    game_id: game.id
  }));

  const { error: playersError } = await supabase
    .from('game_players')
    .insert(enrichedPlayers);

  if (playersError) {
    throw playersError;
  }

  const { data: createdPlayers } = await supabase
    .from('game_players')
    .select('*')
    .eq('game_id', game.id);

  return {
    id: game.id,
    lobbyId: game.lobby_id,
    gridSize: game.grid_size,
    status: game.status,
    startedAt: game.started_at,
    nextRefreshAt: game.next_refresh_at,
    roundNumber: game.round_number,
    refreshMode: game.refresh_mode,
    refreshTimePst: game.refresh_time_pst,
    quickRefreshMinutes: game.quick_refresh_minutes,
    allowZoneShrink: game.allow_zone_shrink,
    zoneShrinkInterval: game.zone_shrink_interval,
    zoneBounds: game.zone_bounds || { minX: 0, maxX: gridSize - 1, minY: 0, maxY: gridSize - 1 },
    zonePreview: game.zone_preview || [],
    dangerZone: game.danger_zone || [],
    winnerProfileId: game.winner_profile_id,
    players: (createdPlayers || []).map((player) => ({
      id: player.profile_id,
      displayName: player.display_name,
      icon: player.icon,
      color: player.color,
      x: player.x,
      y: player.y,
      health: player.health,
      maxHealth: player.max_health,
      range: player.range,
      ap: player.ap,
      isDowned: Boolean(player.is_downed),
      alive: Boolean(player.alive),
      lastActionAt: player.last_action_at,
      lastRefreshAt: player.last_refresh_at,
      revivedAt: player.revived_at
    }))
  };
}

async function getGameStateForId({ gameId } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured. Add SUPABASE_URL and a key to your environment.');
  }

  if (!gameId) {
    throw new Error('gameId is required');
  }

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();

  if (gameError) {
    throw gameError;
  }

  const { data: players } = await supabase
    .from('game_players')
    .select('*')
    .eq('game_id', game.id);

  return {
    id: game.id,
    lobbyId: game.lobby_id,
    gridSize: game.grid_size,
    status: game.status,
    startedAt: game.started_at,
    nextRefreshAt: game.next_refresh_at,
    roundNumber: game.round_number,
    refreshMode: game.refresh_mode,
    refreshTimePst: game.refresh_time_pst,
    quickRefreshMinutes: game.quick_refresh_minutes,
    allowZoneShrink: game.allow_zone_shrink,
    zoneShrinkInterval: game.zone_shrink_interval,
    zoneBounds: game.zone_bounds || { minX: 0, maxX: game.grid_size - 1, minY: 0, maxY: game.grid_size - 1 },
    zonePreview: game.zone_preview || [],
    dangerZone: game.danger_zone || [],
    winnerProfileId: game.winner_profile_id,
    players: (players || []).map((player) => ({
      id: player.profile_id,
      displayName: player.display_name,
      icon: player.icon,
      color: player.color,
      x: player.x,
      y: player.y,
      health: player.health,
      maxHealth: player.max_health,
      range: player.range,
      ap: player.ap,
      isDowned: Boolean(player.is_downed),
      alive: Boolean(player.alive),
      lastActionAt: player.last_action_at,
      lastRefreshAt: player.last_refresh_at,
      revivedAt: player.revived_at
    }))
  };
}

async function submitGameAction({ gameId, profileId, actionType, payload = {} } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured. Add SUPABASE_URL and a key to your environment.');
  }

  if (!gameId || !profileId || !actionType) {
    throw new Error('gameId, profileId and actionType are required');
  }

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();

  if (gameError) {
    throw gameError;
  }

  const { data: players, error: playersError } = await supabase
    .from('game_players')
    .select('*')
    .eq('game_id', game.id);

  if (playersError) {
    throw playersError;
  }

  const actor = (players || []).find((player) => player.profile_id === profileId);
  if (!actor) {
    throw new Error('player not found');
  }

  const targetId = payload.target_profile_id || payload.targetId || null;
  const target = (players || []).find((player) => player.profile_id === targetId);

  if (actionType === 'move') {
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Move requires x and y payload values');
    }

    const isAdjacent = Math.abs(actor.x - x) + Math.abs(actor.y - y) === 1;
    const isWithinBoard = x >= 0 && x < game.grid_size && y >= 0 && y < game.grid_size;
    const occupied = (players || []).some((player) => player.profile_id !== profileId && player.x === x && player.y === y);

    if (actor.ap < 1 || !isAdjacent || !isWithinBoard || occupied) {
      throw new Error('Move is not valid');
    }

    actor.x = x;
    actor.y = y;
    actor.ap -= 1;
  } else if (actionType === 'attack') {
    if (!target || actor.ap < 1 || target.profile_id === profileId || target.is_downed) {
      throw new Error('Attack target is invalid');
    }

    const dx = Math.abs(actor.x - target.x);
    const dy = Math.abs(actor.y - target.y);
    const inRange = dx <= actor.range && dy <= actor.range && (dx + dy <= actor.range + 1 || dx === 0 || dy === 0);
    if (!inRange) {
      throw new Error('Attack target is invalid');
    }

    actor.ap -= 1;
    target.health -= 1;
    if (target.health <= 0) {
      target.health = 0;
      target.is_downed = true;
      target.alive = false;
      target.ap = 0;
    }
  } else if (actionType === 'upgrade_range') {
    const cost = actor.range >= 6 ? 3 : 2;
    if (actor.ap < cost) {
      throw new Error('Not enough AP to upgrade range');
    }
    actor.ap -= cost;
    actor.range += 1;
  } else {
    throw new Error('Unsupported action type');
  }

  const { error: updateError } = await supabase
    .from('game_players')
    .update({
      x: actor.x,
      y: actor.y,
      ap: actor.ap,
      health: actor.health,
      range: actor.range,
      is_downed: actor.is_downed,
      alive: actor.alive,
      updated_at: new Date().toISOString()
    })
    .eq('game_id', game.id)
    .eq('profile_id', profileId);

  if (updateError) {
    throw updateError;
  }

  if (target && target.profile_id !== profileId) {
    const { error: targetError } = await supabase
      .from('game_players')
      .update({
        health: target.health,
        is_downed: target.is_downed,
        alive: target.alive,
        ap: target.ap,
        updated_at: new Date().toISOString()
      })
      .eq('game_id', game.id)
      .eq('profile_id', target.profile_id);

    if (targetError) {
      throw targetError;
    }
  }

  const { error: logError } = await supabase
    .from('game_actions')
    .insert({
      game_id: game.id,
      actor_profile_id: profileId,
      action_type: actionType,
      target_profile_id: targetId,
      payload: payload || {},
      validated: true,
      validation_error: null
    });

  if (logError) {
    throw logError;
  }

  return getGameStateForId({ gameId: game.id });
}

module.exports = {
  ensureProfile,
  listLobbies,
  createLobby,
  joinLobby,
  startGameForLobby,
  getGameStateForId,
  submitGameAction
};
