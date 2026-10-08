"use strict";
const { test } = require("node:test");
const assert = require("assert/strict");
const { makeEnv, loadBackground, fire, runTimers, flush, makeBrowser, apiCalls, manifest, vm } = require("./harness.js");

test("common: Adresse normalisieren, Port nicht im Berechtigungsmuster", async () => {
  const env = makeEnv();
  const ctx = await loadBackground(env);
  const n = (s) => vm.runInContext(`normalizeServerUrl(${JSON.stringify(s)})`, ctx);
  assert.equal(n(" https://kk.test/ "), "https://kk.test");
  assert.equal(n("https://kk.test/api/v1/"), "https://kk.test");
  assert.equal(n("https://kk.test:3000/karakeep/api/v1?x=1#y"), "https://kk.test:3000/karakeep");
  assert.throws(() => n("javascript:alert(1)"));
  assert.throws(() => n("kk.test"));
  assert.equal(vm.runInContext(`hostPattern("https://kk.test:3000/x")`, ctx), "https://kk.test/*");
  const s = vm.runInContext(`sanitizeSettings({intervalMinutes:"0", maxPerRun:"500", tagName:"  #An-Firefox ", lazyTabs: undefined})`, ctx);
  assert.equal(s.intervalMinutes, 0);
  assert.equal(s.maxPerRun, 100);
  assert.equal(s.tagName, "An-Firefox");
  assert.equal(s.lazyTabs, true, "Standard für neue Option greift");
  const d = vm.runInContext(`sanitizeSettings({intervalMinutes:"", maxPerRun:"abc"})`, ctx);
  assert.equal(d.intervalMinutes, 2);
  assert.equal(d.maxPerRun, 20);
});

test("nicht eingerichtet: Fragezeichen, keine Anfrage", async () => {
  const env = makeEnv();
  await loadBackground(env);
  await fire(env, "action.onClicked");
  assert.equal(env.badge, "?");
  assert.equal(env.requests.length, 0);
});

test("Berechtigung fehlt: Fragezeichen, keine Anfrage", async () => {
  const env = makeEnv();
  env.configure();
  env.granted.clear();
  await loadBackground(env);
  await fire(env, "action.onClicked");
  assert.equal(env.badge, "?");
  assert.match(env.title, /Zugriff auf den Server fehlt/);
  assert.equal(env.requests.length, 0);
});

test("Tag fehlt: Hinweis, genau eine Anfrage", async () => {
  const env = makeEnv();
  env.configure();
  await loadBackground(env);
  await fire(env, "runtime.onStartup");
  assert.deepEqual(apiCalls(env), ["GET /api/v1/tags"]);
  assert.match(env.title, /gibt es in Karakeep noch nicht/);
  assert.equal(env.badge, "");
});

test("nichts zu tun: genau eine Anfrage dank Zähler", async () => {
  const env = makeEnv();
  env.configure();
  env.server.addTag("t1", "an-firefox");
  env.server.add({ id: "x", content: { type: "link", url: "https://old.example" }, tags: [] });
  await loadBackground(env);
  await fire(env, "runtime.onStartup");
  assert.deepEqual(apiCalls(env), ["GET /api/v1/tags"]);
  assert.match(env.title, /Keine wartenden Links/);
});

function seedMixed(env) {
  const s = env.server;
  s.addTag("t1", "an-firefox");
  const T = (by) => [{ id: "t1", name: "an-firefox", attachedBy: by }];
  s.add({ id: "b1", title: "Artikel A", content: { type: "link", url: "https://a.example/1", title: "crawl A" }, tags: T("human") });
  s.add({ id: "b2", content: { type: "link", url: "https://ai.example" }, tags: T("ai") });
  s.add({ id: "b3", content: { type: "link", url: "javascript:alert(1)" }, tags: T("human") });
  s.add({ id: "b4", content: { type: "asset", assetType: "pdf", assetId: "as1", fileName: "doc.pdf", sourceUrl: "https://x.example/doc.pdf" }, tags: T("human") });
  s.add({ id: "b5", content: { type: "text", text: "Notiz" }, tags: T("human") });
  s.add({ id: "b6", content: { type: "link", url: "https://b.example/", title: null }, tags: T("human") });
}

test("gemischte Lesezeichen: richtige Ziele, Reihenfolge, KI-Tag bleibt, faule Tabs", async () => {
  const env = makeEnv();
  env.configure();
  seedMixed(env);
  await loadBackground(env);
  await fire(env, "runtime.onStartup");
  assert.deepEqual(
    env.tabs.map((t) => t.url),
    [
      "https://a.example/1",
      "https://kk.test/dashboard/preview/b3",
      "https://x.example/doc.pdf",
      "https://kk.test/dashboard/preview/b5",
      "https://b.example/",
    ],
  );
  assert.ok(env.tabs.every((t) => t.discarded === true && t.active === false));
  assert.equal(env.tabs[0].title, "Artikel A");
  assert.equal(env.tabs[2].title, "doc.pdf");
  assert.equal(env.tabs[4].title, undefined);
  for (const id of ["b1", "b3", "b4", "b5", "b6"]) assert.equal(env.server.hasTag(id, "t1"), false, id);
  assert.equal(env.server.attachedBy("b2", "t1"), "ai", "KI-Tag unangetastet");
  assert.match(env.title, /5 Links geöffnet/);
  assert.equal(env.badge, "");
  const deleteBeforeOpen = env.requests.filter((r) => r.method === "DELETE").length;
  assert.equal(deleteBeforeOpen, 5);
});

test("erster Tab aktiv: nicht faul, ohne Titel; Rest faul", async () => {
  const env = makeEnv();
  env.configure({ activateTabs: true });
  seedMixed(env);
  await loadBackground(env);
  await fire(env, "action.onClicked");
  assert.equal(env.tabs[0].active, true);
  assert.equal(env.tabs[0].discarded, undefined);
  assert.equal(env.tabs[0].title, undefined);
  assert.ok(env.tabs.slice(1).every((t) => t.discarded && !t.active));
});

test("faules Laden aus: normale Hintergrund-Tabs", async () => {
  const env = makeEnv();
  env.configure({ lazyTabs: false });
  seedMixed(env);
  await loadBackground(env);
  await fire(env, "action.onClicked");
  assert.equal(env.tabs.length, 5);
  assert.ok(env.tabs.every((t) => t.discarded === undefined && t.title === undefined && t.active === false));
});

test("Obergrenze: 2 von 5, Symbol zeigt +3", async () => {
  const env = makeEnv();
  env.configure({ maxPerRun: 2 });
  env.server.addTag("t1", "an-firefox");
  for (let i = 1; i <= 5; i++) {
    env.server.add({ id: `h${i}`, content: { type: "link", url: `https://h.example/${i}` }, tags: [{ id: "t1", name: "an-firefox", attachedBy: "human" }] });
  }
  await loadBackground(env);
  await fire(env, "action.onClicked");
  assert.deepEqual(env.tabs.map((t) => t.url), ["https://h.example/1", "https://h.example/2"]);
  assert.equal(env.badge, "+3");
  assert.match(env.title, /3 weitere warten/);
  await fire(env, "action.onClicked");
  await fire(env, "action.onClicked");
  assert.equal(env.tabs.length, 5);
  assert.equal(env.badge, "");
});

test("Blättern: 60 KI-Tags davor blockieren den eigenen Link nicht", async () => {
  const env = makeEnv();
  env.configure();
  env.server.addTag("t1", "an-firefox");
  for (let i = 0; i < 60; i++) {
    env.server.add({ id: `ai${i}`, content: { type: "link", url: `https://ai.example/${i}` }, tags: [{ id: "t1", name: "an-firefox", attachedBy: "ai" }] });
  }
  env.server.add({ id: "mine", content: { type: "link", url: "https://mine.example" }, tags: [{ id: "t1", name: "an-firefox", attachedBy: "human" }] });
  await loadBackground(env);
  await fire(env, "runtime.onStartup");
  assert.deepEqual(env.tabs.map((t) => t.url), ["https://mine.example"]);
  assert.equal(env.requests.filter((r) => r.url.includes("/bookmarks?")).length, 2, "zwei Seiten");
  assert.equal(env.server.attachedBy("ai0", "t1"), "ai");
});

test("kein Fenster offen: nichts abholen, beim neuen Fenster sofort", async () => {
  const env = makeEnv();
  env.configure();
  seedMixed(env);
  env.windows = [];
  await loadBackground(env);
  await fire(env, "runtime.onStartup");
  assert.equal(env.requests.length, 0, "keine API-Anfrage ohne Fenster");
  assert.equal(env.session.waitingForWindow, true);
  assert.match(env.title, /Kein Fenster offen/);
  // Hintergrundskript wurde inzwischen entladen
  await loadBackground(env);
  env.windows = [{ id: 7, type: "normal" }];
  await fire(env, "windows.onCreated", { id: 7, type: "normal" });
  assert.equal(env.tabs.length, 5, "trotz frischer letzter Abfrage sofort geholt");
  assert.equal(env.session.waitingForWindow, undefined);
});

test("Tab lässt sich nicht öffnen: Tag wird wieder gesetzt, Wiederholung geplant", async () => {
  const env = makeEnv();
  env.configure();
  seedMixed(env);
  env.tabCreateFail = "Not allowed to create tabs on the target window";
  await loadBackground(env);
  await fire(env, "action.onClicked");
  assert.deepEqual(apiCalls(env).slice(-2), ["DELETE /api/v1/bookmarks/b1/tags", "POST /api/v1/bookmarks/b1/tags"]);
  assert.equal(env.server.attachedBy("b1", "t1"), "human", "Tag wieder da");
  assert.equal(env.badge, "…");
  assert.equal(env.alarms.get("karakeep-retry").delayInMinutes, 0.5);
  assert.match(env.title, /bleibt markiert/);
  // Wiederholung klappt
  env.tabCreateFail = null;
  await loadBackground(env);
  await fire(env, "alarms.onAlarm", { name: "karakeep-retry" });
  assert.equal(env.tabs.length, 5);
  assert.equal(env.alarms.has("karakeep-retry"), false);
  assert.equal(env.session.retryCount, undefined);
  assert.equal(env.badge, "");
});

test("Netzwerkfehler: gestaffelte Wiederholung, dann rot, Erfolg setzt zurück", async () => {
  const env = makeEnv();
  env.configure();
  seedMixed(env);
  env.server.failMode = "network";
  await loadBackground(env);
  const delays = [];
  await fire(env, "runtime.onStartup");
  delays.push(env.alarms.get("karakeep-retry")?.delayInMinutes);
  assert.equal(env.badge, "…");
  for (let i = 0; i < 5; i++) {
    await loadBackground(env);
    await fire(env, "alarms.onAlarm", { name: "karakeep-retry" });
    delays.push(env.alarms.get("karakeep-retry")?.delayInMinutes);
  }
  assert.deepEqual(delays.slice(0, 5), [0.5, 1, 2, 5, 10]);
  assert.equal(env.badge, "!");
  assert.match(env.title, /Wiederholungen sind gescheitert/);
  env.server.failMode = null;
  env.alarms.delete("karakeep-retry");
  await fire(env, "action.onClicked");
  assert.equal(env.badge, "");
  assert.equal(env.session.retryCount, undefined);
  assert.equal(env.tabs.length, 5);
});

test("401: rot, keine Wiederholung", async () => {
  const env = makeEnv();
  env.configure();
  env.server.failMode = 401;
  await loadBackground(env);
  await fire(env, "action.onClicked");
  assert.equal(env.badge, "!");
  assert.equal(env.badgeColor, "#c0392b");
  assert.match(env.title, /HTTP 401/);
  assert.equal(env.alarms.has("karakeep-retry"), false);
});

test("503, Zeitüberschreitung und HTML-Antwort: Wiederholung", async () => {
  for (const [mode, re] of [
    [503, /HTTP 503/],
    ["timeout", /Zeitüberschreitung/],
    ["html", /kein JSON/],
  ]) {
    const env = makeEnv();
    env.configure();
    env.server.failMode = mode;
    await loadBackground(env);
    await fire(env, "action.onClicked");
    assert.equal(env.badge, "…", String(mode));
    assert.match(env.title, re);
    assert.ok(env.alarms.has("karakeep-retry"));
  }
});

test("Entprellung: automatische Auslöser höchstens alle 30 s", async () => {
  const env = makeEnv();
  env.configure();
  env.server.addTag("t1", "an-firefox");
  await loadBackground(env);
  env.session.lastPollAt = Date.now() - 5000;
  await fire(env, "alarms.onAlarm", { name: "karakeep-poll" });
  await fire(env, "windows.onFocusChanged", 1);
  assert.equal(env.requests.length, 0);
  env.session.lastPollAt = Date.now() - 31000;
  await fire(env, "windows.onFocusChanged", 1);
  assert.equal(env.requests.length, 1);
  await fire(env, "windows.onFocusChanged", 1);
  assert.equal(env.requests.length, 1, "direkt danach wieder entprellt");
  await fire(env, "windows.onFocusChanged", -1);
  assert.equal(env.requests.length, 1, "Fokus verlassen löst nichts aus");
  await fire(env, "action.onClicked");
  assert.equal(env.requests.length, 3, "Klick ignoriert Entprellung und sieht immer in der Liste nach");
});

test("gleichzeitige Auslöser teilen sich eine Abfrage", async () => {
  const env = makeEnv();
  env.configure();
  seedMixed(env);
  await loadBackground(env);
  const listeners = env.listeners["action.onClicked"];
  listeners[0]();
  listeners[0]();
  env.listeners["runtime.onStartup"][0]();
  await flush(60);
  assert.equal(env.tabs.length, 5);
  assert.equal(env.requests.filter((r) => r.method === "GET" && r.url.startsWith("/api/v1/tags?")).length, 1);
});

test("Rückkehr an den Rechner nach Entladen: Abfrage findet statt (Fehler aus 1.1.0)", async () => {
  const env = makeEnv();
  env.configure();
  seedMixed(env);
  await loadBackground(env);
  await fire(env, "idle.onStateChanged", "idle");
  await loadBackground(env); // entladen und neu geladen, globale Variablen weg
  await fire(env, "idle.onStateChanged", "active");
  assert.equal(env.requests.length, 0, "erst nach kurzer Pause");
  assert.equal(env.timers[0].ms, 3000);
  await runTimers(env);
  assert.equal(env.tabs.length, 5);
  assert.equal(env.idleInterval, 60);
});

test("Wecker: Standard 2 min, 0 schaltet ab, Änderung wirkt, Selbstheilung", async () => {
  const env = makeEnv();
  env.configure();
  await loadBackground(env);
  assert.deepEqual(env.alarms.get("karakeep-poll"), { name: "karakeep-poll", delayInMinutes: 2, periodInMinutes: 2 });
  await env.listeners["storage.onChanged"] && makeBrowser(env).storage.local.set({ intervalMinutes: 0 });
  await flush();
  assert.equal(env.alarms.has("karakeep-poll"), false);
  await makeBrowser(env).storage.local.set({ intervalMinutes: 5 });
  await flush();
  assert.equal(env.alarms.get("karakeep-poll").periodInMinutes, 5);
  env.alarms.clear();
  await loadBackground(env);
  assert.equal(env.alarms.get("karakeep-poll").periodInMinutes, 5, "fehlender Wecker wird beim Laden ergänzt");
  const before = env.alarms.get("karakeep-poll");
  await loadBackground(env);
  assert.equal(env.alarms.get("karakeep-poll"), before, "bestehender Wecker bleibt unangetastet");
});

test("Archivieren nach dem Öffnen", async () => {
  const env = makeEnv();
  env.configure({ archiveAfterOpen: true });
  seedMixed(env);
  await loadBackground(env);
  await fire(env, "action.onClicked");
  const archived = env.server.bookmarks.filter((b) => b.archived).map((b) => b.id);
  assert.deepEqual(archived, ["b1", "b3", "b4", "b5", "b6"]);
});

test("Klick sieht auch bei falschem Zähler nach, automatisch nicht", async () => {
  const env = makeEnv();
  env.configure();
  seedMixed(env);
  env.server.wrongCount = true;
  await loadBackground(env);
  await fire(env, "runtime.onStartup");
  assert.equal(env.tabs.length, 0);
  await fire(env, "action.onClicked");
  assert.equal(env.tabs.length, 5);
});

test("Nachricht von der Einstellungsseite liefert Ergebnis; fremde Absender ignoriert", async () => {
  const env = makeEnv();
  env.configure();
  seedMixed(env);
  await loadBackground(env);
  const fn = env.listeners["runtime.onMessage"][0];
  assert.equal(fn({ type: "poll-now" }, { id: "fremd@example" }), undefined);
  const result = await fn({ type: "poll-now" }, { id: manifest.browser_specific_settings.gecko.id });
  assert.equal(result.level, "ok");
  assert.equal(result.opened, 5);
  assert.match(result.message, /5 Links geöffnet/);
});

test("Port in der Adresse, Tag mit # und anderer Schreibweise", async () => {
  const env = makeEnv();
  Object.assign(env.local, { serverUrl: "https://kk.test:3000", apiKey: "KEY", tagName: "#AN-Firefox" });
  env.granted.add("https://kk.test/*");
  seedMixed(env);
  await loadBackground(env);
  await fire(env, "action.onClicked");
  assert.equal(env.tabs.length, 5);
  assert.equal(env.tabs[1].url, "https://kk.test:3000/dashboard/preview/b3");
});

test("Tag zwischen den Anfragen gelöscht: kein Fehler", async () => {
  const env = makeEnv();
  env.configure();
  seedMixed(env);
  env.server.deleteTagAfterList = true;
  env.server.add({ id: "late", content: { type: "link", url: "https://late.example" }, tags: [] });
  await loadBackground(env);
  // erster Seitenabruf gelingt noch, der Tag verschwindet danach
  await fire(env, "action.onClicked");
  assert.notEqual(env.badge, "!");
});

test("Installation öffnet Einstellungen, Update nicht", async () => {
  const env = makeEnv();
  await loadBackground(env);
  await fire(env, "runtime.onInstalled", { reason: "update" });
  assert.equal(env.optionsOpened, 0);
  await fire(env, "runtime.onInstalled", { reason: "install" });
  assert.equal(env.optionsOpened, 1);
});
