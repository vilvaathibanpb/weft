// Auth-header handling in the background worker: values stay in the browser, names go to the app.
// Run: node extension/test/auth-headers.test.mjs
import fs from "node:fs"; import vm from "node:vm"; import strict from "node:assert/strict"; const J = (x) => JSON.parse(JSON.stringify(x)); const assert = { ok: strict.ok, deepEqual: (a, b, m) => strict.deepEqual(J(a), J(b), m) };
const src = fs.readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
const store = {}; const sent = []; const ev = () => ({ addListener() {} });
const chrome = {
  storage: { session: { async get(k) { return { [k]: store[k] }; }, async set(o) { Object.assign(store, o); }, async remove() {} },
             local: { async get() { return {}; }, async set() {} } },
  runtime: { onMessage: ev(), onStartup: ev(), onInstalled: ev() },
  tabs: { onRemoved: ev() }, debugger: { onEvent: ev(), onDetach: ev() }, action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  alarms: { create() {}, onAlarm: ev() },
};
class WebSocket { constructor() { this.readyState = 0; } send() {} close() {} }
const ctx = { chrome, WebSocket, console, setTimeout, clearTimeout, crypto: globalThis.crypto };
vm.createContext(ctx);
vm.runInContext(src.replace(/^connect\(\);\s*$/m, "") + "\nthis.__t={authHeadersOf,rememberAuthHeaders,replayHeaders};", ctx);
ctx.__sink = (m) => sent.push(m); vm.runInContext("send = (m) => __sink(m)", ctx);
const t = ctx.__t;
assert.deepEqual(Object.keys(t.authHeadersOf({ Authorization: "Bearer a", "X-CSRF-Token": "c", "x-api-key": "k", "X-Goog-AuthUser": "0", "Content-Type": "json", "x-requested-with": "XHR", Accept: "*/*" })).sort(),
  ["authorization", "x-api-key", "x-csrf-token", "x-goog-authuser"]);
await t.rememberAuthHeaders("https://app.x", { Authorization: "Bearer old", Accept: "*/*" });
await t.rememberAuthHeaders("https://app.x", { Authorization: "Bearer new", "X-CSRF-Token": "c1" });
assert.deepEqual(sent.map((m) => m.names), [["authorization"], ["x-csrf-token"]]);
assert.ok(sent.every((m) => !JSON.stringify(m).includes("Bearer")), "values must never be sent to the app");
assert.deepEqual(await t.replayHeaders("https://app.x", [{ k: "Content-Type", v: "application/json" }]),
  { authorization: "Bearer new", "x-csrf-token": "c1", "Content-Type": "application/json" });
assert.deepEqual(await t.replayHeaders("https://app.x", [{ k: "Authorization", v: "Bearer mine" }]),
  { "x-csrf-token": "c1", Authorization: "Bearer mine" });
assert.deepEqual(await t.replayHeaders("https://other.y", []), {});
console.log("all auth-header tests passed");
