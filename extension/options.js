"use strict";

/* global DEFAULTS, sanitizeSettings, normalizeServerUrl, hostPattern */

const $ = (id) => document.getElementById(id);
const FIELDS = Object.keys(DEFAULTS);
const DEFAULT_TITLE = browser.runtime.getManifest().action.default_title;

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
  fillForm(sanitizeSettings(await browser.storage.local.get(DEFAULTS)));
  const title = await browser.action.getTitle({});
  if (title && title !== DEFAULT_TITLE) setStatus(`Letzter Stand: ${title}`);
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

  const granted = await browser.permissions.request({ origins: [hostPattern(serverUrl)] });
  if (!granted) {
    setStatus("Ohne Zugriff auf den Server kann die Erweiterung nichts abfragen.", "error");
    return;
  }

  await browser.storage.local.set(settings);
  fillForm(settings);
  setStatus("Gespeichert. Prüfe die Verbindung …");
  try {
    const result = await browser.runtime.sendMessage({ type: "poll-now" });
    const kind = result?.level === "error" ? "error" : result?.level === "ok" ? "info" : "warn";
    setStatus(`Gespeichert. ${result?.message ?? ""}`.trim(), kind);
  } catch (err) {
    setStatus(`Gespeichert, aber die Prüfung ist gescheitert: ${err.message}`, "error");
  }
});

load();
