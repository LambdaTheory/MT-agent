const assert = require("assert");
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const archiveValidator = require("./archive-validator");
const { ACTION_REGISTRY } = require("./action-registry");
const instrumentation = require("./lifecycle-test-instrumentation");

const TEMP_PARENT = path.join(os.tmpdir(), "rental-price-agent-lifecycle");
const PROCESS_TEMP_PARENT = path.join(TEMP_PARENT, String(process.pid));
const SAAS_URL_PATTERN = /(?:goods\.edit|\/web\/|\/merchant(?:\/|$)|\/admin(?:\/|$)|\b(?:login|submit|upload|delist)\b|vas[-_/]?(?:apply|update)|batch[-_/]?(?:apply|submit))/i;

let fixtureSequence = 0;
const liveFixtures = new Map();
const telemetry = { cleanupReceipts: [] };

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeName(name) {
  const value = String(name || "fixture").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return value || "fixture";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableJson(value[key]);
    return result;
  }, {});
}

function sha256Json(value) {
  return sha256(JSON.stringify(stableJson(value)));
}

async function sha256File(filePath) {
  return sha256(await fs.promises.readFile(filePath));
}

async function hashTree(root) {
  if (!fs.existsSync(root)) return null;
  const entries = [];
  async function walk(current, relative) {
    const children = await fs.promises.readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const childPath = path.join(current, child.name);
      const childRelative = path.posix.join(relative, child.name);
      if (child.isDirectory()) await walk(childPath, childRelative);
      else if (child.isFile()) entries.push([childRelative, await sha256File(childPath)]);
    }
  }
  await walk(root, "");
  return sha256Json(entries);
}

function createCounters(seed = {}) {
  return Object.assign({
    requests: 0,
    networkAttempts: 0,
    saasRequests: 0,
    mutationInvocations: 0,
    mutationAttempts: 0,
    handlerInvocations: 0,
    successfulHandlerInvocations: 0,
    actionAttempts: 0,
    interceptedNativeAttempts: 0,
    actualLoopbackRequests: 0,
    processStarts: 0,
    processStops: 0,
    browserLaunches: 0,
  }, seed);
}

function isLoopback(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
}

function createNetworkGuard(options = {}) {
  const counters = options.counters || createCounters();
  const offline = Boolean(options.offline);
  const forbidSaas = Boolean(options.forbidSaas);

  function assertAllowedUrl(input) {
    const url = input instanceof URL ? input : new URL(String(input));
    if (!/^https?:$/.test(url.protocol)) throw makeError("UNSUPPORTED_TEST_PROTOCOL", "Only HTTP(S) test requests are supported");
    if (forbidSaas && SAAS_URL_PATTERN.test(url.href)) {
      counters.saasRequests++;
      throw makeError("SAAS_REQUEST_FORBIDDEN", "SaaS-shaped request blocked: " + url.href);
    }
    if (offline && !isLoopback(url.hostname)) {
      throw makeError("OFFLINE_NON_LOOPBACK_BLOCKED", "Offline mode blocked non-loopback request: " + url.href);
    }
    return url;
  }

  function request(input, requestOptions = {}) {
    let url;
    try {
      url = assertAllowedUrl(input);
    } catch (error) {
      return Promise.reject(error);
    }
    counters.requests++;
    counters.networkAttempts++;
    return new Promise((resolve, reject) => {
      const request = http.request(url, { method: requestOptions.method || "GET", headers: requestOptions.headers || {} }, response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      request.on("error", reject);
      if (requestOptions.timeoutMs) request.setTimeout(requestOptions.timeoutMs, () => request.destroy(makeError("TEST_REQUEST_TIMEOUT", "Request timed out")));
      if (requestOptions.body !== undefined) request.write(Buffer.isBuffer(requestOptions.body) ? requestOptions.body : String(requestOptions.body));
      request.end();
    });
  }

  return { counters, assertAllowedUrl, request };
}

async function startFakeGiteeServer(options = {}) {
  const routes = options.routes || {};
  const counters = options.counters || createCounters();
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    counters.requests++;
    const route = routes[new URL(request.url, "http://127.0.0.1").pathname];
    if (route && route.hang) return;
    const status = route ? (route.status || 200) : 404;
    const body = route && route.body !== undefined ? route.body : { error: "not_found" };
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const defaultHeaders = { "content-type": "application/json" };
    if (!route || !route.chunked) defaultHeaders["content-length"] = payload.length;
    else defaultHeaders["transfer-encoding"] = "chunked";
    response.writeHead(status, Object.assign(defaultHeaders, route && route.headers));
    if (route && Number.isInteger(route.closeAfterBytes)) {
      response.flushHeaders();
      response.write(payload.subarray(0, route.closeAfterBytes));
      setImmediate(() => response.socket.destroy());
      return;
    }
    if (route && route.chunked) {
      const splitAt = Math.max(1, Math.min(payload.length - 1, Number(route.splitAt || Math.floor(payload.length / 2))));
      response.write(payload.subarray(0, splitAt));
      setImmediate(() => response.end(payload.subarray(splitAt)));
      return;
    }
    response.end(payload);
  });
  server.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  let stopped = false;
  return {
    url: "http://127.0.0.1:" + address.port,
    port: address.port,
    counters,
    async stop() {
      if (stopped) return { stopped: true, openSockets: 0 };
      stopped = true;
      const socketClosures = Array.from(sockets, socket => new Promise(resolve => {
        socket.once("close", resolve);
        socket.destroy();
      }));
      await Promise.all([
        new Promise(resolve => server.close(resolve)),
        Promise.all(socketClosures),
      ]);
      return { stopped: true, openSockets: sockets.size };
    },
  };
}

function startParentExitGuard(root) {
  const source = [
    "const fs = require('fs');",
    "const root = process.argv[1];",
    "const parentPid = Number(process.argv[2]);",
    "const deadline = Date.now() + 15000;",
    "const timer = setInterval(async () => {",
    "  if (!fs.existsSync(root)) { clearInterval(timer); return; }",
    "  let parentAlive = true;",
    "  try { process.kill(parentPid, 0); } catch (error) { parentAlive = false; }",
    "  if (!parentAlive) {",
    "    clearInterval(timer);",
    "    await fs.promises.rm(root, { recursive: true, force: true });",
    "    const processRoot = require('path').dirname(root);",
    "    const tempRoot = require('path').dirname(processRoot);",
    "    try { await fs.promises.rmdir(processRoot); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error; }",
    "    try { await fs.promises.rmdir(tempRoot); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error; }",
    "    return;",
    "  }",
    "  if (Date.now() >= deadline) clearInterval(timer);",
    "}, 50);",
  ].join("\n");
  const guard = childProcess.spawn(process.execPath, ["-e", source, root, String(process.pid)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  guard.unref();
}

function createFaultInjectingFs(options = {}) {
  const failures = options.failures || [];
  const crashPoints = new Set(options.crashPoints || []);
  const operations = Object.create(null);
  const api = {};
  for (const operation of ["mkdir", "writeFile", "readFile", "copyFile", "rename", "rm", "unlink", "stat", "readdir"]) {
    api[operation] = async (...args) => {
      operations[operation] = (operations[operation] || 0) + 1;
      const occurrence = operations[operation];
      if (crashPoints.has(operation) || crashPoints.has(operation + ":" + occurrence)) {
        throw makeError("EINJECTED_CRASH", "Injected crash at " + operation + ":" + occurrence);
      }
      const failure = failures.find(item => item.operation === operation && Number(item.at || 1) === occurrence);
      if (failure) throw makeError(failure.code || "EINJECTED", failure.message || "Injected " + operation + " failure");
      if (options.onOperation) await options.onOperation({ operation, occurrence, args });
      return fs.promises[operation](...args);
    };
  }
  api.operations = operations;
  api.crash = point => crashPoints.add(point);
  return api;
}

async function createLifecycleFixture(options = {}) {
  const sequence = ++fixtureSequence;
  const name = sanitizeName(options.name);
  const root = path.join(options.tempParent || PROCESS_TEMP_PARENT, name + "-" + String(sequence).padStart(3, "0"));
  await fs.promises.rm(root, { recursive: true, force: true });
  const paths = {
    active: path.join(root, "active"), staging: path.join(root, "staging"),
    previous: path.join(root, "previous"), data: path.join(root, "data"),
  };
  await Promise.all(Object.values(paths).map(directory => fs.promises.mkdir(directory, { recursive: true })));
  await Promise.all(Object.entries(paths).map(([key, directory]) => fs.promises.writeFile(path.join(directory, ".fixture-" + key), key, "utf8")));
  const beforeHash = await hashTree(root);
  let cleaned = false;
  const fixture = {
    name, root, paths, beforeHash,
    async cleanup(reason = "case-finally") {
      if (cleaned) return telemetry.cleanupReceipts.find(receipt => receipt.root === root);
      cleaned = true;
      const afterHash = await hashTree(root);
      await fs.promises.rm(root, { recursive: true, force: true });
      const receipt = { root, reason, beforeHash, afterHash, removed: true, existsAfterCleanup: fs.existsSync(root) };
      telemetry.cleanupReceipts.push(receipt);
      liveFixtures.delete(root);
      return receipt;
    },
  };
  liveFixtures.set(root, fixture);
  if (options.guardParentExit) startParentExitGuard(root);
  return fixture;
}

function createFakeProcessAdapter() {
  const counters = createCounters();
  const processes = new Map();
  let nextPid = 4100;
  return {
    counters,
    spawn(command = "fake-process") {
      const processRecord = { pid: ++nextPid, command, running: true };
      processes.set(processRecord.pid, processRecord);
      counters.processStarts++;
      return processRecord;
    },
    stop(pid) {
      const processRecord = processes.get(pid);
      if (!processRecord || !processRecord.running) return false;
      processRecord.running = false;
      counters.processStops++;
      return true;
    },
    isRunning(pid) { return Boolean(processes.get(pid) && processes.get(pid).running); },
    list() { return Array.from(processes.values()).map(item => Object.assign({}, item)); },
  };
}

function createFakeDaemon(options = {}) {
  const counters = options.counters || createCounters();
  const handlers = options.handlers || {};
  return {
    counters,
    async invoke(command) {
      const action = String(command && command.action || "");
      const attempt = instrumentation.recordActionAttempt(action, { counters, registry: ACTION_REGISTRY });
      if (!attempt.allowed) return { status: "error", code: "ACTION_NOT_CLASSIFIED", action };
      return instrumentation.invokeAction(action, () => handlers[action] ? handlers[action](command) : { status: "ok", action }, { counters, registry: ACTION_REGISTRY });
    },
  };
}

function createFakeBrowser(options = {}) {
  const counters = options.counters || createCounters();
  const guard = createNetworkGuard({ offline: options.offline !== false, forbidSaas: options.forbidSaas !== false, counters });
  return {
    counters,
    async launch(launchOptions = {}) {
      const url = String(launchOptions.url || "data:text/plain,lifecycle");
      if (!/^(?:data:|about:blank$)/.test(url)) guard.assertAllowedUrl(url);
      counters.browserLaunches++;
      let closed = false;
      return { url, async close() { closed = true; }, isClosed() { return closed; } };
    },
  };
}

function createSchemaFixture(kind, overrides = {}) {
  const versions = kind === "legacy" ? {} : kind === "future" ? { configSchemaVersion: 99, stateSchemaVersion: 99 } : { configSchemaVersion: 1, stateSchemaVersion: 1 };
  return {
    kind,
    config: Object.assign({ saas: { baseUrl: "http://127.0.0.1/fixture-only" }, browser: { mode: "fake" } }, versions.configSchemaVersion && { configSchemaVersion: versions.configSchemaVersion }, overrides.config),
    state: Object.assign({ tasks: [], status: "idle" }, versions.stateSchemaVersion && { stateSchemaVersion: versions.stateSchemaVersion }, overrides.state),
  };
}

function createReleaseFixture(options = {}) {
  const version = options.version || "1.0.0";
  const tag = options.tag || "v" + version;
  const owner = options.owner || "lcc0628";
  const repo = options.repo || "rental-price-agent";
  const archiveName = options.archiveName || "rental-price-agent-v" + version + ".tgz";
  const manifestName = options.manifestName || "rental-price-agent-v" + version + ".manifest.json";
  const checksumName = options.checksumName || "rental-price-agent-v" + version + ".sha256";
  const nodeRange = ">=18.0.0 <25.0.0";
  const playwrightVersion = "1.60.0";
  const packageJson = Object.assign({
    name: "rental-price-agent", version, engines: { node: nodeRange },
    dependencies: { playwright: playwrightVersion },
  }, options.packageJson);
  const releaseManifest = Object.assign({
    manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: tag,
    skillVersion: version, daemonVersion: version, protocolVersion: version,
    configSchemaVersion: "1.0.0", stateSchemaVersion: "1.0.0",
    nodeRange, playwrightVersion,
    browserPolicy: { supported: ["managed-chromium", "system-chrome"], default: "system-chrome", allowFallback: false },
    compatibility: {
      skill: { min: version, max: version }, daemon: { min: version, max: version },
      protocol: { min: version, max: version }, configSchema: { min: "1.0.0", max: "1.0.0" },
      stateSchema: { min: "1.0.0", max: "1.0.0" },
    },
    migration: {
      contractVersion: 2,
      definition: "scripts/lib/target-migration.json",
      sources: { configSchema: [{ min: "1.0.0", max: "1.0.0" }], stateSchema: [{ min: "1.0.0", max: "1.0.0" }] },
    },
  }, options.releaseManifest);
  const packageLock = {
    name: "rental-price-agent", version, lockfileVersion: 3, requires: true,
    packages: {
      "": { name: "rental-price-agent", version, dependencies: { playwright: playwrightVersion }, engines: { node: nodeRange } },
      "node_modules/playwright": { version: playwrightVersion },
    },
  };
  const defaultFiles = {
    "rental-price-agent/": { type: "5" },
    "rental-price-agent/SKILL.md": "# Fixture Skill\n",
    "rental-price-agent/config.example.json": JSON.stringify({ configSchemaVersion: "1.0.0", saas: {}, selectors: {}, vas: {}, rules: {}, taskStorage: {}, browser: { source: "chrome", allowFallback: false }, mirror: {} }) + "\n",
    "rental-price-agent/package.json": JSON.stringify(packageJson) + "\n",
    "rental-price-agent/package-lock.json": JSON.stringify(packageLock) + "\n",
    "rental-price-agent/release-manifest.json": JSON.stringify(releaseManifest) + "\n",
    "rental-price-agent/scripts/": { type: "5" },
    "rental-price-agent/scripts/lifecycle.js": "module.exports = {};\n",
    "rental-price-agent/scripts/lib/": { type: "5" },
    "rental-price-agent/scripts/lib/target-migration.json": JSON.stringify({
      contractVersion: 2,
      sources: releaseManifest.migration.sources,
      steps: [],
    }) + "\n",
  };
  const files = options.replaceFiles || Object.assign(defaultFiles, options.files);
  const archive = createTarGz(files, options.archiveOptions);
  const archiveHash = sha256(archive);
  const fileRecords = Object.entries(files).flatMap(([name, value]) => {
    const descriptor = value && typeof value === "object" && !Buffer.isBuffer(value) && Object.prototype.hasOwnProperty.call(value, "type") ? value : { content: value };
    if ((descriptor.type || "0") === "5" || !name.startsWith("rental-price-agent/")) return [];
    const relativePath = name.slice("rental-price-agent/".length);
    try {
      if (archiveValidator.normalizeArchivePath(name) !== name.normalize("NFC")) return [];
    } catch { return []; }
    const body = Buffer.isBuffer(descriptor.content) ? descriptor.content : Buffer.from(String(descriptor.content || ""));
    return [{ path: relativePath, bytes: body.length, sha256: sha256(body), mode: descriptor.mode || 0o644, type: "file" }];
  });
  const lockRecord = fileRecords.find(record => record.path === "package-lock.json");
  const manifest = options.manifest || {
    generationFormatVersion: 1,
    schemaVersion: 2,
    name: "rental-price-agent",
    version,
    tag,
    repository: { provider: "gitee", owner, repo, tag },
    versions: { skill: version, daemon: version, protocol: version, configSchema: "1.0.0", stateSchema: "1.0.0" },
    package: {
      files: fileRecords,
      lockSha256: lockRecord ? lockRecord.sha256 : "0".repeat(64),
      treeSha256: fileRecords.length ? archiveValidator.computeManifestTreeHash(fileRecords) : "0".repeat(64),
    },
    assets: [{ name: archiveName, bytes: archive.length, sha256: archiveHash }],
  };
  if (manifest.assets && manifest.assets[0] && manifest.asset === undefined) {
    Object.defineProperty(manifest, "asset", { value: manifest.assets[0], enumerable: false });
  }
  return {
    archive,
    archiveName,
    manifestName,
    checksumName,
    files,
    manifest,
    manifestBody: Buffer.from(JSON.stringify(manifest)),
    checksumBody: Buffer.from(archiveHash + "  " + archiveName + "\n"),
  };
}

function writeTarString(block, offset, length, value) {
  Buffer.from(String(value), "utf8").copy(block, offset, 0, length);
}

function writeTarOctal(block, offset, length, value) {
  const text = Math.max(0, Number(value)).toString(8).padStart(length - 1, "0") + "\0";
  writeTarString(block, offset, length, text);
}

function createTarEntry(name, content, options = {}) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ""));
  const header = Buffer.alloc(512, 0);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, options.mode || (options.type === "5" ? 0o755 : 0o644));
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, options.type && options.type !== "0" ? 0 : body.length);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = Buffer.from(options.type || "0")[0];
  if (options.linkName) writeTarString(header, 157, 100, options.linkName);
  writeTarString(header, 257, 6, "ustar\0");
  writeTarString(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarOctal(header, 148, 8, checksum);
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512, 0);
  return Buffer.concat([header, options.type && options.type !== "0" ? Buffer.alloc(0) : body, padding]);
}

function createTarGz(files, options = {}) {
  const entries = [];
  for (const [name, value] of Object.entries(files || {})) {
    const descriptor = value && typeof value === "object" && !Buffer.isBuffer(value) && Object.prototype.hasOwnProperty.call(value, "type")
      ? value
      : { content: value };
    entries.push(createTarEntry(name, descriptor.content, descriptor));
  }
  for (const entry of options.extraEntries || []) entries.push(createTarEntry(entry.name, entry.content, entry));
  entries.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(entries), { level: 9, mtime: 0 });
}

async function cleanupAllFixtures(reason = "runner-finally") {
  const receipts = await Promise.all(Array.from(liveFixtures.values()).map(fixture => fixture.cleanup(reason)));
  await fs.promises.rm(PROCESS_TEMP_PARENT, { recursive: true, force: true });
  try {
    await fs.promises.rmdir(TEMP_PARENT);
  } catch (error) {
    if (!error || !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
  }
  return receipts;
}

function resetHarnessState() {
  fixtureSequence = 0;
  liveFixtures.clear();
  telemetry.cleanupReceipts.length = 0;
}

function getHarnessTelemetry() {
  const cleanupReceipts = telemetry.cleanupReceipts
    .map(receipt => Object.assign({}, receipt))
    .sort((left, right) => left.root.localeCompare(right.root));
  return { tempParent: PROCESS_TEMP_PARENT, cleanupReceipts };
}

module.exports = {
  PROCESS_TEMP_PARENT,
  TEMP_PARENT,
  assert,
  cleanupAllFixtures,
  createCounters,
  createFakeBrowser,
  createFakeDaemon,
  createFakeProcessAdapter,
  createFaultInjectingFs,
  createLifecycleFixture,
  createNetworkGuard,
  createReleaseFixture,
  createTarGz,
  createSchemaFixture,
  getHarnessTelemetry,
  hashTree,
  isLoopback,
  makeError,
  resetHarnessState,
  sha256,
  sha256File,
  sha256Json,
  stableJson,
  startFakeGiteeServer,
};
