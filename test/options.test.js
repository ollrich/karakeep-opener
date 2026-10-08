"use strict";
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { JSDOM } = require("jsdom");

const SRC = process.env.SRC || path.join(__dirname, "..", "extension");
const html = fs.readFileSync(`${SRC}/options.html`, "utf8").replace(/<script[^>]*><\/script>/g, "");
const common = fs.readFileSync(`${SRC}/common.js`, "utf8");
const options = fs.readFileSync(`${SRC}/options.js`, "utf8");
const manifest = JSON.parse(fs.readFileSync(`${SRC}/manifest.json`, "utf8"));
const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

async function page({ stored = {}, title = manifest.action.default_title, grant = true, reply, replyError } = {}) {
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  const w = dom.window;
  const st = {
    stored: { ...stored },
    sets: [],
    requests: [],
    messages: [],
    inClick: false,
  };
  w.browser = {
    storage: {
      local: {
        get: async (defaults) => Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, k in st.stored ? st.stored[k] : d])),
        set: async (obj) => {
          st.sets.push(JSON.parse(JSON.stringify(obj)));
          Object.assign(st.stored, obj);
        },
      },
    },
    permissions: {
      request: async ({ origins }) => {
        st.requests.push({ origins: JSON.parse(JSON.stringify(origins)), duringClick: st.inClick });
        return grant;
      },
    },
    action: { getTitle: async () => title },
    runtime: {
      getManifest: () => manifest,
      sendMessage: async (msg) => {
        st.messages.push(JSON.parse(JSON.stringify(msg)));
        if (replyError) throw new Error(replyError);
        return reply ?? { level: "ok", opened: 0, message: "Keine wartenden Links." };
      },
    },
  };
  for (const code of [common, options]) {
    const el = w.document.createElement("script");
    el.textContent = code;
    w.document.body.appendChild(el);
  }
  await flush();
  const $ = (id) => w.document.getElementById(id);
  const click = async () => {
    st.inClick = true;
    $("save").click();
    st.inClick = false;
    await flush();
  };
  const type = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new w.Event("input"));
  };
  return { w, $, st, click, type };
}


test("Formular zeigt gespeicherte Werte und Standards", async () => {
  const { $ } = await page({ stored: { serverUrl: "https://kk.test", apiKey: "K", maxPerRun: 7 } });
  assert.equal($("serverUrl").value, "https://kk.test");
  assert.equal($("apiKey").value, "K");
  assert.equal($("tagName").value, "an-firefox");
  assert.equal($("intervalMinutes").value, "2");
  assert.equal($("maxPerRun").value, "7");
  assert.equal($("lazyTabs").checked, true);
  assert.equal($("activateTabs").checked, false);
  assert.equal($("archiveAfterOpen").checked, false);
  assert.equal($("httpWarning").hidden, true);
  assert.equal($("status").textContent, "");
});

test("http-Adresse zeigt Warnung", async () => {
  const { $, type } = await page();
  type("serverUrl", "http://nas.local:3000");
  assert.equal($("httpWarning").hidden, false);
  type("serverUrl", "https://nas.local");
  assert.equal($("httpWarning").hidden, true);
});

test("ungültige Adresse: Fehler, keine Rückfrage", async () => {
  const { $, st, click, type } = await page();
  type("serverUrl", "kk.test");
  type("apiKey", "KEY");
  await click();
  assert.equal(st.requests.length, 0);
  assert.equal($("status").dataset.kind, "error");
  assert.match($("status").textContent, /gültige Adresse/);
});

test("fehlender Schlüssel: Fehler, keine Rückfrage", async () => {
  const { $, st, click, type } = await page();
  type("serverUrl", "https://kk.test");
  await click();
  assert.equal(st.requests.length, 0);
  assert.match($("status").textContent, /API-Schlüssel/);
});

test("Speichern: Rückfrage direkt im Klick, bereinigte Werte, Prüfung mit Ergebnis", async () => {
  const { $, st, click, type } = await page({ reply: { level: "ok", opened: 3, message: "3 Links geöffnet." } });
  type("serverUrl", " https://kk.test:3000/api/v1/ ");
  type("apiKey", "  KEY ");
  type("tagName", " #an-firefox ");
  type("intervalMinutes", "0");
  type("maxPerRun", "500");
  $("activateTabs").checked = true;
  await click();
  assert.deepEqual(st.requests, [{ origins: ["https://kk.test/*"], duringClick: true }]);
  assert.equal(st.sets.length, 1);
  assert.deepEqual(st.sets[0], {
    serverUrl: "https://kk.test:3000",
    apiKey: "KEY",
    tagName: "an-firefox",
    intervalMinutes: 0,
    maxPerRun: 100,
    activateTabs: true,
    lazyTabs: true,
    archiveAfterOpen: false,
  });
  assert.equal($("serverUrl").value, "https://kk.test:3000", "Formular zeigt bereinigte Adresse");
  assert.equal($("maxPerRun").value, "100");
  assert.deepEqual(st.messages, [{ type: "poll-now" }]);
  assert.equal($("status").textContent, "Gespeichert. 3 Links geöffnet.");
  assert.equal($("status").dataset.kind, "info");
});

test("Berechtigung abgelehnt: nichts gespeichert", async () => {
  const { $, st, click, type } = await page({ grant: false });
  type("serverUrl", "https://kk.test");
  type("apiKey", "KEY");
  await click();
  assert.equal(st.sets.length, 0);
  assert.equal(st.messages.length, 0);
  assert.equal($("status").dataset.kind, "error");
});

test("Prüfung meldet Fehler oder Wiederholung", async () => {
  {
    const { $, click, type } = await page({ reply: { level: "error", message: "API-Schlüssel ungültig oder widerrufen (HTTP 401)." } });
    type("serverUrl", "https://kk.test");
    type("apiKey", "KEY");
    await click();
    assert.equal($("status").dataset.kind, "error");
    assert.match($("status").textContent, /HTTP 401/);
  }
  {
    const { $, click, type } = await page({ reply: { level: "retry", message: "Server nicht erreichbar. Neuer Versuch um 10:00." } });
    type("serverUrl", "https://kk.test");
    type("apiKey", "KEY");
    await click();
    assert.equal($("status").dataset.kind, "warn");
  }
  {
    const { $, click, type } = await page({ replyError: "Could not establish connection" });
    type("serverUrl", "https://kk.test");
    type("apiKey", "KEY");
    await click();
    assert.equal($("status").dataset.kind, "error");
    assert.match($("status").textContent, /Gespeichert, aber/);
  }
});

test("letzter Stand wird beim Öffnen angezeigt", async () => {
  const { $ } = await page({ title: "Karakeep Opener, 09:41 (Start): Keine wartenden Links." });
  assert.equal($("status").textContent, "Letzter Stand: Karakeep Opener, 09:41 (Start): Keine wartenden Links.");
});
