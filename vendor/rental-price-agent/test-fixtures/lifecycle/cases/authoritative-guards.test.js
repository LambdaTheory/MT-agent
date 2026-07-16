const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..");
const PRELOAD_PATH = path.join(SKILL_DIR, "scripts", "lib", "lifecycle-test-preload.js");
const RUNNER_PATH = path.join(SKILL_DIR, "scripts", "run-lifecycle-tests.js");

function guardedEnv(evidencePath, overrides = {}) {
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
  const preloadOptionPath = PRELOAD_PATH.replace(/\\/g, "/");
  const nodeOptions = existingNodeOptions.includes("lifecycle-test-preload.js")
    ? existingNodeOptions
    : [existingNodeOptions, '--require="' + preloadOptionPath.replace(/"/g, '\\"') + '"'].filter(Boolean).join(" ");
  return {
    ...process.env,
    LIFECYCLE_TEST_GUARD: "1",
    LIFECYCLE_TEST_EVIDENCE_PATH: evidencePath,
    NODE_OPTIONS: nodeOptions,
    ...overrides,
  };
}

function runGuarded(script, evidencePath, overrides = {}) {
  return childProcess.spawnSync(process.execPath, ["-e", script], {
    cwd: SKILL_DIR,
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
    env: guardedEnv(evidencePath, overrides),
  });
}

function outerGuardEnv(overrides = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("LIFECYCLE_TEST_") && key !== "NODE_OPTIONS")),
    ...overrides,
  };
}

async function waitForRemoval(filePath) {
  const deadline = Date.now() + 3000;
  while (fs.existsSync(filePath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
}

async function register({ test, assert, helpers }) {
  test("authoritative guard: preload intercepts every native network path before sockets", async () => {
    const evidencePath = path.join(helpers.support.PROCESS_TEMP_PARENT, "native-network.jsonl");
    const script = String.raw`
      const http = require("http");
      const https = require("https");
      const net = require("net");
      const tls = require("tls");
      const dns = require("dns");
      const results = [];
      async function capture(name, fn) {
        try {
          const value = fn();
          if (value && typeof value.then === "function") await value;
          results.push([name, "NO_ERROR"]);
        } catch (error) {
          results.push([name, error.code]);
        }
      }
      (async () => {
        await capture("fetch", () => fetch("https://merchant.example.test/web/index.php?r=goods.edit&id=761"));
        await capture("http.request", () => http.request("http://192.0.2.1/blocked"));
        await capture("http.get", () => http.get("http://192.0.2.1/blocked"));
        await capture("https.request", () => https.request("https://merchant.example.test/upload"));
        await capture("https.get", () => https.get("https://merchant.example.test/submit"));
        await capture("net.connect", () => net.connect({ host: "192.0.2.1", port: 80 }));
        await capture("net.createConnection", () => net.createConnection({ host: "192.0.2.1", port: 80 }));
        await capture("net.Socket.connect", () => new net.Socket().connect({ host: "192.0.2.1", port: 80 }));
        await capture("tls.connect", () => tls.connect({ host: "merchant.example.test", port: 443 }));
        await capture("dns.lookup", () => dns.lookup("merchant.example.test", () => {}));
        await capture("dns.resolve", () => dns.resolve("merchant.example.test", () => {}));
        await capture("dns.resolve4", () => dns.resolve4("merchant.example.test", () => {}));
        await capture("dns.promises.lookup", () => dns.promises.lookup("merchant.example.test"));
        await capture("dns.promises.resolve4", () => dns.promises.resolve4("merchant.example.test"));
        process.stdout.write(JSON.stringify(results));
      })().catch(error => { console.error(error); process.exit(1); });
    `;
    const result = runGuarded(script, evidencePath);
    assert.equal(result.status, 0, result.stderr);
    const observations = JSON.parse(result.stdout);
    assert.equal(observations.length, 14);
    assert.equal(observations.every(([, code]) => code === "LIFECYCLE_EXTERNAL_NETWORK_BLOCKED"), true, JSON.stringify(observations));
    const events = fs.readFileSync(evidencePath, "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(events.filter(event => event.type === "network-intercepted").length, 14);
  });

  test("authoritative guard: child processes inherit preload and production runtime stays unchanged without env", async () => {
    const evidencePath = path.join(helpers.support.PROCESS_TEMP_PARENT, "child-network.jsonl");
    const guarded = runGuarded(String.raw`
      const { spawnSync } = require("child_process");
      const child = spawnSync(process.execPath, ["-e", "try { require('net').connect({host:'192.0.2.1',port:80}); console.log('NO_ERROR'); } catch (e) { console.log(e.code); }"], { encoding: "utf8", env: process.env });
      process.stdout.write(JSON.stringify({ status: child.status, stdout: child.stdout.trim(), nodeOptions: child.env }));
    `, evidencePath);
    assert.equal(guarded.status, 0, guarded.stderr);
    assert.equal(JSON.parse(guarded.stdout).stdout, "LIFECYCLE_EXTERNAL_NETWORK_BLOCKED");

    const unguarded = childProcess.spawnSync(process.execPath, ["-e", "process.stdout.write(String(Boolean(globalThis.__rentalLifecycleGuard)))"], {
      cwd: SKILL_DIR,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("LIFECYCLE_TEST_") && key !== "NODE_OPTIONS")),
    });
    assert.equal(unguarded.status, 0, unguarded.stderr);
    assert.equal(unguarded.stdout, "false");
  });

  test("authoritative guard: registered loopback fake services remain usable", async () => {
    const server = await helpers.startFakeGiteeServer({ routes: { "/data": { body: { ok: true } } } });
    try {
      const fetchResponse = await fetch(server.url + "/data");
      assert.deepEqual(await fetchResponse.json(), { ok: true });
      const nativeResponse = await new Promise((resolve, reject) => {
        const request = require("http").get(server.url + "/data", response => {
          let body = "";
          response.on("data", chunk => body += chunk);
          response.on("end", () => resolve(JSON.parse(body)));
        });
        request.on("error", reject);
      });
      assert.deepEqual(nativeResponse, { ok: true });
    } finally {
      await server.stop();
    }
  });

  test("authoritative mutation guard: registry mutations and future registry additions are counted", async () => {
    const instrumentation = require(path.join(SKILL_DIR, "scripts", "lib", "lifecycle-test-instrumentation.js"));
    const namedActions = ["image-upload", "vas-apply", "tenancy-set", "spec-add-item", "spec-remove-item", "spec-add-dim", "spec-remove-dim", "spec-refresh", "white-image-set"];
    const evidencePath = path.join(helpers.support.PROCESS_TEMP_PARENT, "mutation-instrumentation.jsonl");
    const script = `
      const support = require(${JSON.stringify(path.join(SKILL_DIR, "scripts", "lib", "lifecycle-test-support.js"))});
      const registry = require(${JSON.stringify(path.join(SKILL_DIR, "scripts", "lib", "action-registry.js"))});
      (async () => {
        const named = ${JSON.stringify(namedActions)};
        const counters = support.createCounters();
        const daemon = support.createFakeDaemon({ counters });
        for (const action of named) await daemon.invoke({ action });
        const all = registry.listActions().filter(entry => entry.classification === "mutation").map(entry => entry.action);
        const exhaustiveCounters = support.createCounters();
        const exhaustiveDaemon = support.createFakeDaemon({ counters: exhaustiveCounters });
        for (const action of all) await exhaustiveDaemon.invoke({ action });
        await exhaustiveDaemon.invoke({ action: "unknown-action" });
        process.stdout.write(JSON.stringify({ namedCount: counters.mutationInvocations, allCount: exhaustiveCounters.mutationInvocations, total: all.length }));
      })().catch(error => { console.error(error); process.exit(1); });
    `;
    const result = runGuarded(script, evidencePath);
    assert.equal(result.status, 0, result.stderr);
    const counts = JSON.parse(result.stdout);
    assert.equal(counts.namedCount, namedActions.length);
    assert.equal(counts.allCount, counts.total);

    const futureRegistry = { "future-mutation": { classification: "mutation", surfaces: ["daemon"] } };
    const future = instrumentation.classifyInvocation("future-mutation", futureRegistry);
    assert.equal(future.classification, "mutation");
    assert.equal(future.counted, true);
  });

  test("authoritative harness: misleading PASS output and hidden mutations cannot produce DoneClaim", async () => {
    const misleadingEvidence = path.join(helpers.support.PROCESS_TEMP_PARENT, "misleading.json");
    const misleading = childProcess.spawnSync(process.execPath, [RUNNER_PATH, "--offline", "--forbid-saas", "--case", "harness-misleading-success-probe", "--evidence", misleadingEvidence], {
      cwd: SKILL_DIR,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      env: guardedEnv(path.join(helpers.support.PROCESS_TEMP_PARENT, "misleading.jsonl"), { LIFECYCLE_PROBE_MISLEADING_SUCCESS: "1" }),
    });
    assert.notEqual(misleading.status, 0);
    assert.match(misleading.stderr, /\[PASS\] deliberately misleading fixture output/);
    assert.equal(JSON.parse(fs.readFileSync(misleadingEvidence, "utf8")).doneClaim, false);

    const mutationEvidence = path.join(helpers.support.PROCESS_TEMP_PARENT, "hidden-mutation.json");
    const mutation = childProcess.spawnSync(process.execPath, [RUNNER_PATH, "--offline", "--forbid-saas", "--case", "harness-global-mutation-probe", "--evidence", mutationEvidence], {
      cwd: SKILL_DIR,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      env: guardedEnv(path.join(helpers.support.PROCESS_TEMP_PARENT, "hidden-mutation.jsonl"), { LIFECYCLE_PROBE_MUTATION: "1" }),
    });
    assert.notEqual(mutation.status, 0, mutation.stdout + mutation.stderr);
    const evidence = JSON.parse(fs.readFileSync(mutationEvidence, "utf8"));
    assert.equal(evidence.mutationInvocations > 0, true);
    assert.equal(evidence.doneClaim, false);
  });

  test("authoritative harness: guard timeout fails closed and removes guard artifacts", async () => {
    const evidencePath = path.join(helpers.support.PROCESS_TEMP_PARENT, "guard-timeout.json");
    const eventPath = evidencePath + ".events.jsonl";
    const temporaryEvidencePath = evidencePath + ".tmp-stale";
    fs.writeFileSync(evidencePath, JSON.stringify({ doneClaim: true }), "utf8");
    fs.writeFileSync(eventPath, "stale-event\n", "utf8");
    fs.writeFileSync(temporaryEvidencePath, "stale-evidence\n", "utf8");

    const result = childProcess.spawnSync(process.execPath, [RUNNER_PATH, "--offline", "--forbid-saas", "--case", "harness-guard-timeout-probe", "--evidence", evidencePath], {
      cwd: SKILL_DIR,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
      env: outerGuardEnv({ LIFECYCLE_PROBE_GUARD_TIMEOUT: "1", LIFECYCLE_TEST_GUARD_TIMEOUT_MS: "1000" }),
    });

    assert.notEqual(result.status, null, result.error && result.error.message);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    const timeoutEvidence = JSON.parse(result.stdout);
    assert.equal(timeoutEvidence.doneClaim, false);
    assert.equal(timeoutEvidence.guardTimeoutMs, 1000);
    assert.equal(timeoutEvidence.error.code, "LIFECYCLE_GUARD_TIMEOUT");
    const probeRootMatch = result.stderr.match(/\[PROBE_ROOT\] (.+)/);
    assert.ok(probeRootMatch, result.stderr);
    await waitForRemoval(probeRootMatch[1].trim());
    assert.equal(fs.existsSync(probeRootMatch[1].trim()), false);
    assert.equal(fs.existsSync(evidencePath), false);
    assert.equal(fs.existsSync(eventPath), false);
    assert.equal(fs.existsSync(temporaryEvidencePath), false);
  });
}

module.exports = { register };
