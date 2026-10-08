"use strict";
// Testumgebung: nachgebildetes Firefox (Regeln für tabs.create wie in
// Firefox ext-tabs.js) und nachgebildete Karakeep-API. loadBackground() lädt
// die Skripte jedes Mal in einen frischen Kontext, so wie Firefox ein
// entladenes Hintergrundskript neu startet: globale Variablen sind dann weg,
// storage, Wecker und Tabs bleiben.
const fs = require("fs");
const vm = require("vm");
const assert = require("assert/strict");

const path = require("path");

const SRC = process.env.SRC || path.join(__dirname, "..", "extension");
const files = ["common.js", "background.js"].map((f) => [f, fs.readFileSync(`${SRC}/${f}`, "utf8")]);
const manifest = JSON.parse(fs.readFileSync(`${SRC}/manifest.json`, "utf8"));

const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

// Karakeep-Server
function makeServer() {
  const s = {
    tags: new Map(), // id -> name
    bookmarks: [], // {id, createdAt, title, content, tags:[{id,name,attachedBy}], archived}
    wrongCount: false,
    failMode: null, // "network" | "timeout" | 401 | 500 | "html"
    deleteTagAfterList: false,
  };
  s.addTag = (id, name) => s.tags.set(id, name);
  s.add = (bm) => {
    s.bookmarks.push({ archived: false, title: null, createdAt: s.bookmarks.length, ...bm });
  };
  s.hasTag = (bmId, tagId) => s.bookmarks.find((b) => b.id === bmId).tags.some((t) => t.id === tagId);
  s.attachedBy = (bmId, tagId) => s.bookmarks.find((b) => b.id === bmId).tags.find((t) => t.id === tagId)?.attachedBy;
  return s;
}

function makeFetch(env) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    env.requests.push({ method, url: u.pathname + u.search, init });
    const srv = env.server;
    if (srv.failMode === "network") throw new TypeError("NetworkError when attempting to fetch resource.");
    if (srv.failMode === "timeout") {
      const e = new Error("The operation timed out.");
      e.name = "TimeoutError";
      throw e;
    }
    const reply = (status, obj) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (obj === undefined ? "" : typeof obj === "string" ? obj : JSON.stringify(obj)),
      json: async () => JSON.parse(typeof obj === "string" ? obj : JSON.stringify(obj)),
    });
    if (typeof srv.failMode === "number") return reply(srv.failMode, { code: "x", message: "fail" });
    if (srv.failMode === "html") return reply(200, "<html>WLAN Login</html>");
    assert.equal(init.headers.Authorization, "Bearer KEY", "Authorization-Header fehlt");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    if (init.body === undefined) assert.equal(init.headers["Content-Type"], undefined, "GET ohne Content-Type");
    else assert.equal(init.headers["Content-Type"], "application/json");
    assert.ok(u.pathname.startsWith("/api/v1/"), "Pfad beginnt mit /api/v1");
    const p = u.pathname.slice("/api/v1".length);

    let m;
    if (method === "GET" && p === "/tags") {
      const needle = (u.searchParams.get("nameContains") || "").toLowerCase();
      const tags = [...srv.tags]
        .filter(([, name]) => name.toLowerCase().includes(needle))
        .map(([id, name]) => {
          const with_ = srv.bookmarks.filter((b) => b.tags.some((t) => t.id === id));
          const human = with_.filter((b) => b.tags.find((t) => t.id === id).attachedBy === "human").length;
          return {
            id,
            name,
            numBookmarks: with_.length,
            numBookmarksByAttachedType: { ai: with_.length - human, human: srv.wrongCount ? 0 : human },
          };
        });
      return reply(200, { tags, nextCursor: null });
    }
    if (method === "GET" && (m = p.match(/^\/tags\/([^/]+)\/bookmarks$/))) {
      const tagId = decodeURIComponent(m[1]);
      if (!srv.tags.has(tagId)) return reply(404, { code: "NOT_FOUND", message: "Tag not found" });
      assert.equal(u.searchParams.get("sortOrder"), "asc");
      assert.equal(u.searchParams.get("includeContent"), "false");
      const limit = Number(u.searchParams.get("limit"));
      const offset = Number(u.searchParams.get("cursor") || 0);
      const all = srv.bookmarks.filter((b) => b.tags.some((t) => t.id === tagId)).sort((a, b) => a.createdAt - b.createdAt);
      const page = all.slice(offset, offset + limit);
      const next = offset + limit < all.length ? String(offset + limit) : null;
      if (srv.deleteTagAfterList) srv.tags.delete(tagId);
      return reply(200, { bookmarks: JSON.parse(JSON.stringify(page)), nextCursor: next });
    }
    if ((m = p.match(/^\/bookmarks\/([^/]+)\/tags$/)) && (method === "DELETE" || method === "POST")) {
      const bm = srv.bookmarks.find((b) => b.id === decodeURIComponent(m[1]));
      if (!bm) return reply(404, { code: "NOT_FOUND", message: "no" });
      const body = JSON.parse(init.body);
      const ids = body.tags.map((t) => t.tagId);
      if (method === "DELETE") {
        bm.tags = bm.tags.filter((t) => !ids.includes(t.id));
        return reply(200, { detached: ids });
      }
      for (const id of ids) {
        if (!bm.tags.some((t) => t.id === id)) bm.tags.push({ id, name: srv.tags.get(id), attachedBy: "human" });
      }
      return reply(200, { attached: ids });
    }
    if (method === "PATCH" && (m = p.match(/^\/bookmarks\/([^/]+)$/))) {
      const bm = srv.bookmarks.find((b) => b.id === decodeURIComponent(m[1]));
      Object.assign(bm, JSON.parse(init.body));
      return reply(200, { id: bm.id });
    }
    return reply(404, { code: "NOT_FOUND", message: `kein Mock für ${method} ${p}` });
  };
}

// Firefox-Umgebung
function makeEnv() {
  const env = {
    local: {},
    session: {},
    alarms: new Map(),
    tabs: [],
    badge: "",
    badgeColor: null,
    title: manifest.action.default_title,
    windows: [{ id: 1, type: "normal" }],
    granted: new Set(),
    requests: [],
    server: makeServer(),
    listeners: {},
    timers: [],
    tabCreateFail: null,
    optionsOpened: 0,
    idleInterval: null,
    permissionRequests: [],
  };
  env.configure = (extra = {}) => {
    Object.assign(env.local, { serverUrl: "https://kk.test", apiKey: "KEY", ...extra });
    env.granted.add("https://kk.test/*");
  };
  return env;
}

function event(env, name) {
  return {
    addListener: (fn) => {
      (env.listeners[name] ||= []).push(fn);
    },
  };
}

function storageArea(env, key) {
  return {
    get: async (q) => {
      const area = env[key];
      if (q == null) return { ...area };
      if (typeof q === "string") return q in area ? { [q]: area[q] } : {};
      if (Array.isArray(q)) return Object.fromEntries(q.filter((k) => k in area).map((k) => [k, area[k]]));
      return Object.fromEntries(Object.entries(q).map(([k, d]) => [k, k in area ? area[k] : d]));
    },
    set: async (obj) => {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: env[key][k], newValue: v };
        env[key][k] = v;
      }
      if (key === "local") for (const fn of env.listeners["storage.onChanged"] || []) fn(changes, "local");
    },
    remove: async (k) => {
      for (const kk of [].concat(k)) delete env[key][kk];
    },
  };
}

function makeBrowser(env) {
  return {
    storage: { local: storageArea(env, "local"), session: storageArea(env, "session"), onChanged: event(env, "storage.onChanged") },
    permissions: {
      contains: async ({ origins }) => origins.every((o) => env.granted.has(o)),
      request: async ({ origins }) => {
        env.permissionRequests.push(origins);
        origins.forEach((o) => env.granted.add(o));
        return true;
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getAll: async ({ windowTypes } = {}) => env.windows.filter((w) => !windowTypes || windowTypes.includes(w.type)),
      onFocusChanged: event(env, "windows.onFocusChanged"),
      onCreated: event(env, "windows.onCreated"),
    },
    tabs: {
      // Regeln wie in Firefox ext-tabs.js (verifiziert)
      create: async (p) => {
        if (env.windows.length === 0) throw new Error("Not allowed to create tabs on the target window");
        if (env.tabCreateFail) throw new Error(env.tabCreateFail);
        const active = p.active ?? true;
        if (p.discarded) {
          if (active) throw new Error("Active tabs cannot be created and discarded.");
          if (p.pinned) throw new Error("Pinned tabs cannot be created and discarded.");
        } else if (p.title) {
          throw new Error("Title may only be set for discarded tabs.");
        }
        if (!/^https?:/.test(p.url)) throw new Error(`Illegal URL: ${p.url}`);
        env.tabs.push({ ...p });
        return { id: env.tabs.length };
      },
    },
    action: {
      setBadgeText: async ({ text }) => {
        env.badge = text;
      },
      setBadgeBackgroundColor: async ({ color }) => {
        env.badgeColor = color;
      },
      setTitle: async ({ title }) => {
        env.title = title;
      },
      getTitle: async () => env.title,
      onClicked: event(env, "action.onClicked"),
    },
    alarms: {
      create: (name, info) => {
        env.alarms.set(name, { name, ...info });
      },
      clear: async (name) => env.alarms.delete(name),
      get: async (name) => env.alarms.get(name),
      onAlarm: event(env, "alarms.onAlarm"),
    },
    idle: {
      setDetectionInterval: (n) => {
        env.idleInterval = n;
      },
      onStateChanged: event(env, "idle.onStateChanged"),
    },
    runtime: {
      id: manifest.browser_specific_settings.gecko.id,
      onStartup: event(env, "runtime.onStartup"),
      onInstalled: event(env, "runtime.onInstalled"),
      onMessage: event(env, "runtime.onMessage"),
      openOptionsPage: () => {
        env.optionsOpened++;
      },
      getManifest: () => manifest,
    },
  };
}

// Lädt das Hintergrundskript frisch, wie Firefox nach dem Entladen.
async function loadBackground(env) {
  env.listeners = {};
  const ctx = vm.createContext({
    browser: makeBrowser(env),
    fetch: makeFetch(env),
    AbortSignal,
    URL,
    URLSearchParams,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => env.timers.push({ fn, ms }),
    Date,
  });
  for (const [name, code] of files) vm.runInContext(code, ctx, { filename: name });
  await flush();
  return ctx;
}

async function fire(env, name, ...args) {
  const results = (env.listeners[name] || []).map((fn) => fn(...args));
  await flush();
  return Promise.all(results);
}

async function runTimers(env) {
  const t = env.timers.splice(0);
  t.forEach(({ fn }) => fn());
  await flush();
}

const apiCalls = (env) => env.requests.map((r) => `${r.method} ${r.url.split("?")[0]}`);


module.exports = { makeEnv, loadBackground, fire, runTimers, flush, makeBrowser, apiCalls, manifest, vm };
