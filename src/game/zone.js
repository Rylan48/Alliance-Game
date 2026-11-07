import { getCellKey } from "../utils/helpers.js";

export function getZoneBounds(lobby) {
  if (!lobby || !lobby.game) {
    return null;
  }

  const gridSize = lobby.game.gridSize;
  const bounds = lobby.game.zoneBounds || {
    minX: 0,
    maxX: gridSize - 1,
    minY: 0,
    maxY: gridSize - 1
  };

  return {
    minX: Number.isFinite(bounds.minX) ? bounds.minX : 0,
    maxX: Number.isFinite(bounds.maxX) ? bounds.maxX : gridSize - 1,
    minY: Number.isFinite(bounds.minY) ? bounds.minY : 0,
    maxY: Number.isFinite(bounds.maxY) ? bounds.maxY : gridSize - 1
  };
}

export function getZoneProgress(lobby) {
  if (!lobby || !lobby.game || !lobby.game.allowZoneShrink) {
    return { preview: false, shrinking: false, roundsUntilShrink: 0 };
  }

  const interval = Math.max(1, Number(lobby.game.zoneShrinkEvery) || 1);
  const countdown = Number(lobby.game.zoneCountdown ?? (interval + 1));

  if (countdown <= 0) {
    return { preview: false, shrinking: true, roundsUntilShrink: 0 };
  }

  if (countdown === 1) {
    return { preview: true, shrinking: false, roundsUntilShrink: 1 };
  }

  return { preview: false, shrinking: false, roundsUntilShrink: countdown };
}

export function setZonePreview(lobby) {
  if (!lobby || !lobby.game || !lobby.game.allowZoneShrink) {
    return;
  }

  const zoneState = getZoneProgress(lobby);
  if (!zoneState.preview) {
    lobby.game.zonePreview = [];
    return;
  }

  const bounds = getZoneBounds(lobby);
  const nextBounds = {
    minX: bounds.minX + 1,
    maxX: bounds.maxX - 1,
    minY: bounds.minY + 1,
    maxY: bounds.maxY - 1
  };

  const preview = new Set();
  for (let y = 0; y < lobby.game.gridSize; y += 1) {
    for (let x = 0; x < lobby.game.gridSize; x += 1) {
      const insideCurrent = x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
      const insideNext = x >= nextBounds.minX && x <= nextBounds.maxX && y >= nextBounds.minY && y <= nextBounds.maxY;
      if (insideCurrent && !insideNext) {
        preview.add(getCellKey(x, y));
      }
    }
  }

  lobby.game.zonePreview = Array.from(preview);
}

export function getZonePreviewSet(lobby) {
  if (!lobby || !lobby.game || !Array.isArray(lobby.game.zonePreview)) {
    return new Set();
  }
  return new Set(lobby.game.zonePreview);
}

export function applyZoneShrink(lobby) {
  if (!lobby || !lobby.game || !lobby.game.allowZoneShrink) {
    return;
  }

  const interval = Math.max(1, Number(lobby.game.zoneShrinkEvery) || 1);
  lobby.game.zoneCountdown = interval;

  const bounds = getZoneBounds(lobby);
  const nextBounds = {
    minX: Math.min(bounds.minX + 1, lobby.game.gridSize - 1),
    maxX: Math.max(bounds.maxX - 1, 0),
    minY: Math.min(bounds.minY + 1, lobby.game.gridSize - 1),
    maxY: Math.max(bounds.maxY - 1, 0)
  };

  if (nextBounds.minX >= nextBounds.maxX || nextBounds.minY >= nextBounds.maxY) {
    lobby.game.zoneBounds = nextBounds;
    lobby.game.zonePreview = [];
    return;
  }

  lobby.game.zoneBounds = nextBounds;
  lobby.game.zonePreview = [];

  lobby.game.players.forEach((player) => {
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
      if (typeof window !== "undefined" && window.__alliance && typeof window.__alliance.addJurorIfNeeded === "function") {
        window.__alliance.addJurorIfNeeded(lobby, player.id);
      }
      if (player.id === window.__alliance?.state?.profile?.id) {
        window.__alliance.registerDeathForPlayer(lobby, player.id);
      }
      console.log(`${player.name} was swallowed by the shrinking zone.`);
    }
  });
}

export function applyBadZoneDamage(lobby) {
  if (!lobby || !lobby.game || !lobby.game.allowZoneShrink) {
    return;
  }

  const bounds = getZoneBounds(lobby);
  if (!bounds) {
    return;
  }

  const hasActiveDangerZone = bounds.minX > 0 || bounds.maxX < lobby.game.gridSize - 1 || bounds.minY > 0 || bounds.maxY < lobby.game.gridSize - 1;
  if (!hasActiveDangerZone) {
    return;
  }

  lobby.game.players.forEach((player) => {
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
      if (typeof window !== "undefined" && window.__alliance && typeof window.__alliance.addJurorIfNeeded === "function") {
        window.__alliance.addJurorIfNeeded(lobby, player.id);
      }
      if (player.id === window.__alliance?.state?.profile?.id) {
        window.__alliance.registerDeathForPlayer(lobby, player.id);
      }
    }
  });
}
