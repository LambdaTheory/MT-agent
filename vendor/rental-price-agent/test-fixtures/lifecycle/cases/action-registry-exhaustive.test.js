const fs = require("fs");
const path = require("path");

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..");

function readScript(name) {
  return fs.readFileSync(path.join(SKILL_DIR, "scripts", name), "utf8");
}

function functionBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Unable to characterize source section: " + startMarker);
  return source.slice(start, end);
}

function sortedCases(source) {
  return [...new Set([...source.matchAll(/case\s+["']([^"']+)["']\s*:/g)].map(match => match[1]))].sort();
}

function sortedEmittedActions(source) {
  return [...new Set([...source.matchAll(/action\s*:\s*["']([^"']+)["']/g)].map(match => match[1]))].sort();
}

function characterizeCurrentActions() {
  const runner = readScript("playwright-runner.js");
  const batch = readScript("batch-runner.js");
  return {
    daemon: sortedCases(functionBody(runner, "async function handleCommand", "function sendCommand")),
    legacy: sortedCases(functionBody(runner, "async function handleLegacyAction", "// Main")),
    batchEmitted: sortedEmittedActions(batch),
  };
}

async function register({ test, assert }) {
  test("action-registry: baseline characterizes daemon, legacy, and batch action surfaces", async () => {
    assert.deepEqual(characterizeCurrentActions(), {
      daemon: [
        "apply", "apply-current", "batch-read", "copy", "delist", "discard-current-form", "hello", "image-order",
        "image-pick", "image-read", "image-upload", "image-verify", "login", "navigate", "ping",
        "platform-search", "read", "spec-add-and-refresh", "spec-add-dim", "spec-add-item", "spec-discover",
        "spec-refresh", "spec-remove-dim", "spec-remove-item", "submit", "tenancy-set", "vas-apply",
        "vas-catalog-read", "vas-read", "vas-verify", "white-image-set",
      ],
      legacy: ["apply", "batch-read", "copy", "delist", "image-read", "image-upload", "image-verify", "login", "navigate", "platform-search", "read", "screenshot", "submit", "verify"],
      batchEmitted: [
        "apply", "apply-current", "discard-current-form", "image-order", "image-pick", "image-read", "image-upload",
        "image-verify", "login", "read", "spec-add-and-refresh", "submit", "tenancy-set", "vas-apply",
        "vas-catalog-read", "vas-read", "vas-verify", "white-image-set",
      ],
    });
  });

  test("action-registry: every characterized action requires explicit metadata", async () => {
    const registry = require(path.join(SKILL_DIR, "scripts", "lib", "action-registry.js"));
    const inventory = characterizeCurrentActions();
    const result = registry.validateRegistryCoverage(inventory);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.invalid, []);
    assert.equal(result.ok, true);
  });

  test("action-registry: unknown, malformed, and wildcard actions are blocked", async () => {
    const registry = require(path.join(SKILL_DIR, "scripts", "lib", "action-registry.js"));
    for (const action of [undefined, null, "", "read-*", "*", "future-read"]) {
      const decision = registry.classifyAction(action);
      assert.equal(decision.allowed, false, String(action));
      assert.equal(decision.blocked, true, String(action));
      assert.equal(decision.classification, null, String(action));
      assert.equal(decision.reason, "ACTION_NOT_CLASSIFIED", String(action));
    }
    assert.equal(registry.ACTION_CLASSES.includes("safe-read"), true);
    assert.equal(registry.listActions().some(entry => entry.action.includes("*")), false);
  });

  test("action-registry: stale dispatch inventory and misleading metadata fail closed", async () => {
    const registry = require(path.join(SKILL_DIR, "scripts", "lib", "action-registry.js"));
    const inventory = characterizeCurrentActions();
    inventory.daemon.push("new-unregistered-action");
    const stale = registry.validateRegistryCoverage(inventory);
    assert.equal(stale.ok, false);
    assert.deepEqual(stale.missing, ["new-unregistered-action"]);
    assert.equal(registry.validateRegistryCoverage({ daemon: ["read"], legacy: [], batchEmitted: [] }, { read: { status: "ok" } }).ok, false);
  });

  test("action-registry: composite safety uses the maximum-risk child and blocks unknown children", async () => {
    const registry = require(path.join(SKILL_DIR, "scripts", "lib", "action-registry.js"));
    assert.equal(registry.classifyComposite([{ action: "ping" }, { action: "read" }]).classification, "safe-read");
    assert.equal(registry.classifyComposite([{ action: "read" }, { action: "login" }]).classification, "lifecycle-control");
    assert.equal(registry.classifyComposite([{ action: "read" }, { action: "submit" }]).classification, "mutation");
    const blocked = registry.classifyComposite([{ action: "read" }, { action: "future-read" }]);
    assert.equal(blocked.allowed, false);
    assert.deepEqual(blocked.blockedChildren, ["future-read"]);
  });

  test("action-registry: handshake schema is deterministic, complete, and strict", async () => {
    const contract = require(path.join(SKILL_DIR, "scripts", "lib", "version-contract.js"));
    const first = contract.buildHandshakeMetadata({ instanceId: "qa-instance" });
    const second = contract.buildHandshakeMetadata({ instanceId: "qa-instance" });
    assert.deepEqual(second, first);
    assert.deepEqual(Object.keys(first).sort(), [
      "actualSchemaVersions", "browserSource", "browserVersion", "configSchemaVersion", "daemonVersion", "instanceId",
      "maxClientProtocolVersion", "minClientProtocolVersion", "persistedStateBlockers", "persistedStateDigest",
      "persistedStateReady", "protocolVersion", "releaseTreeSha256", "restartRequired", "skillVersion", "stateSchemaVersion", "upgradeLock",
    ]);
    assert.equal(first.browserSource, null);
    assert.equal(first.browserVersion, null);
    assert.equal(first.upgradeLock, false);
    assert.equal(first.restartRequired, false);
    assert.deepEqual(contract.validateHandshakeMetadata(first), first);
    assert.throws(() => contract.validateHandshakeMetadata({ ...first, protocolVersion: "stale" }), error => error.code === "INVALID_HANDSHAKE_METADATA");
    assert.throws(() => contract.validateHandshakeMetadata({ ...first, surprise: true }), error => error.code === "INVALID_HANDSHAKE_METADATA");
  });

  test("action-registry: daemon ping and hello return the shared metadata contract without browser startup", async () => {
    const runner = require(path.join(SKILL_DIR, "scripts", "playwright-runner.js"));
    const contract = require(path.join(SKILL_DIR, "scripts", "lib", "version-contract.js"));
    const ping = await runner.handleCommand({ action: "ping" });
    const hello = await runner.handleCommand({ action: "hello" });
    assert.equal(ping.status, "ok");
    assert.equal(ping.pong, true);
    assert.equal(hello.status, "ok");
    assert.equal(hello.hello, true);
    const metadataFields = [...contract.HANDSHAKE_FIELDS];
    const pingMetadata = Object.fromEntries(metadataFields.map(field => [field, ping[field]]));
    const helloMetadata = Object.fromEntries(metadataFields.map(field => [field, hello[field]]));
    assert.deepEqual(contract.validateHandshakeMetadata(pingMetadata), pingMetadata);
    assert.deepEqual(helloMetadata, pingMetadata);
  });

  test("action-registry: module inspection is unaffected by unrelated dirty files", async () => {
    const registry = require(path.join(SKILL_DIR, "scripts", "lib", "action-registry.js"));
    const dirtyPath = path.join(SKILL_DIR, ".omo", "action-registry-dirty-probe.tmp");
    fs.mkdirSync(path.dirname(dirtyPath), { recursive: true });
    fs.writeFileSync(dirtyPath, "unrelated dirty worktree probe\n", "utf8");
    try {
      const before = JSON.stringify(registry.listActions());
      const after = JSON.stringify(registry.listActions());
      assert.equal(after, before);
      assert.equal(registry.validateRegistryCoverage(characterizeCurrentActions()).ok, true);
    } finally {
      fs.rmSync(dirtyPath, { force: true });
    }
  });
}

module.exports = { characterizeCurrentActions, register };
