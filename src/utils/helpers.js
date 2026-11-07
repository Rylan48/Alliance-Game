import { PST_TIMEZONE, DAY_MS } from "../config/game.js";

export function createLocalId(prefix = "id") {
  if (window.crypto && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function formatTimeLeft(deadlineMs) {
  const remaining = Math.max(0, deadlineMs - Date.now());
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getPstParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

export function getPstOffsetMs(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PST_TIMEZONE,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const zonePart = parts.find((part) => part.type === "timeZoneName");
  const zoneName = zonePart ? zonePart.value : "GMT-8";
  const match = zoneName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return -8 * 60 * 60 * 1000;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * ((hours * 60 + minutes) * 60 * 1000);
}

export function parseQuickRefreshMinutes(value) {
  const raw = String(value || "12:00").trim();
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

export function getQuickRefreshDelayMs(value) {
  return parseQuickRefreshMinutes(value) * 60 * 1000;
}

export function getNextRefreshAt(now, pstTimeValue, mode = "standard", quickValue = "12:00") {
  if (mode === "quick") {
    return now.getTime() + getQuickRefreshDelayMs(quickValue);
  }

  const [hourRaw = "20", minuteRaw = "00"] = String(pstTimeValue || "20:00").split(":");
  const hour = clamp(Number(hourRaw) || 20, 0, 23);
  const minute = clamp(Number(minuteRaw) || 0, 0, 59);

  const pstNow = getPstParts(now);
  const baseUtc = Date.UTC(pstNow.year, pstNow.month - 1, pstNow.day, 0, 0, 0);

  function candidateForDay(dayDate) {
    const utcMs = Date.UTC(
      dayDate.getUTCFullYear(),
      dayDate.getUTCMonth(),
      dayDate.getUTCDate(),
      hour,
      minute,
      0
    );
    const offsetMs = getPstOffsetMs(new Date(utcMs));
    return utcMs - offsetMs;
  }

  let next = candidateForDay(new Date(baseUtc));
  if (next <= now.getTime()) {
    next = candidateForDay(new Date(baseUtc + DAY_MS));
  }
  return next;
}

export function getCellKey(x, y) {
  return `${x},${y}`;
}

export function toBoardLabel(x, y) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const col = letters[x] || String(x + 1);
  return `${col}${y + 1}`;
}

export function isInRange(from, to, range) {
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
