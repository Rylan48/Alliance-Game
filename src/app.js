import {
  STORAGE_KEY,
  DEFAULT_ICONS,
  DEFAULT_COLORS,
  TEST_NAMES,
  TEST_ICONS,
  DAY_MS,
  QUICK_REFRESH_MS_LIMIT
} from "./config/game.js";
import {
  createLocalId,
  clamp,
  formatTimeLeft,
  getPstParts,
  getPstOffsetMs,
  parseQuickRefreshMinutes,
  getQuickRefreshDelayMs,
  getNextRefreshAt,
  getCellKey,
  toBoardLabel,
  isInRange
} from "./utils/helpers.js";
import {
  getZoneBounds,
  getZoneProgress,
  setZonePreview,
  getZonePreviewSet,
  applyZoneShrink,
  applyBadZoneDamage
} from "./game/zone.js";
import {
  state,
  saveState,
  loadState,
  getCurrentLobby,
  getCurrentPlayerInLobby,
  getSelectedPlayer,
  isPlayerInAnyActiveGame,
  hasDiedInLobby,
  canVoteInLobby,
  registerDeathForPlayer,
  getJurorEntry,
  addJurorIfNeeded,
  clearJurorVote,
  pruneCompletedLobbies
} from "./state/store.js";
import { dom } from "./ui/dom.js";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

async function syncRemoteLobbies() {
  try {
    const response = await fetchJson("/api/lobbies");
    state.lobbies = Array.isArray(response.lobbies) ? response.lobbies : [];

    const activeLobby = state.lobbies.find((lobby) => lobby.id === state.currentLobbyId);
    if (activeLobby && activeLobby.gameId) {
      const gameResponse = await fetchJson(`/api/games/${activeLobby.gameId}/state`);
      const lobbyRef = state.lobbies.find((lobby) => lobby.id === activeLobby.id);
      if (lobbyRef) {
        lobbyRef.game = gameResponse.game;
      }
    }
  } catch (error) {
    console.warn("Unable to sync remote lobby state", error);
  }
}

function setProfileInputs() {
  dom.profileNameInput.value = state.profile.name;
  dom.profileIconInput.value = state.profile.icon || DEFAULT_ICONS[0];
  dom.profileColorInput.value = state.profile.color || DEFAULT_COLORS[0];
}

function syncRefreshModeControls() {
  const mode = dom.refreshModeInput.value || "standard";
  const isQuick = mode === "quick";
  dom.refreshTimeField.classList.toggle("hidden", isQuick);
  dom.quickRefreshField.classList.toggle("hidden", !isQuick);
}

function syncZoneShrinkControls() {
  const enabled = Boolean(dom.shrinkToggleInput.checked);
  dom.shrinkIntervalField.classList.toggle("hidden", !enabled);
  dom.shrinkIntervalInput.disabled = !enabled;
  dom.shrinkIntervalValue.textContent = String(dom.shrinkIntervalInput.value || 1);
}

function syncTestLobbyControls() {
  const enabled = Boolean(dom.testLobbyToggleInput.checked);
  dom.testPlayerCountField.classList.toggle("hidden", !enabled);
  dom.testPlayerCountInput.disabled = !enabled;
  dom.testPlayerCountValue.textContent = String(dom.testPlayerCountInput.value || 5);
}

function openCreateLobbyModal() {
  dom.createLobbyModal.classList.remove("hidden");
  dom.createLobbyModal.setAttribute("aria-hidden", "false");
}

function closeCreateLobbyModal() {
  dom.createLobbyModal.classList.add("hidden");
  dom.createLobbyModal.setAttribute("aria-hidden", "true");
}

function openForfeitModal() {
  dom.forfeitModal.classList.remove("hidden");
  dom.forfeitModal.setAttribute("aria-hidden", "false");
}

function closeForfeitModal() {
  dom.forfeitModal.classList.add("hidden");
  dom.forfeitModal.setAttribute("aria-hidden", "true");
}

function openUpgradeModal() {
  const actor = getCurrentPlayerInLobby();
  const modalText = dom.upgradeModal.querySelector(".confirm-copy p");
  const cost = actor ? (actor.upgradeCost ?? 2) : 2;

  if (modalText) {
    modalText.textContent = `Spend ${cost} AP to increase your range by 1? This cannot be undone.`;
  }

  dom.upgradeModal.classList.remove("hidden");
  dom.upgradeModal.setAttribute("aria-hidden", "false");
}

function closeUpgradeModal() {
  dom.upgradeModal.classList.add("hidden");
  dom.upgradeModal.setAttribute("aria-hidden", "true");
}

function openDeclareWinModal() {
  dom.declareWinModal.classList.remove("hidden");
  dom.declareWinModal.setAttribute("aria-hidden", "false");
}

function closeDeclareWinModal() {
  dom.declareWinModal.classList.add("hidden");
  dom.declareWinModal.setAttribute("aria-hidden", "true");
}

function renderInputLock() {
  dom.profileNameInput.disabled = false;
  dom.profileIconInput.disabled = false;
  dom.profileColorInput.disabled = false;
  dom.saveProfileBtn.disabled = false;
  dom.saveProfileBtn.textContent = "Save identity";
}

function buildTestPlayers(count) {
  const finalCount = clamp(Number(count) || 0, 1, 19);
  return Array.from({ length: finalCount }, (_, index) => {
    const seed = index + 1;
    const name = TEST_NAMES[(seed * 3 + Math.floor(Math.random() * TEST_NAMES.length)) % TEST_NAMES.length];
    const icon = TEST_ICONS[(seed * 2 + Math.floor(Math.random() * TEST_ICONS.length)) % TEST_ICONS.length];
    const color = DEFAULT_COLORS[(seed * 5 + Math.floor(Math.random() * DEFAULT_COLORS.length)) % DEFAULT_COLORS.length];

    return {
      id: createLocalId("test-player"),
      name,
      icon,
      color,
      isHost: false,
      isTest: true
    };
  });
}

async function createLobby(event) {
  event.preventDefault();

  const payload = {
    name: dom.lobbyNameInput.value.trim() || `lobby ${state.lobbies.filter((lobby) => !lobby.game).length + 1}`,
    hostId: state.profile.id,
    settings: {
      gridSize: clamp(Number(dom.gridSizeInput.value) || 14, 8, 24),
      refreshMode: dom.refreshModeInput.value || "standard",
      refreshTimePst: dom.refreshTimeInput.value || "20:00",
      quickRefresh: dom.quickRefreshInput.value || "12:00",
      allowZoneShrink: Boolean(dom.shrinkToggleInput.checked),
      zoneShrinkEvery: clamp(Number(dom.shrinkIntervalInput.value) || 1, 1, 10),
      isTestLobby: Boolean(dom.testLobbyToggleInput.checked),
      fakePlayerCount: clamp(Number(dom.testPlayerCountInput.value) || 5, 1, 19),
      hostName: state.profile.name || "Player",
      hostIcon: state.profile.icon || DEFAULT_ICONS[0],
      hostColor: state.profile.color || DEFAULT_COLORS[0]
    }
  };

  try {
    const response = await fetchJson("/api/lobbies", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.currentLobbyId = response.lobby.id;
    state.currentScreen = "lobby";
    dom.lobbyForm.reset();
    dom.gridSizeInput.value = "14";
    dom.refreshModeInput.value = "standard";
    dom.refreshTimeInput.value = "20:00";
    dom.quickRefreshInput.value = "12:00";
    dom.shrinkToggleInput.checked = false;
    dom.shrinkIntervalInput.value = "1";
    dom.shrinkIntervalValue.textContent = "1";
    dom.testLobbyToggleInput.checked = false;
    dom.testPlayerCountInput.value = "5";
    dom.testPlayerCountValue.textContent = "5";
    dom.testPlayerCountField.classList.add("hidden");
    syncRefreshModeControls();
    syncZoneShrinkControls();
    closeCreateLobbyModal();
    await syncRemoteLobbies();
    saveState();
    render();
  } catch (error) {
    console.error(error);
    alert(error.message || "Unable to create lobby");
  }
}

async function joinLobby(lobbyId) {
  const lobby = state.lobbies.find((entry) => entry.id === lobbyId);
  if (!lobby) {
    return;
  }

  try {
    const response = await fetchJson(`/api/lobbies/${lobby.id}/join`, {
      method: "POST",
      body: JSON.stringify({
        lobbyId: lobby.id,
        player: {
          id: state.profile.id,
          name: state.profile.name || "Player",
          icon: state.profile.icon,
          color: state.profile.color
        }
      })
    });

    state.currentLobbyId = response.lobby.id;
    state.currentScreen = "lobby";
    await syncRemoteLobbies();
    saveState();
    render();
  } catch (error) {
    console.error(error);
    alert(error.message || "Unable to join lobby");
  }
}

async function startMatch() {
  const lobby = getCurrentLobby();
  if (!lobby || lobby.game) {
    return;
  }

  try {
    const response = await fetchJson(`/api/lobbies/${lobby.id}/start`, {
      method: "POST",
      body: JSON.stringify({ lobbyId: lobby.id })
    });

    state.currentLobbyId = lobby.id;
    state.currentScreen = "game";
    state.selectedPlayerId = state.profile.id;
    await syncRemoteLobbies();
    saveState();
    render();
  } catch (error) {
    console.error(error);
    alert(error.message || "Unable to start match");
  }
}

function returnToHub() {
  state.currentScreen = "lobby";
  saveState();
  render();
}

function addGameLog(message, lobby = getCurrentLobby()) {
  if (!lobby || !lobby.game) {
    return;
  }
  lobby.game.logs.unshift(message);
  lobby.game.logs = lobby.game.logs.slice(0, 25);
}

function getPersonalLogEntries() {
  const lobby = getCurrentLobby();
  const player = getCurrentPlayerInLobby();
  if (!lobby || !lobby.game || !player) {
    return [];
  }

  const name = player.name.toLowerCase();
  return lobby.game.logs.filter((entry) => {
    const lower = entry.toLowerCase();
    return lower.includes(name) || lower.includes("you") || lower.includes("your");
  }).slice(0, 10);
}

function refreshDailyAP() {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    return;
  }

  const refreshIntervalMs = lobby.game.refreshMode === "quick"
    ? getQuickRefreshDelayMs(lobby.game.quickRefresh || "12:00")
    : DAY_MS;

  while (lobby.game.nextRefreshAt <= Date.now()) {
    lobby.game.roundNumber = (lobby.game.roundNumber || 0) + 1;

    if (lobby.game.allowZoneShrink) {
      const interval = clamp(Number(lobby.game.zoneShrinkEvery) || 1, 1, 10);
      const currentCountdown = Number(lobby.game.zoneCountdown ?? (interval + 1));

      if (currentCountdown <= 1) {
        applyZoneShrink(lobby);
        lobby.game.zoneCountdown = interval;
      } else {
        lobby.game.zoneCountdown = currentCountdown - 1;
        const bounds = getZoneBounds(lobby);
        const hasActiveDangerZone = bounds.minX > 0 || bounds.maxX < lobby.game.gridSize - 1 || bounds.minY > 0 || bounds.maxY < lobby.game.gridSize - 1;

        if (hasActiveDangerZone) {
          applyBadZoneDamage(lobby);
        } else {
          const zoneState = getZoneProgress(lobby);
          if (zoneState.preview) {
            setZonePreview(lobby);
          } else {
            lobby.game.zonePreview = [];
          }
        }
      }
    }

    const voteCounts = {};
    if (Array.isArray(lobby.game.jury)) {
      lobby.game.jury.forEach((juror) => {
        if (!juror.hasVoted || !juror.voteTargetId) {
          return;
        }
        voteCounts[juror.voteTargetId] = (voteCounts[juror.voteTargetId] || 0) + 1;
      });

      let topTargetId = null;
      let topVotes = 0;
      let tiedForTop = false;

      Object.entries(voteCounts).forEach(([targetId, count]) => {
        if (count > topVotes) {
          topVotes = count;
          topTargetId = targetId;
          tiedForTop = false;
        } else if (count === topVotes && count > 0) {
          tiedForTop = true;
          topTargetId = null;
        }
      });

      if (topTargetId && !tiedForTop && topVotes > 0) {
        const winner = lobby.game.players.find((player) => player.id === topTargetId && !player.isDowned);
        if (winner) {
          winner.ap += 1;
          addGameLog(`${winner.name} received +1 AP from the jury vote.`, lobby);
        }
      }
    }

    lobby.game.players.forEach((player) => {
      if (!player.isDowned) {
        player.ap += 1;
      }
    });

    if (Array.isArray(lobby.game.jury)) {
      lobby.game.jury.forEach((juror) => {
        juror.hasVoted = false;
        juror.voteTargetId = null;
      });
    }

    const refreshLabel = lobby.game.refreshMode === "quick" ? "AP interval refresh" : "Daily refresh";
    addGameLog(`${refreshLabel}: all living players gained +1 AP. Votes were cleared.`, lobby);
    lobby.game.nextRefreshAt += refreshIntervalMs;
  }
}

function renderLobbyList() {
  dom.lobbyList.innerHTML = "";

  if (!state.lobbies.length) {
    dom.lobbyList.innerHTML = "<p class='empty-state'>No queues yet.</p>";
    return;
  }

  state.lobbies.forEach((lobby) => {
    const card = document.createElement("div");
    card.className = "lobby-card";

    const isJoined = lobby.players.some((player) => player.id === state.profile.id) || (lobby.game && lobby.game.players.some((player) => player.id === state.profile.id));
    const isHost = lobby.hostId === state.profile.id;
    const voteAccess = canVoteInLobby(lobby) ? "Voting access: yes" : "Voting access: no";
      const zoneShrinkText = lobby.settings.allowZoneShrink ? "Zone shrink: on" : "Zone shrink: off";
      const testLobbyText = lobby.settings.isTestLobby ? `Test lobby: on (${lobby.settings.fakePlayerCount || 0} fake players)` : "Test lobby: off";

      const info = document.createElement("div");
    info.className = "lobby-info";
    info.innerHTML = `
      <div class="lobby-main-row">
        <h3>${lobby.name}</h3>
        <span class="lobby-status">${lobby.game ? "Live" : "Queue"}</span>
      </div>
      <p class="lobby-meta">${lobby.players.length} players • ${lobby.settings.gridSize}x${lobby.settings.gridSize} • ${lobby.settings.refreshMode === "quick" ? `Refresh every ${lobby.settings.quickRefresh || "12:00"}` : `Refresh ${lobby.settings.refreshTimePst || "20:00"} PST`}</p>
      <p class="lobby-meta">${zoneShrinkText} • ${testLobbyText}</p>
      <p class="lobby-meta">${voteAccess}</p>
      <div class="lobby-player-list">
        ${lobby.players.map((player) => `
          <div class="lobby-player-pill ${player.id === lobby.hostId ? "host" : ""}">
            <span class="player-badge small" style="background:${player.color || "#4a7ae8"};">${player.icon || "⚔️"}</span>
            <span>${player.id === lobby.hostId ? "👑 " : ""}${player.name || "Player"}</span>
          </div>
        `).join("")}
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "lobby-actions";

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "primary";
    viewButton.textContent = "View lobby";

    viewButton.addEventListener("click", () => {
      state.currentLobbyId = lobby.id;
      if (lobby.game && lobby.game.players.some((player) => player.id === state.profile.id)) {
        state.currentScreen = "game";
      } else {
        state.currentScreen = "lobby";
      }
      saveState();
      render();
    });

    actions.appendChild(viewButton);

    if (!lobby.game && isHost) {
      const startButton = document.createElement("button");
      startButton.type = "button";
      startButton.className = "secondary";
      startButton.textContent = "Start match";
      startButton.addEventListener("click", () => {
        state.currentLobbyId = lobby.id;
        state.currentScreen = "lobby";
        startMatch();
      });
      actions.appendChild(startButton);
    }

    if (lobby.settings.isTestLobby && isHost) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "secondary";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        if (window.confirm(`Delete test lobby "${lobby.name}"?`)) {
          state.lobbies = state.lobbies.filter((entry) => entry.id !== lobby.id);
          if (state.currentLobbyId === lobby.id) {
            state.currentLobbyId = null;
            state.currentScreen = "lobby";
          }
          saveState();
          render();
        }
      });
      actions.appendChild(deleteButton);
    }

    if (!lobby.game && !isJoined && !isHost) {
      const joinButton = document.createElement("button");
      joinButton.type = "button";
      joinButton.className = "secondary";
      joinButton.textContent = "Join queue";
      joinButton.addEventListener("click", () => {
        joinLobby(lobby.id);
      });
      actions.appendChild(joinButton);
    }

    card.appendChild(info);
    card.appendChild(actions);
    dom.lobbyList.appendChild(card);
  });
}

function getValidTargetCells(action, actor, lobby) {
  if (!lobby || !lobby.game || !actor) {
    return new Set();
  }

  const valid = new Set();

  if (action === "move") {
    for (let y = 0; y < lobby.game.gridSize; y += 1) {
      for (let x = 0; x < lobby.game.gridSize; x += 1) {
        const occupied = lobby.game.players.some((player) => player.id !== actor.id && player.x === x && player.y === y);
        const canMove = Math.abs(actor.x - x) + Math.abs(actor.y - y) === 1 && !occupied;
        if (canMove) {
          valid.add(getCellKey(x, y));
        }
      }
    }
    return valid;
  }

  if (action === "attack" || action === "gift-ap" || action === "gift-heart") {
    lobby.game.players.forEach((player) => {
      if (player.id === actor.id) {
        return;
      }
      if (action === "gift-heart" && player.health >= player.maxHealth && !player.isDowned) {
        return;
      }
      if (isInRange({ x: actor.x, y: actor.y }, { x: player.x, y: player.y }, actor.range)) {
        valid.add(getCellKey(player.x, player.y));
      }
    });
    return valid;
  }

  return valid;
}

function renderBoard() {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    dom.board.innerHTML = "";
    return;
  }

  const activeActor = getCurrentPlayerInLobby();
  const selected = getSelectedPlayer() || activeActor;
  const activeTargets = state.activeAction && activeActor ? getValidTargetCells(state.activeAction, activeActor, lobby) : new Set();
  const rangeOwner = activeActor || selected;
  const zonePreview = lobby.game.allowZoneShrink ? getZonePreviewSet(lobby) : new Set();
  const zoneBounds = lobby.game.allowZoneShrink ? getZoneBounds(lobby) : null;
  const dangerZoneCells = new Set();
  if (zoneBounds) {
    for (let y = 0; y < lobby.game.gridSize; y += 1) {
      for (let x = 0; x < lobby.game.gridSize; x += 1) {
        const outsideSafeZone = x < zoneBounds.minX || x > zoneBounds.maxX || y < zoneBounds.minY || y > zoneBounds.maxY;
        if (outsideSafeZone) {
          dangerZoneCells.add(getCellKey(x, y));
        }
      }
    }
  }

  dom.board.style.gridTemplateColumns = `32px repeat(${lobby.game.gridSize}, minmax(0, 1fr))`;
  dom.board.style.gridTemplateRows = `32px repeat(${lobby.game.gridSize}, minmax(0, 1fr))`;
  dom.board.innerHTML = "";

  const corner = document.createElement("div");
  corner.className = "board-corner";
  dom.board.appendChild(corner);

  for (let x = 0; x < lobby.game.gridSize; x += 1) {
    const label = document.createElement("div");
    label.className = "board-label top-label";
    label.textContent = String.fromCharCode(65 + x);
    dom.board.appendChild(label);
  }

  for (let y = 0; y < lobby.game.gridSize; y += 1) {
    const rowLabel = document.createElement("div");
    rowLabel.className = "board-label side-label";
    rowLabel.textContent = String(y + 1);
    dom.board.appendChild(rowLabel);

    for (let x = 0; x < lobby.game.gridSize; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);

      if (rangeOwner && isInRange({ x: rangeOwner.x, y: rangeOwner.y }, { x, y }, rangeOwner.range)) {
        cell.classList.add("range-highlight");
      }
      if (zonePreview.has(getCellKey(x, y))) {
        cell.classList.add("zone-preview");
      }
      if (dangerZoneCells.has(getCellKey(x, y))) {
        cell.classList.add("danger-zone");
      }
      if (selected && selected.x === x && selected.y === y) {
        cell.classList.add("selected");
      }
      if (activeTargets.has(getCellKey(x, y))) {
        cell.classList.add("valid-target", "clickable");
      }

      const occupant = lobby.game.players.find((player) => player.x === x && player.y === y);
      if (occupant) {
        const token = document.createElement("div");
        token.className = "player-token";
        token.style.background = occupant.color || "#4a7ae8";
        token.innerHTML = `<span class="token-icon">${occupant.icon || occupant.name.charAt(0) || "P"}</span>`;
        if (occupant.isDowned) {
          token.classList.add("downed");
        }
        if (occupant.id === state.profile.id) {
          token.classList.add("is-current");
        }
        cell.appendChild(token);

        const nameTag = document.createElement("span");
        nameTag.className = "token-name";
        nameTag.textContent = (occupant.name || "Player").slice(0, 8);
        cell.appendChild(nameTag);
      }

      if (state.activeAction && occupant && activeTargets.has(getCellKey(x, y))) {
        cell.style.cursor = "pointer";
      }

      cell.addEventListener("click", () => {
        if (!state.activeAction) {
          if (occupant && lobby.settings && lobby.settings.isTestLobby) {
            state.selectedPlayerId = occupant.id;
            render();
          }
          return;
        }
        performAction(state.activeAction, x, y);
      });

      dom.board.appendChild(cell);
    }
  }
}

function renderPlayerCard() {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    dom.playerCard.innerHTML = "<p>Join a lobby to begin the match.</p>";
    return;
  }

  const player = getSelectedPlayer() || getCurrentPlayerInLobby();
  if (!player) {
    dom.playerCard.innerHTML = "<p>Match data is loading...</p>";
    return;
  }

  dom.playerCard.innerHTML = `
    <div class="player-entry">
      <div class="meta">
        <div class="player-badge" style="background:${player.color};">${player.icon}</div>
        <div class="player-info">
          <strong>${player.name}</strong>
          <span>${player.isDowned ? "Downed" : "Alive"}</span>
        </div>
      </div>
    </div>
    <div class="stat-card">
      <p><strong>Location:</strong> ${toBoardLabel(player.x, player.y)}</p>
      <p><strong>Hearts:</strong> ${player.health}/${player.maxHealth}</p>
      <p><strong>AP:</strong> ${player.ap}</p>
      <p><strong>Range:</strong> ${player.range}</p>
    </div>
  `;
}

function renderRoster() {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    dom.playerRoster.innerHTML = "";
    return;
  }

  dom.playerRoster.innerHTML = "";
  lobby.game.players.forEach((player) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "player-entry";
    button.style.width = "100%";
    button.disabled = !(lobby.settings && lobby.settings.isTestLobby);
    button.innerHTML = `
      <div class="meta">
        <div class="player-badge" style="background:${player.color};">${player.icon}</div>
        <div class="player-info">
          <strong>${player.name}</strong>
          <span>${player.isDowned ? "Downed" : "Alive"}</span>
        </div>
      </div>
    `;
    if (lobby.settings && lobby.settings.isTestLobby) {
      button.addEventListener("click", () => {
        state.selectedPlayerId = player.id;
        render();
      });
    }
    dom.playerRoster.appendChild(button);
  });
}

function renderJuryPanel() {
  const lobby = getCurrentLobby();
  const currentPlayer = getCurrentPlayerInLobby();
  if (!lobby || !lobby.game || !currentPlayer || !currentPlayer.isDowned) {
    return;
  }

  const jurorEntry = getJurorEntry(lobby, currentPlayer.id);
  const livingPlayers = lobby.game.players.filter((player) => !player.isDowned && player.id !== currentPlayer.id);

  const panel = document.createElement("div");
  panel.className = "panel jury-panel";
  panel.innerHTML = `
    <h3>Jury vote</h3>
    ${livingPlayers.length ? `
      <div class="jury-vote-list">
        ${livingPlayers.map((player) => `
          <button type="button" class="jury-vote-button ${jurorEntry && jurorEntry.voteTargetId === player.id ? "selected" : ""}" data-vote-target="${player.id}">
            ${player.name}
          </button>
        `).join("")}
      </div>
    ` : "<p class='empty-state'>No living players remain to vote on.</p>"}
  `;

  panel.querySelectorAll("[data-vote-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-vote-target");
      const juror = getJurorEntry(lobby, currentPlayer.id);
      if (!juror || !targetId) {
        return;
      }
      juror.hasVoted = true;
      juror.voteTargetId = targetId;
      addGameLog(`${currentPlayer.name} cast a secret vote for ${lobby.game.players.find((player) => player.id === targetId)?.name || "a player"}.`, lobby);
      render();
    });
  });

  const existing = document.querySelector(".jury-panel");
  if (existing) {
    existing.replaceWith(panel);
    return;
  }

  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    sidebar.appendChild(panel);
  }
}

function renderLog() {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    dom.logList.innerHTML = "";
    return;
  }

  const personalEntries = getPersonalLogEntries();
  dom.logList.innerHTML = personalEntries.map((entry) => `<li>${entry}</li>`).join("");
}

function renderGameHeader() {
  const lobby = getCurrentLobby();
  if (!lobby) {
    return;
  }

  dom.lobbyNameText.textContent = lobby.name;
  dom.zoneDisplayText.textContent = `${lobby.game ? lobby.game.gridSize : lobby.settings.gridSize}x${lobby.game ? lobby.game.gridSize : lobby.settings.gridSize}`;

  if (lobby.game) {
    dom.refreshTimerText.textContent = formatTimeLeft(lobby.game.nextRefreshAt);
    if (lobby.game.allowZoneShrink) {
      const zoneState = getZoneProgress(lobby);
      if (zoneState.preview) {
        dom.zoneCountdownText.textContent = "1 round until shrink";
      } else {
        const roundsText = `${zoneState.roundsUntilShrink} ${zoneState.roundsUntilShrink === 1 ? "round" : "rounds"}`;
        dom.zoneCountdownText.textContent = `${roundsText} until shrink`;
      }
      dom.zoneCountdownText.parentElement?.classList.remove("hidden");
    } else {
      dom.zoneCountdownText.textContent = "Zone off";
      dom.zoneCountdownText.parentElement?.classList.remove("hidden");
    }
  } else {
    dom.refreshTimerText.textContent = `${lobby.settings.refreshTimePst || "20:00"} PST`;
    dom.zoneCountdownText.textContent = "Lobby queue";
    dom.zoneCountdownText.parentElement?.classList.remove("hidden");
  }
}

function renderScreen() {
  const showLobby = state.currentScreen === "lobby";
  dom.lobbyScreen.classList.toggle("active", showLobby);
  dom.gameScreen.classList.toggle("active", !showLobby);
  dom.profileBox.classList.toggle("hidden", !showLobby);
}

function renderActionButtons() {
  const currentPlayer = getCurrentPlayerInLobby();
  const lobby = getCurrentLobby();
  const livingPlayers = lobby && lobby.game ? lobby.game.players.filter((player) => !player.isDowned) : [];
  const canDeclareWin = Boolean(currentPlayer && lobby && lobby.game && livingPlayers.length === 1 && livingPlayers[0].id === currentPlayer.id);

  document.querySelectorAll("[data-action]").forEach((button) => {
    const action = button.dataset.action;
    const isSelected = state.activeAction === action;
    button.classList.toggle("active", isSelected);
    button.disabled = !currentPlayer;

    if (action === "upgrade") {
      const cost = currentPlayer ? (currentPlayer.upgradeCost ?? 2) : 2;
      button.textContent = `Upgrade range (${cost} AP)`;
    }
  });

  if (dom.declareWinBtn) {
    dom.declareWinBtn.classList.toggle("hidden", !canDeclareWin);
    dom.declareWinBtn.disabled = !canDeclareWin;
  }

  if (dom.forfeitBtn) {
    dom.forfeitBtn.disabled = !currentPlayer;
  }
}

function render() {
  pruneCompletedLobbies();
  renderInputLock();
  renderScreen();
  renderLobbyList();
  renderGameHeader();
  renderBoard();
  renderPlayerCard();
  renderRoster();
  renderJuryPanel();
  renderLog();
  renderActionButtons();
}

function performMove(actorId, x, y) {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    return false;
  }

  const actor = getPlayerById(actorId, lobby);
  if (!actor || actor.isDowned) {
    return false;
  }

  if (actor.ap < 1) {
    addGameLog(`${actor.name} has no AP to move.`, lobby);
    return false;
  }

  const isAdjacent = Math.abs(actor.x - x) + Math.abs(actor.y - y) === 1;
  const isWithinBoard = x >= 0 && x < lobby.game.gridSize && y >= 0 && y < lobby.game.gridSize;
  const occupied = lobby.game.players.some((other) => other.id !== actor.id && other.x === x && other.y === y);

  if (!isAdjacent || !isWithinBoard || occupied) {
    addGameLog(`${actor.name} cannot move there.`, lobby);
    return false;
  }

  actor.x = x;
  actor.y = y;
  actor.ap -= 1;
  state.activeAction = null;
  addGameLog(`${actor.name} moved to ${toBoardLabel(x, y)}.`, lobby);
  saveState();
  render();
  return true;
}

function performAttack(attackerId, targetId) {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    return false;
  }

  const attacker = getPlayerById(attackerId, lobby);
  const target = getPlayerById(targetId, lobby);
  if (!attacker || !target || attacker.isDowned || target.isDowned || target.id === attacker.id) {
    return false;
  }

  if (!isInRange({ x: attacker.x, y: attacker.y }, { x: target.x, y: target.y }, attacker.range)) {
    addGameLog(`${attacker.name} is out of range.`, lobby);
    return false;
  }

  if (attacker.ap < 1) {
    addGameLog(`${attacker.name} needs 1 AP to attack.`, lobby);
    return false;
  }

  attacker.ap -= 1;
  target.health -= 1;
  addGameLog(`${attacker.name} hit ${target.name} for 1 heart.`, lobby);

  if (target.health <= 0) {
    target.health = 0;
    target.isDowned = true;
    target.alive = false;
    target.ap = 0;
    addJurorIfNeeded(lobby, target.id);
    if (target.id === state.profile.id) {
      registerDeathForPlayer(lobby, target.id);
    }
    addGameLog(`${target.name} was downed.`, lobby);
  }

  state.activeAction = null;
  saveState();
  render();
  return true;
}

function performGiftAp(senderId, targetId) {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    return false;
  }

  const sender = getPlayerById(senderId, lobby);
  const target = getPlayerById(targetId, lobby);
  if (!sender || !target || sender.isDowned || sender.id === target.id || target.isDowned) {
    return false;
  }

  if (!isInRange({ x: sender.x, y: sender.y }, { x: target.x, y: target.y }, sender.range)) {
    addGameLog(`${sender.name} is not in range to gift AP.`, lobby);
    return false;
  }

  if (sender.ap < 1) {
    addGameLog(`${sender.name} has no AP to give.`, lobby);
    return false;
  }

  sender.ap -= 1;
  target.ap += 1;
  addGameLog(`${sender.name} gifted 1 AP to ${target.name}.`, lobby);
  state.activeAction = null;
  saveState();
  render();
  return true;
}

function performGiftHeart(senderId, targetId) {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    return false;
  }

  const sender = getPlayerById(senderId, lobby);
  const target = getPlayerById(targetId, lobby);
  if (!sender || !target || sender.isDowned || sender.id === target.id) {
    return false;
  }

  if (sender.health >= sender.maxHealth) {
    addGameLog(`${sender.name} is already at full health and cannot gift a heart.`, lobby);
    return false;
  }

  if (!isInRange({ x: sender.x, y: sender.y }, { x: target.x, y: target.y }, sender.range)) {
    addGameLog(`${sender.name} is not in range to gift a heart.`, lobby);
    return false;
  }

  if (!target.isDowned && target.health >= target.maxHealth) {
    addGameLog(`${target.name} is already at full health and cannot receive a heart.`, lobby);
    return false;
  }

  sender.health -= 1;

  if (target.isDowned) {
    target.isDowned = false;
    target.alive = true;
    target.health = 1;
    target.ap = 0;
    clearJurorVote(lobby, target.id);
    addGameLog(`${sender.name} gifted a heart and revived ${target.name}.`, lobby);
  } else {
    target.health = Math.min(target.maxHealth, target.health + 1);
    addGameLog(`${sender.name} gifted a heart to ${target.name}.`, lobby);
  }

  if (sender.health <= 0) {
    sender.health = 0;
    sender.isDowned = true;
    sender.alive = false;
    sender.ap = 0;
    addJurorIfNeeded(lobby, sender.id);
    if (sender.id === state.profile.id) {
      registerDeathForPlayer(lobby, sender.id);
    }
    addGameLog(`${sender.name} gave a heart and was downed.`, lobby);
  }

  state.activeAction = null;
  saveState();
  render();
  return true;
}

function performRangeUpgrade(actorId) {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    return false;
  }

  const actor = getPlayerById(actorId, lobby);
  if (!actor || actor.isDowned) {
    return false;
  }

  const cost = actor.upgradeCost ?? 2;
  if (actor.ap < cost) {
    addGameLog(`${actor.name} needs ${cost} AP to upgrade range.`, lobby);
    closeUpgradeModal();
    return false;
  }

  actor.ap -= cost;
  actor.range += 1;
  actor.upgradeCost = (actor.upgradeCost ?? 2) + 1;
  addGameLog(`${actor.name} upgraded range to ${actor.range} for ${cost} AP.`, lobby);
  state.activeAction = null;
  closeUpgradeModal();
  saveState();
  render();
  return true;
}

function performAction(action, targetX, targetY) {
  const lobby = getCurrentLobby();
  if (!lobby || !lobby.game) {
    return;
  }

  const actor = getCurrentPlayerInLobby();
  if (!actor) {
    return;
  }

  switch (action) {
    case "move": {
      const targetOccupied = lobby.game.players.some((player) => player.id !== actor.id && player.x === targetX && player.y === targetY && !player.isDowned);
      if (targetOccupied) {
        addGameLog("A move needs a free adjacent square.", lobby);
        return;
      }
      performMove(actor.id, targetX, targetY);
      return;
    }
    case "attack": {
      const target = lobby.game.players.find((player) => player.id !== actor.id && player.x === targetX && player.y === targetY);
      if (!target) {
        addGameLog("Choose another player in range to attack.", lobby);
        return;
      }
      performAttack(actor.id, target.id);
      return;
    }
    case "upgrade": {
      performRangeUpgrade(actor.id);
      return;
    }
    case "gift-ap": {
      const target = lobby.game.players.find((player) => player.id !== actor.id && player.x === targetX && player.y === targetY);
      if (!target) {
        addGameLog("Choose another player in range to gift AP.", lobby);
        return;
      }
      performGiftAp(actor.id, target.id);
      return;
    }
    case "gift-heart": {
      const target = lobby.game.players.find((player) => player.id !== actor.id && player.x === targetX && player.y === targetY);
      if (!target) {
        addGameLog("Choose another player in range to gift a heart.", lobby);
        return;
      }
      performGiftHeart(actor.id, target.id);
      return;
    }
    default:
      break;
  }
}

function forfeitCurrentPlayer() {
  const lobby = getCurrentLobby();
  const player = getCurrentPlayerInLobby();
  if (!lobby || !lobby.game || !player) {
    return;
  }

  player.isDowned = true;
  player.health = 0;
  player.ap = 0;
  player.alive = false;
  addJurorIfNeeded(lobby, player.id);
  if (player.id === state.profile.id) {
    registerDeathForPlayer(lobby, player.id);
  }
  addGameLog(`${player.name} forfeited the match.`, lobby);
  closeForfeitModal();
  state.activeAction = null;
  saveState();
  render();
}

function declareCurrentPlayerWin() {
  const lobby = getCurrentLobby();
  const player = getCurrentPlayerInLobby();
  if (!lobby || !lobby.game || !player) {
    return;
  }

  const livingPlayers = lobby.game.players.filter((entry) => !entry.isDowned);
  if (livingPlayers.length !== 1 || livingPlayers[0].id !== player.id) {
    return;
  }

  lobby.winner = player.name;
  lobby.game = null;
  state.currentScreen = "lobby";
  pruneCompletedLobbies();
  state.activeAction = null;
  closeDeclareWinModal();
  saveState();
  render();
}

function saveProfile() {
  const nextName = dom.profileNameInput.value.trim();
  const nextIcon = dom.profileIconInput.value || DEFAULT_ICONS[0];
  const nextColor = dom.profileColorInput.value || DEFAULT_COLORS[0];

  state.profile.name = nextName;
  state.profile.icon = nextIcon;
  state.profile.color = nextColor;

  state.lobbies.forEach((lobby) => {
    if (lobby.game) {
      return;
    }

    const member = lobby.players.find((player) => player.id === state.profile.id);
    if (member) {
      member.name = nextName || "Player";
      member.icon = nextIcon;
      member.color = nextColor;
    }
  });

  saveState();
  render();
}

function bindEvents() {
  dom.openCreateLobbyBtn.addEventListener("click", openCreateLobbyModal);
  dom.closeLobbyModalBtn.addEventListener("click", closeCreateLobbyModal);
  dom.refreshModeInput.addEventListener("change", syncRefreshModeControls);
  dom.shrinkToggleInput.addEventListener("change", syncZoneShrinkControls);
  dom.shrinkIntervalInput.addEventListener("input", () => {
    dom.shrinkIntervalValue.textContent = String(dom.shrinkIntervalInput.value || 1);
  });
  dom.testLobbyToggleInput.addEventListener("change", syncTestLobbyControls);
  dom.testPlayerCountInput.addEventListener("input", () => {
    dom.testPlayerCountValue.textContent = String(dom.testPlayerCountInput.value || 5);
  });
  dom.lobbyForm.addEventListener("submit", createLobby);
  dom.saveProfileBtn.addEventListener("click", saveProfile);
  dom.returnLobbyBtn.addEventListener("click", returnToHub);
  dom.forfeitBtn.addEventListener("click", openForfeitModal);
  dom.cancelForfeitBtn.addEventListener("click", closeForfeitModal);
  dom.confirmForfeitBtn.addEventListener("click", forfeitCurrentPlayer);
  dom.cancelUpgradeBtn.addEventListener("click", closeUpgradeModal);
  dom.confirmUpgradeBtn.addEventListener("click", () => {
    const actor = getCurrentPlayerInLobby();
    if (actor) {
      performRangeUpgrade(actor.id);
    }
  });
  dom.declareWinBtn.addEventListener("click", openDeclareWinModal);
  dom.cancelWinBtn.addEventListener("click", closeDeclareWinModal);
  dom.confirmWinBtn.addEventListener("click", declareCurrentPlayerWin);

  document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "upgrade") {
        openUpgradeModal();
        return;
      }
      if (state.activeAction === action) {
        state.activeAction = null;
        render();
        return;
      }
      state.activeAction = action;
      render();
      return;
    }

    if (event.target.closest("#createLobbyModal") && !event.target.closest(".modal-card")) {
      return;
    }

    if (event.target.closest("#forfeitModal") && !event.target.closest(".modal-card")) {
      return;
    }

    if (event.target.closest("#upgradeModal") && !event.target.closest(".modal-card")) {
      return;
    }

    if (event.target.closest("#declareWinModal") && !event.target.closest(".modal-card")) {
      return;
    }
  });
}

window.__alliance = {
  state,
  addJurorIfNeeded,
  registerDeathForPlayer
};

function init() {
  loadState();
  if (!state.profile.name) {
    state.profile.name = "";
  }
  if (!state.profile.icon) {
    state.profile.icon = DEFAULT_ICONS[0];
  }
  if (!state.profile.color) {
    state.profile.color = DEFAULT_COLORS[0];
  }

  setProfileInputs();
  bindEvents();
  syncRefreshModeControls();
  syncZoneShrinkControls();
  syncTestLobbyControls();
  render();

  setInterval(() => {
    const lobby = getCurrentLobby();
    if (lobby && lobby.game) {
      refreshDailyAP();
      renderGameHeader();
      renderBoard();
      renderPlayerCard();
      renderLog();
    }
  }, 1000);
}

init();
