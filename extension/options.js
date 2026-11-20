"use strict";

/* global DEFAULTS, sanitizeSettings, normalizeServerUrl, hostPattern */

const $ = (id) => document.getElementById(id);
const FIELDS = Object.keys(DEFAULTS);
const DEFAULT_TITLE = browser.runtime.getManifest().action.default_title;

// Die zuletzt gespeicherte Adresse. Wird synchron gebraucht, weil vor der
// Rückfrage nach der Berechtigung kein await stehen darf.
let savedServerUrl = "";

function setStatus(text, kind = "info") {
  const el = $("status");
  el.textContent = text;
  el.dataset.kind = kind;
}

function readForm() {
  const raw = {};
  for (const key of FIELDS) {
    const el = $(key);
    raw[key] = el.type === "checkbox" ? el.checked : el.value;
  }
  return raw;
}

function updateHttpWarning() {
  let insecure = false;
  try {
    insecure = new URL($("serverUrl").value.trim()).protocol === "http:";
  } catch {
    // noch keine vollständige Adresse
  }
  $("httpWarning").hidden = !insecure;
}

function fillForm(settings) {
  for (const key of FIELDS) {
    const el = $(key);
    if (el.type === "checkbox") el.checked = settings[key];
    else el.value = settings[key];
  }
  updateHttpWarning();
}

async function load() {
  const settings = sanitizeSettings(await browser.storage.local.get(DEFAULTS));
  savedServerUrl = settings.serverUrl;
  fillForm(settings);
  const title = await browser.action.getTitle({});
  if (title && title !== DEFAULT_TITLE) setStatus(`Letzter Stand: ${title}`);
}

// Nach einem Serverwechsel braucht die Erweiterung den alten Server nicht
// mehr. Firefox kennt keine Ports in Berechtigungsmustern: Bleibt der Host
// gleich, ist es dasselbe Muster, und es bleibt stehen.
async function dropOldPermission(previousUrl, serverUrl) {
  let old;
  try {
    old = hostPattern(previousUrl);
  } catch {
    return; // vorher keine gültige Adresse
  }
  if (old === hostPattern(serverUrl)) return;
  try {
    await browser.permissions.remove({ origins: [old] });
  } catch (err) {
    console.warn("Karakeep Opener: alte Berechtigung nicht entfernt", err);
  }
}

$("serverUrl").addEventListener("input", updateHttpWarning);

$("save").addEventListener("click", async () => {
  // Alles Prüfbare zuerst und ohne await: Firefox zeigt die Rückfrage nach der
  // Berechtigung nur, wenn sie unmittelbar auf deinen Klick folgt.
  const raw = readForm();
  let serverUrl;
  try {
    serverUrl = normalizeServerUrl(raw.serverUrl);
  } catch {
    setStatus("Bitte eine gültige Adresse eingeben, zum Beispiel https://karakeep.example.de", "error");
    return;
  }
  const settings = sanitizeSettings({ ...raw, serverUrl });
  if (!settings.apiKey) {
    setStatus("Bitte den API-Schlüssel eintragen.", "error");
    return;
  }

  // Bis alles durch ist, kein zweiter Klick.
  const button = $("save");
  button.disabled = true;
  try {
    let granted;
    try {
      granted = await browser.permissions.request({ origins: [hostPattern(serverUrl)] });
    } catch (err) {
      console.warn("Karakeep Opener: Berechtigung", err);
      setStatus("Firefox konnte den Zugriff auf den Server nicht anfragen. Bitte noch einmal versuchen.", "error");
      return;
    }
    if (!granted) {
      setStatus("Ohne Zugriff auf den Server kann die Erweiterung nichts abfragen.", "error");
      return;
    }

    try {
      await browser.storage.local.set(settings);
    } catch (err) {
      console.warn("Karakeep Opener: Speichern", err);
      setStatus("Die Einstellungen ließen sich nicht speichern. Bitte noch einmal versuchen.", "error");
      return;
    }
    const previousUrl = savedServerUrl;
    savedServerUrl = serverUrl;
    fillForm(settings);
    await dropOldPermission(previousUrl, serverUrl);

    setStatus("Gespeichert. Prüfe die Verbindung …");
    try {
      const result = await browser.runtime.sendMessage({ type: "poll-now" });
      const kind = result?.level === "error" ? "error" : result?.level === "ok" ? "info" : "warn";
      setStatus(`Gespeichert. ${result?.message ?? ""}`.trim(), kind);
    } catch (err) {
      setStatus(`Gespeichert, aber die Prüfung ist gescheitert: ${err.message}`, "error");
    }
  } finally {
    button.disabled = false;
  }
});

load();
