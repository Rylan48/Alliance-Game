import { STORAGE_KEY, DEFAULT_ICONS, DEFAULT_COLORS } from "../config/game.js";
import { createLocalId } from "../utils/helpers.js";

export const state = {
  profile: {
    id: createLocalId("player"),
    name: "",
    icon: DEFAULT_ICONS[0],
    color: DEFAULT_COLORS[0],
    diedLobbyIds: []
  },
  lobbies: [],
  currentLobbyId: null,
  currentScreen: "lobby",
  activeAction: null,
  selectedPlayerId: null,
  networkMode: true
};

export function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      profile: state.profile,
      lobbies: state.lobbies,
      currentLobbyId: state.currentLobbyId,
      currentScreen: state.currentScreen,
      selectedPlayerId: state.selectedPlayerId
    })
  );
}

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.profile) {
      state.profile = { ...state.profile, ...parsed.profile };
    }
    if (Array.isArray(parsed.lobbies)) {
      state.lobbies = parsed.lobbies;
    }
    if (parsed.currentLobbyId) {
      state.currentLobbyId = parsed.currentLobbyId;
    }
    if (parsed.currentScreen) {
      state.currentScreen = parsed.currentScreen;
    }
    state.selectedPlayerId = parsed.selectedPlayerId || null;
  } catch (error) {
    console.warn("Unable to restore local state", error);
  }
}

export function getCurrentLobby() {
  if (!state.currentLobbyId) {
    return null;
  }
  return state.lobbies.find((lobby) => lobby.id === state.currentLobbyId) || null;
}

export function getCurrentPlayerInLobby() {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    return null;
  }
  return lobby.game.players.find((player) => player.id === state.profile.id) || null;
}

export function isPlayerInAnyActiveGame() {
  return state.lobbies.some((lobby) => {
    if (!lobby.game) {
      return false;
    }
    return lobby.game.players.some((player) => player.id === state.profile.id);
  });
}

export function hasDiedInLobby(lobbyId) {
  return Array.isArray(state.profile.diedLobbyIds) && state.profile.diedLobbyIds.includes(lobbyId);
}

export function canVoteInLobby(lobby) {
  if (!lobby) {
    return false;
  }
  return hasDiedInLobby(lobby.id);
}

export function getJurorEntry(lobby, playerId) {
  if (!lobby || !lobby.game || !Array.isArray(lobby.game.jury)) {
    return null;
  }
  return lobby.game.jury.find((entry) => entry.playerId === playerId) || null;
}

export function addJurorIfNeeded(lobby, playerId) {
  if (!lobby || !lobby.game || !playerId) {
    return;
  }

  if (!Array.isArray(lobby.game.jury)) {
    lobby.game.jury = [];
  }

  if (!getJurorEntry(lobby, playerId)) {
    lobby.game.jury.push({ playerId, hasVoted: false, voteTargetId: null });
  }
}

export function clearJurorVote(lobby, playerId) {
  const juror = getJurorEntry(lobby, playerId);
  if (!juror) {
    return;
  }
  juror.hasVoted = false;
  juror.voteTargetId = null;
}

export function registerDeathForPlayer(lobby, playerId) {
  if (!lobby || !playerId) {
    return;
  }

  const profile = state.profile;
  if (!profile || profile.id !== playerId) {
    return;
  }

  if (!Array.isArray(profile.diedLobbyIds)) {
    profile.diedLobbyIds = [];
  }

  if (!profile.diedLobbyIds.includes(lobby.id)) {
    profile.diedLobbyIds.push(lobby.id);
  }
}

export function pruneCompletedLobbies() {
  const remaining = [];

  state.lobbies.forEach((lobby) => {
    if (lobby.winner) {
      if (state.currentLobbyId === lobby.id) {
        state.currentLobbyId = null;
        state.currentScreen = "lobby";
        state.activeAction = null;
        state.selectedPlayerId = null;
      }
      return;
    }

    const livingPlayers = lobby.game ? lobby.game.players.filter((player) => !player.isDowned) : [];
    if (lobby.game && livingPlayers.length === 0) {
      if (state.currentLobbyId === lobby.id) {
        state.currentLobbyId = null;
        state.currentScreen = "lobby";
        state.activeAction = null;
        state.selectedPlayerId = null;
      }
      return;
    }

    remaining.push(lobby);
  });

  state.lobbies = remaining;
}

export function getSelectedPlayer(lobby = getCurrentLobby()) {
  if (!lobby || !lobby.game) {
    return null;
  }

  if (!lobby.settings || !lobby.settings.isTestLobby) {
    const current = getCurrentPlayerInLobby();
    return current || lobby.game.players[0] || null;
  }

  const selectedId = state.selectedPlayerId || state.profile.id;
  return lobby.game.players.find((player) => player.id === selectedId) || lobby.game.players[0] || null;
}
