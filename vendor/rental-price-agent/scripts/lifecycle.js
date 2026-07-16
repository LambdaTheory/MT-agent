#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { getInstallLayout } = require("./lib/install-layout");
const { probeBrowserPolicy } = require("./lib/browser-probe");
const { checkSchemaCompatibility, validateBatch, validateConfig, validateRecovery, validateTask, validateTaskIndex } = require("./lib/migrations");
const { hashReleaseTree, readInstallReceipt, sha256File } = require("./lib/install-receipt");
const { INSTALL_PHASES, runInstall: executeInstall } = require("./lib/lifecycle-install");
const { ROLLBACK_PHASES, runRollback: executeRollback } = require("./lib/lifecycle-rollback");
const { JOURNAL_SCHEMA_VERSION, UPGRADE_PHASES, runUpgrade: executeUpgrade } = require("./lib/lifecycle-upgrade");
const { loadContractFiles, validateVersionContract } = require("./lib/version-contract");
const { readDaemonIdentity, validateDaemonIdentity } = require("./lib/daemon-identity");
const { readRestartMarker } = require("./lib/restart-session");
const { evaluateLiveStateReadiness } = require("./lib/live-state-readiness");

function diagnosticError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function readJson(filePath, code) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw diagnosticError(code, path.basename(filePath) + " is not valid JSON", { cause: error.message });
  }
}

function safeFileState(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return { present: true, type: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "other" };
  } catch (error) {
    if (error.code === "ENOENT") return { present: false, type: null };
    return { present: false, type: null, error: error.code || "STAT_FAILED" };
  }
}

function collectStatus(options = {}) {
  const targetDir = path.resolve(String(options.targetDir || ""));
  if (!options.targetDir || !path.isAbsolute(options.targetDir)) throw diagnosticError("INVALID_INSTALL_TARGET", "--target must be an absolute path");
  const layout = getInstallLayout(targetDir);
  const target = safeFileState(layout.targetDir);
  const data = safeFileState(layout.dataRoot);
  let manifest = null;
  let receipt = null;
  let receiptError = null;
  let configSchemaVersion = null;
  let stateSchemaVersions = [];
  if (target.present && target.type === "directory") {
    try { manifest = readJson(path.join(targetDir, "release-manifest.json"), "RELEASE_MANIFEST_MALFORMED"); } catch {}
  }
  if (data.present && data.type === "directory") {
    try { receipt = readInstallReceipt({ targetDir }); } catch (error) { receiptError = { code: error.code || "INSTALL_RECEIPT_MALFORMED", message: error.message }; }
    if (fs.existsSync(layout.configPath)) {
      try { configSchemaVersion = readJson(layout.configPath, "CONFIG_MALFORMED").configSchemaVersion || null; } catch {}
    }
    stateSchemaVersions = collectStateDocuments(layout).map(item => item.version).filter(Boolean);
  }
  const versions = receipt ? receipt.versions : manifest ? {
    skill: manifest.skillVersion || null,
    daemon: manifest.daemonVersion || null,
    protocol: manifest.protocolVersion || null,
    configSchema: manifest.configSchemaVersion || null,
    stateSchema: manifest.stateSchemaVersion || null,
  } : { skill: null, daemon: null, protocol: null, configSchema: null, stateSchema: null };
  return {
    command: "status",
    target: { path: layout.targetDir, ...target },
    dataRoot: { path: layout.dataRoot, ...data },
    receipt: { path: layout.receiptPath, present: Boolean(receipt), schemaVersion: receipt && receipt.receiptSchemaVersion, error: receiptError },
    versions,
    source: receipt ? receipt.source : null,
    dependencyLockSha256: receipt ? receipt.dependencyLockSha256 : null,
    browser: receipt ? receipt.browser : null,
    releaseTreeSha256: receipt ? receipt.releaseTreeSha256 : null,
    current: { configSchemaVersion, stateSchemaVersions: [...new Set(stateSchemaVersions)].sort() },
    daemonIdentity: daemonIdentityStatus(layout),
    restartRequired: readRestartRequired(layout).required,
  };
}

function check(code, status, message, details, blocks = []) {
  const value = { code, status, message, blocks };
  if (details !== undefined) value.details = details;
  return value;
}

function failCheck(code, message, details, blocks = ["reads", "writes"]) {
  return check(code, "fail", message, details, blocks);
}

function passCheck(code, message, details) {
  return check(code, "pass", message, details, []);
}

function warnCheck(code, message, details) {
  return check(code, "warn", message, details, []);
}

function configured(value) {
  return typeof value === "string" && value.trim() !== "" && !value.includes("<");
}

function incompleteConfigFields(config) {
  const fields = [
    ["saas.baseUrl", config && config.saas && config.saas.baseUrl],
    ["saas.loginUrl", config && config.saas && config.saas.loginUrl],
    ["saas.productDetailUrl", config && config.saas && config.saas.productDetailUrl],
    ["saas.credentials.username", config && config.saas && config.saas.credentials && config.saas.credentials.username],
    ["saas.credentials.password", config && config.saas && config.saas.credentials && config.saas.credentials.password],
    ["mirror.baseUrl", config && config.mirror && config.mirror.baseUrl],
    ["mirror.apiKey", config && config.mirror && config.mirror.apiKey],
  ];
  return fields.filter(([, value]) => !configured(value)).map(([field]) => field).sort();
}

function collectStateDocuments(layout, fileSystem = fs) {
  const documents = [];
  function lstat(entryPath) {
    try { return fileSystem.lstatSync(entryPath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  function addDocument(entryPath, kind) {
    let stat;
    try { stat = lstat(entryPath); } catch (error) {
      documents.push({ path: entryPath, kind, error: "STATE_DOCUMENT_UNREADABLE", causeCode: error.code || null });
      return;
    }
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      documents.push({ path: entryPath, kind, error: "STATE_DOCUMENT_UNSAFE" });
      return;
    }
    let text;
    try { text = fileSystem.readFileSync(entryPath, "utf8"); } catch (error) {
      documents.push({ path: entryPath, kind, error: "STATE_DOCUMENT_UNREADABLE", causeCode: error.code || null });
      return;
    }
    try {
      const value = JSON.parse(text);
      documents.push({ path: entryPath, kind, value, version: value && value.stateSchemaVersion });
    } catch {
      documents.push({ path: entryPath, kind, error: "STATE_DOCUMENT_MALFORMED" });
    }
  }
  const tasksStat = lstat(layout.tasksDir);
  if (!tasksStat) return documents;
  if (tasksStat.isSymbolicLink() || !tasksStat.isDirectory()) throw diagnosticError("STATE_STORAGE_UNSAFE", "Persisted task storage is not a regular directory");
  for (const entry of fileSystem.readdirSync(layout.tasksDir, { withFileTypes: true })) {
    if (entry.name === "_index.json") addDocument(path.join(layout.tasksDir, entry.name), "task-index");
    else if (entry.name.endsWith(".json") && entry.name.startsWith("changes_")) addDocument(path.join(layout.tasksDir, entry.name), "recovery");
    else if (entry.name.endsWith(".json")) addDocument(path.join(layout.tasksDir, entry.name), "task");
    else if (entry.name === "batches") {
      const batchesStat = lstat(layout.batchesDir);
      if (!batchesStat || batchesStat.isSymbolicLink() || !batchesStat.isDirectory()) throw diagnosticError("STATE_STORAGE_UNSAFE", "Persisted batch storage is not a regular directory");
      for (const batchEntry of fileSystem.readdirSync(layout.batchesDir, { withFileTypes: true })) {
        if (batchEntry.name.endsWith(".json")) addDocument(path.join(layout.batchesDir, batchEntry.name), batchEntry.name.startsWith("changes_") ? "recovery" : "batch");
      }
    }
  }
  return documents;
}

function validateStateDocument(document) {
  if (document.kind === "recovery") {
    validateRecovery(document.value);
    return { status: "current" };
  }
  if (document.version === undefined) throw diagnosticError("STATE_SCHEMA_MISSING", "Persisted state is missing stateSchemaVersion");
  const compatibility = checkSchemaCompatibility("state", document.version);
  if (compatibility.status !== "current") return compatibility;
  if (document.kind === "task-index") validateTaskIndex(document.value);
  else if (document.kind === "batch") validateBatch(document.value);
  else validateTask(document.value);
  return compatibility;
}

function findMigrationArtifacts(dataRoot) {
  if (!fs.existsSync(dataRoot)) return [];
  const found = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.name === ".legacy-import-artifacts.json" || entry.name.startsWith(".legacy-import-operation-")
          || entry.name.endsWith(".migration.lock") || /\.migration-[^.]+\.tmp$/.test(entry.name) || /\.backup-[^.]+\.tmp$/.test(entry.name)) found.push(entryPath);
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(entryPath);
    }
  }
  visit(dataRoot);
  return found.sort();
}

function readRestartRequired(layout) {
  return readRestartMarker(layout);
}

function daemonIdentityStatus(layout) {
  const read = readDaemonIdentity(layout);
  if (!read.present) return { state: "absent", present: [] };
  if (read.error) return { state: read.error === "DAEMON_IDENTITY_MALFORMED" ? "malformed" : "unsafe", present: [path.basename(layout.daemonIdentityPath)], error: read.error };
  return { state: "present", present: [path.basename(layout.daemonIdentityPath)], instanceId: read.identity.instanceId, versions: read.identity.versions };
}

async function runDoctor(options = {}) {
  const targetDir = path.resolve(String(options.targetDir || ""));
  if (!options.targetDir || !path.isAbsolute(options.targetDir)) throw diagnosticError("INVALID_INSTALL_TARGET", "--target must be an absolute path");
  const layout = getInstallLayout(targetDir);
  const checks = [];
  let manifest = null;
  let receipt = null;
  let config = null;
  let persistedState = null;

  const targetState = safeFileState(layout.targetDir);
  if (!targetState.present || targetState.type !== "directory") checks.push(failCheck("INSTALL_TARGET_MISSING", "Installation target is missing or not a directory"));
  else checks.push(passCheck("INSTALL_TARGET_OK", "Installation target is present", { path: layout.targetDir }));

  const dataState = safeFileState(layout.dataRoot);
  if (!dataState.present || dataState.type !== "directory") checks.push(failCheck("INSTALL_DATA_ROOT_MISSING", "Installation data root is missing or not a directory"));
  else checks.push(passCheck("INSTALL_DATA_ROOT_OK", "Installation data root is present", { path: layout.dataRoot }));

  if (targetState.present && targetState.type === "directory") {
    try {
      const files = loadContractFiles({ skillDir: targetDir });
      manifest = validateVersionContract({ ...files, nodeVersion: options.nodeVersion || process.versions.node });
      checks.push(passCheck("RELEASE_CONTRACT_OK", "Release manifest, package, lockfile, Node, and Playwright pin are consistent", {
        skillVersion: manifest.skillVersion,
        nodeRange: manifest.nodeRange,
        playwrightVersion: manifest.playwrightVersion,
      }));
    } catch (error) {
      checks.push(failCheck(error.code || "RELEASE_CONTRACT_INVALID", "Release contract validation failed", { causeCode: error.code || null }));
    }
  }

  if (dataState.present && dataState.type === "directory") {
    try {
      receipt = readInstallReceipt({ targetDir, fileSystem: options.receiptFileSystem });
      if (!receipt) checks.push(failCheck("INSTALL_RECEIPT_MISSING", "Install receipt is missing"));
      else checks.push(passCheck("INSTALL_RECEIPT_OK", "Install receipt is valid", { receiptSchemaVersion: receipt.receiptSchemaVersion, installedAt: receipt.installedAt }));
    } catch (error) {
      checks.push(failCheck(error.code || "INSTALL_RECEIPT_MALFORMED", "Install receipt validation failed", { causeCode: error.code || null }));
    }
  }

  if (manifest && receipt) {
    const expectedVersions = {
      skill: manifest.skillVersion,
      daemon: manifest.daemonVersion,
      protocol: manifest.protocolVersion,
      configSchema: manifest.configSchemaVersion,
      stateSchema: manifest.stateSchemaVersion,
    };
    const sourceTagMatches = receipt.source.tag === manifest.releaseTag;
    if (JSON.stringify(receipt.versions) !== JSON.stringify(expectedVersions) || !sourceTagMatches) {
      checks.push(failCheck("INSTALL_RECEIPT_RELEASE_MISMATCH", "Receipt versions or source tag do not match the active release"));
    } else checks.push(passCheck("INSTALL_RECEIPT_RELEASE_OK", "Receipt versions and source tag match the active release"));
  }

  if (targetState.present && receipt) {
    try {
      const actual = hashReleaseTree(targetDir);
      if (actual !== receipt.releaseTreeSha256) checks.push(failCheck("RELEASE_TREE_DRIFT", "Release-owned files differ from the install receipt", { expected: receipt.releaseTreeSha256, actual }));
      else checks.push(passCheck("RELEASE_TREE_OK", "Release-owned tree matches the install receipt", { sha256: actual }));
    } catch (error) {
      checks.push(failCheck(error.code || "RELEASE_TREE_INVALID", "Release tree could not be validated", { causeCode: error.code || null }));
    }
  }

  if (targetState.present && receipt) {
    try {
      const actualLockHash = sha256File(path.join(targetDir, "package-lock.json"));
      if (actualLockHash !== receipt.dependencyLockSha256) checks.push(failCheck("DEPENDENCY_LOCK_DRIFT", "package-lock.json differs from the install receipt", { expected: receipt.dependencyLockSha256, actual: actualLockHash }));
      else checks.push(passCheck("DEPENDENCY_LOCK_OK", "Dependency lock matches the install receipt", { sha256: actualLockHash }));
    } catch (error) {
      checks.push(failCheck("DEPENDENCY_LOCK_MISSING", "package-lock.json is missing or unreadable"));
    }
  }

  if (manifest && targetState.present) {
    const installedPackagePath = path.join(targetDir, "node_modules", "playwright", "package.json");
    try {
      const installed = readJson(installedPackagePath, "PLAYWRIGHT_INSTALL_MALFORMED");
      if (installed.version !== manifest.playwrightVersion) checks.push(failCheck("PLAYWRIGHT_INSTALL_DRIFT", "Installed Playwright does not match the release contract", { expected: manifest.playwrightVersion, actual: installed.version || null }));
      else checks.push(passCheck("PLAYWRIGHT_INSTALL_OK", "Installed Playwright matches the release contract", { version: installed.version }));
    } catch (error) {
      checks.push(failCheck("PLAYWRIGHT_INSTALL_MISSING", "Installed Playwright package is missing or malformed"));
    }
  }

  if (dataState.present && dataState.type === "directory") {
    if (!fs.existsSync(layout.configPath)) checks.push(failCheck("CONFIG_MISSING", "config.json is missing", { fields: ["config.json"] }));
    else {
      try {
        config = readJson(layout.configPath, "CONFIG_MALFORMED");
        const compatibility = checkSchemaCompatibility("config", config.configSchemaVersion);
        if (compatibility.status !== "current") checks.push(failCheck("CONFIG_SCHEMA_MIGRATION_REQUIRED", "Config schema requires migration", compatibility));
        else {
          validateConfig(config);
          checks.push(passCheck("CONFIG_SCHEMA_CURRENT", "Config schema is current", { version: compatibility.sourceVersion }));
        }
        const missing = incompleteConfigFields(config);
        if (missing.length) checks.push(failCheck("CONFIG_INCOMPLETE", "Config is incomplete", { fields: missing }, ["writes"]));
        else checks.push(passCheck("CONFIG_COMPLETE", "Required config fields are present", { fieldsChecked: 7 }));
      } catch (error) {
        const code = error.code === "FUTURE_SCHEMA_VERSION" ? "CONFIG_SCHEMA_FUTURE" : error.code || "CONFIG_MALFORMED";
        checks.push(failCheck(code, "Config validation failed", { causeCode: error.code || null }));
      }
    }

    let documents = [];
    let stateFailed = false;
    try {
      documents = collectStateDocuments(layout, options.stateFileSystem || fs);
    } catch (error) {
      stateFailed = true;
      checks.push(failCheck(error.code || "STATE_STORAGE_UNREADABLE", "Persisted state storage could not be enumerated", { causeCode: error.code || null }));
    }
    for (const document of documents) {
      if (document.error) {
        stateFailed = true;
        checks.push(failCheck(document.error, "Persisted state document could not be validated", { file: path.relative(layout.dataRoot, document.path), causeCode: document.causeCode || null }));
        continue;
      }
      try {
        const compatibility = validateStateDocument(document);
        if (compatibility.status !== "current") {
          stateFailed = true;
          checks.push(failCheck("STATE_SCHEMA_MIGRATION_REQUIRED", "Persisted state requires migration", { file: path.relative(layout.dataRoot, document.path), ...compatibility }));
        }
      } catch (error) {
        stateFailed = true;
        const code = error.code === "FUTURE_SCHEMA_VERSION" ? "STATE_SCHEMA_FUTURE"
          : error.code === "STATE_SCHEMA_MISSING" ? error.code
            : "STATE_DOCUMENT_INVALID";
        checks.push(failCheck(code, "Persisted state validation failed", { file: path.relative(layout.dataRoot, document.path), causeCode: error.code || null }));
      }
    }
    if (!stateFailed) checks.push(passCheck("STATE_SCHEMAS_CURRENT", "Persisted state schemas are compatible", { documents: documents.length }));

    const migrationArtifacts = findMigrationArtifacts(layout.dataRoot);
    if (migrationArtifacts.length) checks.push(failCheck("MIGRATION_INTERRUPTED", "Migration lock or temporary artifacts are present", { paths: migrationArtifacts.map(item => path.relative(layout.dataRoot, item)) }));
    else checks.push(passCheck("MIGRATION_STATE_CLEAN", "No interrupted migration artifacts are present"));

    if (fs.existsSync(layout.journalPath)) {
      try {
        const journal = readJson(layout.journalPath, "LIFECYCLE_JOURNAL_MALFORMED");
        if (!["complete", "completed", "committed"].includes(journal.status)) checks.push(failCheck("LIFECYCLE_JOURNAL_INTERRUPTED", "Lifecycle journal records an incomplete operation", { status: journal.status || null }));
        else checks.push(passCheck("LIFECYCLE_JOURNAL_CLEAN", "Lifecycle journal is complete", { status: journal.status }));
      } catch (error) {
        checks.push(failCheck(error.code || "LIFECYCLE_JOURNAL_MALFORMED", "Lifecycle journal is malformed"));
      }
    } else checks.push(passCheck("LIFECYCLE_JOURNAL_ABSENT", "No lifecycle operation journal is present"));
    if (fs.existsSync(layout.lockPath)) checks.push(failCheck("LIFECYCLE_LOCK_PRESENT", "Lifecycle lock is present", undefined, ["writes"]));
    else checks.push(passCheck("LIFECYCLE_LOCK_ABSENT", "No lifecycle lock is present"));
  }

  if (config && config.browser) {
    const probe = options.probeBrowserPolicy || probeBrowserPolicy;
    let browserResult;
    try {
      browserResult = await probe(config.browser, { browserCacheDir: layout.browserCacheDir, ...(options.probeOptions || {}) });
    } catch (error) {
      browserResult = { ok: false, error: { code: error.code || "BROWSER_PROBE_FAILED", message: error.message } };
    }
    if (!browserResult.ok) checks.push(failCheck(browserResult.error.code || "BROWSER_PROBE_FAILED", "Configured browser probe failed", { causeCode: browserResult.error.code || null }));
    else if (receipt && browserResult.selectedSource !== receipt.browser.selectedSource) checks.push(failCheck("BROWSER_SOURCE_DRIFT", "Probed browser source differs from the install receipt", { expected: receipt.browser.selectedSource, actual: browserResult.selectedSource }));
    else {
      checks.push(passCheck("BROWSER_READY", "Configured browser is ready", { selectedSource: browserResult.selectedSource, version: browserResult.version }));
      if (receipt && browserResult.version !== receipt.browser.version) checks.push(warnCheck("BROWSER_VERSION_CHANGED", "Browser version changed since installation", { installed: receipt.browser.version, current: browserResult.version }));
    }
  }

  if (manifest && dataState.present && dataState.type === "directory") {
    persistedState = evaluateLiveStateReadiness(layout, manifest, { fileSystem: options.stateFileSystem || fs });
    const existingCodes = new Set(checks.map(item => item.code));
    for (const blocker of persistedState.blockers) {
      if (!existingCodes.has(blocker)) checks.push(failCheck(blocker, "Live persisted state is not ready for mutations", undefined, ["writes"]));
    }
    if (persistedState.readyForWrites) checks.push(passCheck("LIVE_PERSISTED_STATE_READY", "Live persisted config and state are ready", {
      stateDigest: persistedState.stateDigest,
      actualSchemaVersions: persistedState.actualSchemaVersions,
    }));
  }

  const daemon = daemonIdentityStatus(layout);
  if (daemon.state === "absent") checks.push(warnCheck("DAEMON_IDENTITY_ABSENT", "Daemon identity files are absent", { state: daemon.state }));
  else if (daemon.state === "malformed") checks.push(failCheck("DAEMON_IDENTITY_MALFORMED", "Daemon identity is malformed", undefined, ["writes"]));
  else if (daemon.state === "unsafe") checks.push(failCheck(daemon.error || "DAEMON_IDENTITY_UNSAFE_PATH", "Daemon identity path is unsafe", undefined, ["writes"]));
  else {
    const validated = await validateDaemonIdentity({ layout, targetDir, processInspector: options.processInspector, requestHello: options.requestHello });
    if (validated.valid) checks.push(passCheck("DAEMON_IDENTITY_VALID", "Daemon identity and authenticated hello are valid", { instanceId: daemon.instanceId }));
    else checks.push(failCheck(validated.code, "Daemon identity could not be validated", undefined, ["writes"]));
  }

  const restart = readRestartRequired(layout);
  if (restart.error) checks.push(failCheck(restart.error, "Restart-required marker is malformed or unsafe", undefined, ["writes"]));
  else if (restart.required) checks.push(failCheck("RESTART_REQUIRED", "OpenCode must be restarted by the user before mutations; automatic restart is not attempted", restart.value ? { activationId: restart.value.activationId, activatingReleaseTreeSha256: restart.value.activatingReleaseTreeSha256, reason: restart.value.reason } : undefined, ["writes"]));
  else checks.push(passCheck("RESTART_NOT_REQUIRED", "No OpenCode restart marker is active"));

  const blockers = [...new Set(checks.filter(item => item.status === "fail").map(item => item.code))].sort();
  const warnings = [...new Set(checks.filter(item => item.status === "warn").map(item => item.code))].sort();
  const readBlockers = [...new Set(checks.filter(item => item.status === "fail" && item.blocks.includes("reads")).map(item => item.code))].sort();
  const writeBlockers = [...new Set(checks.filter(item => item.status === "fail" && item.blocks.includes("writes")).map(item => item.code))].sort();
  return {
    command: "doctor",
    targetDir: layout.targetDir,
    dataRoot: layout.dataRoot,
    readyForReads: readBlockers.length === 0,
    readyForWrites: writeBlockers.length === 0,
    blockers,
    warnings,
    checks,
    versions: manifest ? {
      skill: manifest.skillVersion,
      daemon: manifest.daemonVersion,
      protocol: manifest.protocolVersion,
      configSchema: manifest.configSchemaVersion,
      stateSchema: manifest.stateSchemaVersion,
      node: process.versions.node,
      playwright: manifest.playwrightVersion,
    } : null,
    restartRequired: restart.required,
    persistedState,
  };
}

function usage() {
  return [
    "Usage: node scripts/lifecycle.js <status|doctor> --target <absolute-path> [--json]",
    "       node scripts/lifecycle.js install --target <absolute-path> --repo lcc0628/rental-price-agent --tag <vSemver> --browser <chrome|chromium> [--json]",
    "       node scripts/lifecycle.js upgrade --target <absolute-path> --repo lcc0628/rental-price-agent --tag <newer-vSemver> --browser <chrome|chromium> [--json]",
    "       node scripts/lifecycle.js rollback --target <absolute-path> [--dry-run | --confirm <previousVersion@sha256>] [--json]",
    "  install  Install one immutable release into an explicit missing or recognized legacy target",
    "  upgrade  Stop the validated daemon and journal an atomic same-volume release activation",
    "  rollback Validate by default, then restore only the one retained compatible previous release after exact confirmation",
    "  status   Report installation presence and current metadata without mutation",
    "  doctor   Validate read/write readiness and exit nonzero on every failed check",
  ].join("\n");
}

function parseArgs(argv) {
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") return { help: true };
  const command = argv[0];
  let targetDir;
  let repo;
  let tag;
  let browserSource;
  let dryRun = false;
  let confirm;
  let json = false;
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--target") targetDir = argv[++index];
    else if (argument.startsWith("--target=")) targetDir = argument.slice("--target=".length);
    else if (argument === "--repo") repo = argv[++index];
    else if (argument.startsWith("--repo=")) repo = argument.slice("--repo=".length);
    else if (argument === "--tag") tag = argv[++index];
    else if (argument.startsWith("--tag=")) tag = argument.slice("--tag=".length);
    else if (argument === "--browser") browserSource = argv[++index];
    else if (argument.startsWith("--browser=")) browserSource = argument.slice("--browser=".length);
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--confirm") {
      confirm = argv[++index];
      if (!confirm || confirm.startsWith("--")) throw diagnosticError("ROLLBACK_CONFIRMATION_MISMATCH", "--confirm requires the exact preview token");
    }
    else if (argument.startsWith("--confirm=")) confirm = argument.slice("--confirm=".length);
    else if (argument === "--json") json = true;
      else if (argument === "--help" || argument === "-h") return { help: true };
    else throw diagnosticError("INVALID_ARGUMENT", "Unknown argument: " + argument);
  }
  if (!targetDir || !path.isAbsolute(targetDir)) throw diagnosticError("INVALID_INSTALL_TARGET", "--target must be an absolute path");
  if (!["status", "doctor", "install", "upgrade", "rollback"].includes(command)) throw diagnosticError("INVALID_ARGUMENT", "Command must be status, doctor, install, upgrade, or rollback");
  if (command === "install" || command === "upgrade") {
    if (repo !== "lcc0628/rental-price-agent") throw diagnosticError("INVALID_RELEASE_REPOSITORY", "--repo must be exactly lcc0628/rental-price-agent");
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(String(tag || ""))) throw diagnosticError("INVALID_RELEASE_TAG", "--tag must be an immutable v<semver> release tag");
    if (!["chrome", "chromium"].includes(browserSource)) throw diagnosticError("INVALID_BROWSER_SOURCE", "--browser must be chrome or chromium");
    if (dryRun || confirm !== undefined) throw diagnosticError("INVALID_ARGUMENT", "Rollback arguments are valid only for rollback");
  } else if (command === "rollback") {
    if (repo !== undefined || tag !== undefined || browserSource !== undefined) throw diagnosticError("INVALID_ARGUMENT", "Release download arguments are not valid for rollback");
    if (dryRun && confirm !== undefined) throw diagnosticError("INVALID_ARGUMENT", "--dry-run and --confirm cannot be combined");
    if (confirm !== undefined && (!confirm || confirm.startsWith("--"))) throw diagnosticError("ROLLBACK_CONFIRMATION_MISMATCH", "--confirm requires the exact preview token");
  } else if (repo !== undefined || tag !== undefined || browserSource !== undefined || dryRun || confirm !== undefined) {
    throw diagnosticError("INVALID_ARGUMENT", "Release arguments are valid only for install or upgrade");
  }
  return { command, targetDir, repo, tag, browserSource, dryRun, confirm, json };
}

async function runInstall(options = {}) {
  return executeInstall({ ...options, runDoctor });
}

async function runUpgrade(options = {}) {
  return executeUpgrade({ ...options, runDoctor: options.runDoctor || runDoctor });
}

async function runRollback(options = {}) {
  return executeRollback({ ...options, runDoctor: options.runDoctor || runDoctor });
}

async function runLifecycleCli(argv = process.argv.slice(2), runtime = {}) {
  const writeStdout = runtime.writeStdout || (value => process.stdout.write(value));
  const writeStderr = runtime.writeStderr || (value => process.stderr.write(value));
  try {
    const args = parseArgs(argv);
    if (args.help) {
      writeStdout(usage() + "\n");
      return { exitCode: 0, result: null };
    }
    const result = args.command === "status"
      ? collectStatus({ targetDir: args.targetDir })
      : args.command === "doctor"
        ? await runDoctor({ targetDir: args.targetDir, probeBrowserPolicy: runtime.probeBrowserPolicy, probeOptions: runtime.probeOptions, nodeVersion: runtime.nodeVersion })
        : args.command === "install" ? await runInstall({
          targetDir: args.targetDir, repo: args.repo, tag: args.tag, browserSource: args.browserSource,
          releaseBaseUrl: runtime.releaseBaseUrl, platform: runtime.platform,
          volumeResolver: runtime.volumeResolver, timeoutMs: runtime.timeoutMs,
          maxBytes: runtime.maxBytes, maxExpandedBytes: runtime.maxExpandedBytes,
          maxRedirects: runtime.maxRedirects, run: runtime.run,
          probeBrowserPolicy: runtime.probeBrowserPolicy, probeOptions: runtime.probeOptions,
          nodeVersion: runtime.nodeVersion, now: runtime.now, processInspector: runtime.processInspector,
          heartbeatIntervalMs: runtime.heartbeatIntervalMs, stageGiteeRelease: runtime.stageGiteeRelease, onPhase: runtime.onPhase,
        }) : args.command === "upgrade" ? await runUpgrade({
          targetDir: args.targetDir, repo: args.repo, tag: args.tag, browserSource: args.browserSource,
          releaseBaseUrl: runtime.releaseBaseUrl, platform: runtime.platform,
          volumeResolver: runtime.volumeResolver, timeoutMs: runtime.timeoutMs,
          maxBytes: runtime.maxBytes, maxExpandedBytes: runtime.maxExpandedBytes,
          maxRedirects: runtime.maxRedirects, run: runtime.run,
          probeBrowserPolicy: runtime.probeBrowserPolicy, probeOptions: runtime.probeOptions,
          nodeVersion: runtime.nodeVersion, now: runtime.now, heartbeatIntervalMs: runtime.heartbeatIntervalMs,
          stageGiteeRelease: runtime.stageGiteeRelease, onPhase: runtime.onPhase,
          requestDaemonDrain: runtime.requestDaemonDrain, stopValidatedDaemon: runtime.stopValidatedDaemon,
          verifyProfileReleased: runtime.verifyProfileReleased, processInspector: runtime.processInspector,
          requestHello: runtime.requestHello, killAdapter: runtime.killAdapter,
          fsAdapter: runtime.fsAdapter, sleep: runtime.sleep, retryAttempts: runtime.retryAttempts,
          migrateTemporaryData: runtime.migrateTemporaryData, writeReceipt: runtime.writeReceipt,
          writeRestartMarker: runtime.writeRestartMarker, postActivationDoctor: runtime.postActivationDoctor,
           drainTimeoutMs: runtime.drainTimeoutMs, sessionId: runtime.sessionId,
           fsyncParent: runtime.fsyncParent,
         }) : await runRollback({
           targetDir: args.targetDir, dryRun: args.dryRun || args.confirm === undefined, confirm: args.confirm,
            nodeVersion: runtime.nodeVersion, now: runtime.now, heartbeatIntervalMs: runtime.heartbeatIntervalMs,
           probeBrowserPolicy: runtime.probeBrowserPolicy, probeOptions: runtime.probeOptions,
           stopValidatedDaemon: runtime.stopValidatedDaemon, processInspector: runtime.processInspector,
           requestHello: runtime.requestHello, killAdapter: runtime.killAdapter,
           fsAdapter: runtime.fsAdapter, sleep: runtime.sleep, retryAttempts: runtime.retryAttempts,
           writeReceipt: runtime.writeReceipt, writeRestartMarker: runtime.writeRestartMarker,
           runDoctor: runtime.runDoctor, sessionId: runtime.sessionId, onPhase: runtime.onPhase,
           operationId: runtime.operationId, fsyncParent: runtime.fsyncParent,
         });
    const text = JSON.stringify(result, null, 2) + "\n";
    if (args.json || args.command === "status") writeStdout(text);
    else writeStdout(text);
    const exitCode = (args.command === "doctor" || args.command === "rollback") && Array.isArray(result.blockers) && result.blockers.length > 0 ? 1 : 0;
    return { exitCode, result };
  } catch (error) {
    const result = { status: "error", code: error.code || "LIFECYCLE_DIAGNOSTIC_FAILED", message: error.message };
    writeStderr(JSON.stringify(result) + "\n");
    return { exitCode: 2, result };
  }
}

if (require.main === module) {
  runLifecycleCli().then(outcome => { process.exitCode = outcome.exitCode; });
}

module.exports = { INSTALL_PHASES, JOURNAL_SCHEMA_VERSION, ROLLBACK_PHASES, UPGRADE_PHASES, collectStatus, parseArgs, runDoctor, runInstall, runRollback, runUpgrade, runLifecycleCli, usage };
