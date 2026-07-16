const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { validateBatch, validateConfig, validateRecovery, validateTask, validateTaskIndex } = require("./migrations");
const { readDaemonIdentity } = require("./daemon-identity");
const { readRestartMarker } = require("./restart-session");

const SNAPSHOT_SCHEMA_VERSION = 1;

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function lstat(entryPath) {
  try { return fs.lstatSync(entryPath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function canonicalDirectory(entryPath, code) {
  const stat = lstat(entryPath);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail(code, "Expected a regular non-link directory", { path: entryPath });
  const canonical = fs.realpathSync.native ? fs.realpathSync.native(entryPath) : fs.realpathSync(entryPath);
  if (path.resolve(canonical) !== path.resolve(entryPath)) fail(code, "Directory resolves through a link or junction", { path: entryPath });
  return canonical;
}

function readDocument(filePath, kind, validator) {
  const stat = lstat(filePath);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) fail("ROLLBACK_STATE_INVALID", "Live state document is missing or unsafe", { path: filePath, kind });
  let bytes;
  let value;
  try { bytes = fs.readFileSync(filePath); } catch (error) { fail("ROLLBACK_STATE_INVALID", "Live state document is unreadable", { path: filePath, kind, causeCode: error.code }); }
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("ROLLBACK_STATE_INVALID", "Live state document is malformed", { path: filePath, kind }); }
  try { validator(value); } catch (error) { fail("ROLLBACK_STATE_INVALID", "Live state document failed structural validation", { path: filePath, kind, causeCode: error.code }); }
  return { kind, path: filePath, sha256: sha256(bytes), schemaVersion: value.configSchemaVersion || value.stateSchemaVersion || null };
}

function enumerateDocuments(layout) {
  canonicalDirectory(layout.dataRoot, "UNSAFE_DATA_ROOT");
  const currentStructure = validator => value => validator(value, { allowNonCurrent: true });
  const documents = [readDocument(layout.configPath, "config", currentStructure(validateConfig))];
  const tasksStat = lstat(layout.tasksDir);
  if (!tasksStat) return documents;
  canonicalDirectory(layout.tasksDir, "ROLLBACK_STATE_INVALID");
  const taskEntries = fs.readdirSync(layout.tasksDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of taskEntries) {
    const entryPath = path.join(layout.tasksDir, entry.name);
    if (entry.isSymbolicLink()) fail("ROLLBACK_STATE_INVALID", "Task storage contains a link", { path: entryPath });
    if (entry.isDirectory()) {
      if (entry.name !== "batches") fail("ROLLBACK_STATE_INVALID", "Task storage contains an unexpected directory", { path: entryPath });
      canonicalDirectory(entryPath, "ROLLBACK_STATE_INVALID");
      const batches = fs.readdirSync(entryPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"));
      for (const batch of batches) {
        const batchPath = path.join(entryPath, batch.name);
        if (!batch.isFile() || batch.isSymbolicLink() || !batch.name.endsWith(".json")) fail("ROLLBACK_STATE_INVALID", "Batch storage contains an unsafe or unexpected entry", { path: batchPath });
        const validator = batch.name.startsWith("changes_") ? validateRecovery : currentStructure(validateBatch);
        documents.push(readDocument(batchPath, batch.name.startsWith("changes_") ? "recovery" : "batch", validator));
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) fail("ROLLBACK_STATE_INVALID", "Task storage contains an unsafe or unexpected entry", { path: entryPath });
    if (entry.name === "_index.json") documents.push(readDocument(entryPath, "task-index", currentStructure(validateTaskIndex)));
    else if (entry.name.startsWith("changes_")) documents.push(readDocument(entryPath, "recovery", validateRecovery));
    else {
      const document = readDocument(entryPath, "task", value => {
        validateTask(value, { allowNonCurrent: true });
        if (path.basename(entry.name, ".json") !== value.taskId) fail("ROLLBACK_STATE_INVALID", "Task filename does not match taskId", { path: entryPath });
      });
      documents.push(document);
    }
  }
  return documents;
}

function optionalFile(filePath) {
  const stat = lstat(filePath);
  if (!stat) return { present: false, sha256: null };
  if (stat.isSymbolicLink() || !stat.isFile()) fail("ROLLBACK_STATE_INVALID", "Lifecycle state file is unsafe", { path: filePath });
  return { present: true, sha256: sha256(fs.readFileSync(filePath)) };
}

function envFileState(filePath) {
  const expectedPath = path.resolve(filePath);
  let stat;
  try { stat = fs.lstatSync(expectedPath); } catch (error) {
    if (error.code === "ENOENT") return { exists: false, type: "missing", canonicalPath: expectedPath, sha256: null };
    return { exists: null, type: "unreadable", canonicalPath: expectedPath, sha256: null };
  }
  let canonicalPath = expectedPath;
  try { canonicalPath = fs.realpathSync.native ? fs.realpathSync.native(expectedPath) : fs.realpathSync(expectedPath); } catch {}
  if (stat.isSymbolicLink()) return { exists: true, type: "link", canonicalPath, sha256: null };
  if (!stat.isFile()) return { exists: true, type: stat.isDirectory() ? "directory" : "other", canonicalPath, sha256: null };
  try { return { exists: true, type: "file", canonicalPath, sha256: sha256(fs.readFileSync(expectedPath)) }; }
  catch { return { exists: true, type: "unreadable", canonicalPath, sha256: null }; }
}

function readinessSummary(layout, config, receipt) {
  const daemon = readDaemonIdentity(layout);
  const restart = readRestartMarker(layout);
  const daemonFiles = [layout.daemonIdentityPath, layout.daemonPidPath, layout.daemonPortPath, layout.daemonTokenPath]
    .map(filePath => ({ path: filePath, ...optionalFile(filePath) }));
  return {
    browser: { configured: config.browser, installed: receipt.browser },
    daemon: { state: daemon.present ? daemon.error || "present" : "absent", files: daemonFiles },
    restart: { state: restart.error || (restart.required ? "required" : "absent"), file: optionalFile(layout.restartMarkerPath) },
  };
}

function buildLiveStateSnapshot(layout, plan) {
  const documents = enumerateDocuments(layout).map(document => ({ ...document, path: path.relative(layout.dataRoot, document.path).replace(/\\/g, "/") }));
  const config = JSON.parse(fs.readFileSync(layout.configPath, "utf8"));
  const journal = optionalFile(layout.journalPath);
  const receipt = optionalFile(layout.receiptPath);
  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    paths: {
      targetDir: canonicalDirectory(layout.targetDir, "ROLLBACK_CURRENT_INVALID"),
      dataRoot: canonicalDirectory(layout.dataRoot, "UNSAFE_DATA_ROOT"),
      previousDir: canonicalDirectory(layout.targetDir + ".previous", "ROLLBACK_PREVIOUS_INVALID"),
    },
    releases: {
      current: { version: plan.current.contract.skillVersion, treeSha256: plan.current.treeSha256, receiptSha256: receipt.sha256, receipt: plan.currentReceipt },
      previous: { version: plan.previous.contract.skillVersion, treeSha256: plan.previous.treeSha256, receipt: plan.previousReceipt },
    },
    lifecycle: { journal },
    mutable: { env: envFileState(layout.envPath) },
    readiness: readinessSummary(layout, config, plan.currentReceipt),
    documents,
  };
  const digest = sha256(Buffer.from(JSON.stringify(snapshot)));
  return { snapshot, digest, confirmationToken: plan.previous.contract.skillVersion + "@" + digest };
}

module.exports = { SNAPSHOT_SCHEMA_VERSION, buildLiveStateSnapshot, enumerateDocuments };
