"use strict";

/* global DEFAULTS, sanitizeSettings, hostPattern */

const POLL_ALARM = "karakeep-poll";
const RETRY_ALARM = "karakeep-retry";
const RETRY_DELAYS_MIN = [0.5, 1, 2, 5, 10];
const AUTO_MIN_GAP_MS = 30 * 1000;
const WAKE_DELAY_MS = 3 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const IDLE_SECONDS = 60;
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

const BADGE_COLORS = { info: "#2f5d8a", wait: "#6b6b6b", error: "#c0392b" };

// Firefox entlädt das Hintergrundskript nach kurzer Untätigkeit. Globale
// Variablen überleben das nicht, deshalb liegt alles, was länger halten muss,
// in storage.session. "inflight" gilt nur für eine laufende Abfrage: Weitere
// Auslöser in dieser Zeit hängen sich an dieselbe Abfrage an.
let inflight = null;

class PollError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "PollError";
    this.status = status;
    this.retryable = retryable;
  }
}

function formatTime(ms = Date.now()) {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

async function getSettings() {
  return sanitizeSettings(await browser.storage.local.get(DEFAULTS));
}

// Karakeep API

function httpError(status, path) {
  if (status === 401) {
    return new PollError("API-Schlüssel ungültig oder widerrufen (HTTP 401).", { status });
  }
  if (status === 403) {
    return new PollError("Dem API-Schlüssel fehlt eine Berechtigung (HTTP 403).", { status });
  }
  if (status === 429 || status >= 500) {
    return new PollError(`Server gerade nicht verfügbar (HTTP ${status}).`, { status, retryable: true });
  }
  const where = path.split("?")[0];
  return new PollError(`Unerwartete Antwort HTTP ${status} bei ${where}. Stimmt die Adresse?`, { status });
}

async function api(settings, path, { method = "GET", body } = {}) {
  const headers = { Authorization: `Bearer ${settings.apiKey}`, Accept: "application/json" };
  const init = {
    method,
    headers,
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res;
  let text;
  try {
    res = await fetch(`${settings.serverUrl}/api/v1${path}`, init);
    text = await res.text();
  } catch (err) {
    const timeout = err && err.name === "TimeoutError";
    throw new PollError(timeout ? "Server antwortet nicht (Zeitüberschreitung)." : "Server nicht erreichbar.", {
      retryable: true,
    });
  }
  if (!res.ok) throw httpError(res.status, path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Etwa die Anmeldeseite eines Hotel-WLANs statt der API.
    throw new PollError("Antwort ist kein JSON. Stimmt die Adresse, oder fehlt ein WLAN-Login?", {
      retryable: true,
    });
  }
}

function setTag(settings, bookmarkId, tagId, method) {
  return api(settings, `/bookmarks/${encodeURIComponent(bookmarkId)}/tags`, {
    method,
    body: { tags: [{ tagId }] },
  });
}

async function findTag(settings) {
  const wanted = settings.tagName.toLowerCase();
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ nameContains: settings.tagName, limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const data = await api(settings, `/tags?${q}`);
    const hit = (data?.tags || []).find((t) => String(t.name).trim().toLowerCase() === wanted);
    if (hit) return hit;
    cursor = data?.nextCursor;
    if (!cursor) break;
  }
  return null;
}

// Anzahl der von dir (nicht von der KI) getaggten Lesezeichen laut Tag-Liste.
// Unbekannt bedeutet: sicherheitshalber nachsehen.
function pendingCount(tag) {
  const human = tag.numBookmarksByAttachedType?.human;
  if (typeof human === "number") return human;
  if (typeof tag.numBookmarks === "number") return tag.numBookmarks;
  return Infinity;
}

// Älteste zuerst, damit die Tabs in der Reihenfolge kommen, in der du sie
// gespeichert hast. KI-Tags werden schon beim Blättern übersprungen, damit sie
// nie die Plätze für deine eigenen Links belegen.
async function collectPending(settings, tagId, limit) {
  const result = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES && result.length < limit; page++) {
    const q = new URLSearchParams({ sortOrder: "asc", limit: String(PAGE_SIZE), includeContent: "false" });
    if (cursor) q.set("cursor", cursor);
    let data;
    try {
      data = await api(settings, `/tags/${encodeURIComponent(tagId)}/bookmarks?${q}`);
    } catch (err) {
      if (err instanceof PollError && err.status === 404) break; // Tag inzwischen gelöscht
      throw err;
    }
    for (const bm of data?.bookmarks || []) {
      const entry = (bm.tags || []).find((t) => t.id === tagId);
      if (entry && entry.attachedBy === "ai") continue;
      result.push(bm);
      if (result.length >= limit) break;
    }
    cursor = data?.nextCursor;
    if (!cursor) break;
  }
  return result;
}

function isWebUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

// Links öffnen ihre Adresse. PDF- und Bildlinks wandelt Karakeep beim Crawlen
// in Datei-Lesezeichen um, die ursprüngliche Adresse steht dann in sourceUrl.
// Alles ohne http(s)-Adresse (Notizen, hochgeladene Dateien) öffnet die
// Ansicht in Karakeep selbst.
function targetFor(settings, bm) {
  const c = bm.content || {};
  const original = c.type === "link" ? c.url : c.sourceUrl;
  if (isWebUrl(original)) return original;
  return `${settings.serverUrl}/dashboard/preview/${encodeURIComponent(bm.id)}`;
}

function titleFor(bm) {
  const c = bm.content || {};
  const title = bm.title || c.title || c.fileName;
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 300) : undefined;
}

function openTab(settings, url, title, activate) {
  const props = { url, active: activate };
  // Hintergrund-Tabs erst laden, wenn du sie anklickst. Firefox erlaubt das
  // nur für nicht aktive Tabs, und nur dann darf ein Titel gesetzt werden.
  if (settings.lazyTabs && !activate) {
    props.discarded = true;
    if (title) props.title = title;
  }
  return browser.tabs.create(props);
}

// Eine Abfrage

async function runPoll({ force }) {
  const settings = await getSettings();
  if (!settings.serverUrl || !settings.apiKey) {
    return { level: "setup", message: "Bitte in den Einstellungen Adresse und API-Schlüssel eintragen." };
  }
  if (!(await browser.permissions.contains({ origins: [hostPattern(settings.serverUrl)] }))) {
    return { level: "setup", message: "Zugriff auf den Server fehlt. Bitte die Einstellungen einmal speichern." };
  }

  // Ohne offenes Fenster (auf dem Mac möglich) ließe sich kein Tab öffnen.
  // Dann gar nicht erst abholen, sondern auf das nächste Fenster warten.
  const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
  if (windows.length === 0) {
    await browser.storage.session.set({ waitingForWindow: true });
    return { level: "ok", message: "Kein Fenster offen. Links kommen, sobald du eines öffnest." };
  }
  await browser.storage.session.remove("waitingForWindow");

  const tag = await findTag(settings);
  if (!tag) {
    return { level: "ok", message: `Tag „${settings.tagName}“ gibt es in Karakeep noch nicht.` };
  }

  // Der häufigste Fall: nichts zu tun. Die Tag-Liste kennt die Anzahl schon,
  // dann bleibt es bei einer einzigen Anfrage. Ein Klick aufs Symbol sieht
  // trotzdem immer nach.
  const pending = pendingCount(tag);
  if (pending === 0 && !force) {
    return { level: "ok", opened: 0, remaining: 0, message: "Keine wartenden Links." };
  }

  const batch = await collectPending(settings, tag.id, settings.maxPerRun);
  let opened = 0;
  for (const bm of batch) {
    const url = targetFor(settings, bm);

    // Erst den Tag entfernen, dann öffnen: So kommt kein Link doppelt, auch
    // wenn zwei Abfragen kurz nacheinander laufen.
    await setTag(settings, bm.id, tag.id, "DELETE");
    try {
      await openTab(settings, url, titleFor(bm), settings.activateTabs && opened === 0);
    } catch (err) {
      // Öffnen gescheitert, etwa weil gerade das letzte Fenster zuging:
      // Tag wieder setzen, damit der Link beim nächsten Mal erneut kommt.
      const restored = await setTag(settings, bm.id, tag.id, "POST").then(
        () => true,
        () => false,
      );
      const hint = restored
        ? "Der Link bleibt markiert und kommt beim nächsten Versuch."
        : `Der Tag ließ sich nicht wieder setzen, bitte ${url} von Hand öffnen.`;
      throw new PollError(`Tab ließ sich nicht öffnen (${err.message}). ${hint}`, { retryable: restored });
    }
    opened++;

    if (settings.archiveAfterOpen) {
      await api(settings, `/bookmarks/${encodeURIComponent(bm.id)}`, {
        method: "PATCH",
        body: { archived: true },
      }).catch((e) => console.warn("Karakeep Opener: Archivieren fehlgeschlagen", bm.id, e));
    }
  }

  const remaining =
    batch.length >= settings.maxPerRun && Number.isFinite(pending) ? Math.max(0, pending - batch.length) : 0;
  let message = opened === 0 ? "Keine wartenden Links." : opened === 1 ? "1 Link geöffnet." : `${opened} Links geöffnet.`;
  if (remaining > 0) message += ` ${remaining} weitere warten, ein Klick aufs Symbol holt die nächsten.`;
  return { level: "ok", opened, remaining, message };
}

// Wiederholung bei vorübergehenden Fehlern

async function clearRetry() {
  await browser.alarms.clear(RETRY_ALARM);
  await browser.storage.session.remove("retryCount");
}

async function scheduleRetry(message) {
  const { retryCount = 0 } = await browser.storage.session.get("retryCount");
  if (retryCount >= RETRY_DELAYS_MIN.length) {
    // Aufgegeben bis zur nächsten erfolgreichen Abfrage. Die regulären
    // Auslöser (Intervall, Rückkehr, Klick) laufen weiter.
    return { level: "error", message: `${message} Auch die automatischen Wiederholungen sind gescheitert.` };
  }
  const delay = RETRY_DELAYS_MIN[retryCount];
  await browser.storage.session.set({ retryCount: retryCount + 1 });
  await browser.alarms.create(RETRY_ALARM, { delayInMinutes: delay });
  return { level: "retry", message: `${message} Neuer Versuch um ${formatTime(Date.now() + delay * 60000)}.` };
}

async function showStatus(result, trigger) {
  let text = "";
  let color = null;
  if (result.level === "setup") {
    text = "?";
    color = BADGE_COLORS.wait;
  } else if (result.level === "retry") {
    text = "…";
    color = BADGE_COLORS.wait;
  } else if (result.level === "error") {
    text = "!";
    color = BADGE_COLORS.error;
  } else if (result.remaining > 0) {
    text = `+${Math.min(result.remaining, 99)}`;
    color = BADGE_COLORS.info;
  }
  await browser.action.setBadgeText({ text });
  if (color) await browser.action.setBadgeBackgroundColor({ color });
  await browser.action.setTitle({ title: `Karakeep Opener, ${formatTime()} (${trigger}): ${result.message}` });
}

async function execute(trigger, force) {
  await browser.storage.session.set({ lastPollAt: Date.now() });
  let result;
  try {
    result = await runPoll({ force });
    await clearRetry();
  } catch (err) {
    console.error("Karakeep Opener", err);
    if (err instanceof PollError && err.retryable) {
      result = await scheduleRetry(err.message);
    } else {
      await clearRetry();
      result = {
        level: "error",
        message: err instanceof PollError ? err.message : `Unerwarteter Fehler: ${err.message}`,
      };
    }
  }
  await showStatus(result, trigger).catch((e) => console.warn("Karakeep Opener: Status", e));
  return result;
}

function poll(trigger, { force = false } = {}) {
  if (!inflight) {
    inflight = execute(trigger, force).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

// Für automatische Auslöser: höchstens eine Abfrage alle 30 Sekunden.
async function autoPoll(trigger) {
  const { lastPollAt = 0 } = await browser.storage.session.get("lastPollAt");
  if (Date.now() - lastPollAt < AUTO_MIN_GAP_MS) return null;
  return poll(trigger);
}

// Regelmäßige Abfrage

async function syncPollAlarm() {
  const { intervalMinutes } = await getSettings();
  const existing = await browser.alarms.get(POLL_ALARM);
  if (intervalMinutes <= 0) {
    if (existing) await browser.alarms.clear(POLL_ALARM);
    return;
  }
  if (existing && existing.periodInMinutes === intervalMinutes) return;
  await browser.alarms.clear(POLL_ALARM);
  await browser.alarms.create(POLL_ALARM, { delayInMinutes: intervalMinutes, periodInMinutes: intervalMinutes });
}

// Auslöser. Alle Listener stehen auf oberster Ebene, nur so weckt Firefox
// das entladene Hintergrundskript wieder auf.

browser.runtime.onStartup.addListener(() => {
  poll("Start");
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") browser.runtime.openOptionsPage();
});

browser.alarms.onAlarm.addListener(({ name }) => {
  if (name === POLL_ALARM) autoPoll("Intervall");
  else if (name === RETRY_ALARM) poll("Neuer Versuch");
});

browser.action.onClicked.addListener(() => {
  poll("Klick", { force: true });
});

// Rückkehr an den Rechner: nach Ruhezustand, Sperrbildschirm oder einer
// Minute ohne Eingabe meldet Firefox "active".
browser.idle.onStateChanged.addListener((state) => {
  if (state !== "active") return;
  // Kurz warten, bis nach dem Aufwachen das Netzwerk wieder steht.
  setTimeout(() => autoPoll("Rückkehr"), WAKE_DELAY_MS);
});

// Du wechselst zu Firefox, etwa aus einer anderen App.
browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== browser.windows.WINDOW_ID_NONE) autoPoll("Fenster aktiv");
});

browser.windows.onCreated.addListener(async (win) => {
  if (win.type && win.type !== "normal") return;
  const { waitingForWindow } = await browser.storage.session.get("waitingForWindow");
  if (waitingForWindow) poll("Neues Fenster");
  else autoPoll("Neues Fenster");
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "intervalMinutes" in changes) {
    syncPollAlarm().catch((e) => console.warn("Karakeep Opener: Wecker", e));
  }
});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== browser.runtime.id) return undefined;
  if (msg && msg.type === "poll-now") return poll("Einstellungen", { force: true });
  return undefined;
});

browser.idle.setDetectionInterval(IDLE_SECONDS);

// Bei jedem Laden prüfen, ob der Wecker stimmt. Das repariert auch den Fall,
// dass die Erweiterung deaktiviert und wieder aktiviert wurde.
syncPollAlarm().catch((e) => console.warn("Karakeep Opener: Wecker", e));
