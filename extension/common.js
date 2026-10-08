"use strict";

// Gemeinsame Werte und Hilfsfunktionen für Hintergrundskript und Einstellungsseite.

const DEFAULTS = Object.freeze({
  serverUrl: "",
  apiKey: "",
  tagName: "an-firefox",
  intervalMinutes: 2,
  maxPerRun: 20,
  activateTabs: false,
  lazyTabs: true,
  archiveAfterOpen: false,
});

// Bereinigt die Karakeep-Adresse: nur http(s), ohne Abfrageteil, ohne
// Schrägstrich am Ende und ohne versehentlich angehängtes /api/v1.
// Wirft bei ungültiger Eingabe.
function normalizeServerUrl(input) {
  const u = new URL(String(input).trim());
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new TypeError("Nur http und https werden unterstützt.");
  }
  const path = u.pathname
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/i, "")
    .replace(/\/+$/, "");
  return u.origin + path;
}

// Berechtigungsmuster für den Server. Firefox kennt keine Ports in
// Match Patterns, ein Muster ohne Port gilt für alle Ports des Hosts.
function hostPattern(serverUrl) {
  const u = new URL(serverUrl);
  return `${u.protocol}//${u.hostname}/*`;
}

function normalizeTagName(input) {
  return String(input ?? "").trim().replace(/^#+/, "").trim();
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Liefert immer vollständige, gültige Einstellungen, egal was gespeichert ist.
function sanitizeSettings(raw) {
  const s = { ...DEFAULTS };
  for (const [key, value] of Object.entries(raw || {})) {
    if (key in DEFAULTS && value !== undefined && value !== null) s[key] = value;
  }
  return {
    serverUrl: typeof s.serverUrl === "string" ? s.serverUrl.trim() : "",
    apiKey: typeof s.apiKey === "string" ? s.apiKey.trim() : "",
    tagName: normalizeTagName(s.tagName) || DEFAULTS.tagName,
    intervalMinutes: clampInt(s.intervalMinutes, 0, 1440, DEFAULTS.intervalMinutes),
    maxPerRun: clampInt(s.maxPerRun, 1, 100, DEFAULTS.maxPerRun),
    activateTabs: Boolean(s.activateTabs),
    lazyTabs: Boolean(s.lazyTabs),
    archiveAfterOpen: Boolean(s.archiveAfterOpen),
  };
}
