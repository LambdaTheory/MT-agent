#!/usr/bin/env node

/**
 * Task Store — JSON file-based operation logger.
 *
 * Usage:
 *   node task-store.js <action> [args...]
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getInstallLayout } = require("./lib/install-layout");
const { CURRENT_STATE_SCHEMA_VERSION, migrateJsonFile } = require("./lib/migrations");

const SKILL_DIR = path.resolve(__dirname, "..");
const LAYOUT = getInstallLayout(SKILL_DIR);
const STORE_DIR = LAYOUT.tasksDir;
const INDEX_FILE = path.join(STORE_DIR, "_index.json");
let loadedIndexDocument = null;

// ================================================================
// Helpers
// ================================================================

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadIndex() {
  ensureDir(STORE_DIR);
  if (!fs.existsSync(INDEX_FILE)) {
    loadedIndexDocument = { stateSchemaVersion: CURRENT_STATE_SCHEMA_VERSION, tasks: [] };
    fs.writeFileSync(INDEX_FILE, JSON.stringify(loadedIndexDocument, null, 2) + "\n", "utf-8");
    return [];
  }
  loadedIndexDocument = migrateJsonFile(INDEX_FILE, { domain: "state", kind: "task-index" }).value;
  return loadedIndexDocument.tasks;
}

function saveIndex(index) {
  loadedIndexDocument = { ...(loadedIndexDocument || {}), stateSchemaVersion: CURRENT_STATE_SCHEMA_VERSION, tasks: index };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(loadedIndexDocument, null, 2) + "\n", "utf-8");
}

function loadTask(taskFile) {
  return migrateJsonFile(taskFile, { domain: "state", kind: "task" }).value;
}

function generateId() {
  return "task_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
}

function log(msg) {
  process.stderr.write("[task] " + msg + "\n");
}

function die(msg) {
  process.stderr.write("[task] ERROR: " + msg + "\n");
  process.exit(1);
}

function output(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

// ================================================================
// Actions
// ================================================================

function doCreate(instruction, changesFile) {
  if (!instruction) die("Instruction required for create action.");
  if (!changesFile || !fs.existsSync(changesFile)) die("Changes file not found: " + changesFile);

  const changes = JSON.parse(fs.readFileSync(changesFile, "utf-8"));
  const taskId = generateId();
  const timestamp = new Date().toISOString();

  const task = {
    stateSchemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    taskId,
    instruction,
    status: "planned",
    changes,
    createdAt: timestamp,
    updatedAt: timestamp,
    history: [
      { timestamp, action: "created", status: "planned" }
    ],
    evidence: [],
    results: {},
  };

  // Save individual task file
  const taskFile = STORE_DIR + "/" + taskId + ".json";
  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), "utf-8");

  // Save a copy of the changes for verify reference
  fs.writeFileSync(STORE_DIR + "/changes_" + taskId + ".json", JSON.stringify(changes, null, 2), "utf-8");

  // Update index
  const index = loadIndex();
  index.push({ taskId, instruction, status: "planned", createdAt: timestamp });
  saveIndex(index);

  log("Task created: " + taskId);
  return { status: "ok", taskId, task };
}

function doUpdate(taskId, field, value) {
  if (!taskId) die("Task ID required.");
  if (!field) die("Field name required.");

  const index = loadIndex();
  const idxEntry = index.find((t) => t.taskId === taskId);
  if (!idxEntry) die("Task not found: " + taskId);

  const taskFile = STORE_DIR + "/" + taskId + ".json";
  if (!fs.existsSync(taskFile)) die("Task file not found: " + taskFile);

  const task = loadTask(taskFile);
  const timestamp = new Date().toISOString();

  task[field] = value;
  task.updatedAt = timestamp;

  // Track status changes
  if (field === "status") {
    task.history.push({ timestamp, action: "status_change", status: value });
    idxEntry.status = value;
  }

  idxEntry.updatedAt = timestamp;

  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), "utf-8");
  saveIndex(index);

  log("Task " + taskId + " updated: " + field + " = " + value);
  return { status: "ok", taskId, updated: { [field]: value } };
}

function doAddEvidence(taskId, type, filePath) {
  if (!taskId) die("Task ID required.");
  if (!type) die("Evidence type required (e.g. screenshot_before, screenshot_after, verify_result).");
  if (!filePath) die("File path required.");

  const taskFile = STORE_DIR + "/" + taskId + ".json";
  if (!fs.existsSync(taskFile)) die("Task file not found: " + taskFile);

  const task = loadTask(taskFile);
  const timestamp = new Date().toISOString();

  task.evidence.push({ type, path: filePath, timestamp });
  task.updatedAt = timestamp;
  task.history.push({ timestamp, action: "add_evidence", type, path: filePath });

  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), "utf-8");

  log("Evidence added to " + taskId + ": " + type);
  return { status: "ok", taskId, evidence: { type, path: filePath } };
}

function doList(statusFilter) {
  const index = loadIndex();
  let tasks = index;

  if (statusFilter) {
    tasks = tasks.filter((t) => t.status === statusFilter);
  }

  // Sort by creation time, newest first
  tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { status: "ok", count: tasks.length, tasks };
}

function doGet(taskId) {
  if (!taskId) die("Task ID required.");

  const taskFile = STORE_DIR + "/" + taskId + ".json";
  if (!fs.existsSync(taskFile)) die("Task not found: " + taskFile);

  const task = loadTask(taskFile);
  return { status: "ok", task };
}

// ================================================================
// Main
// ================================================================

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    die("Usage: node task-store.js <action> [args...]");
  }

  const action = args[0];
  let result;

  switch (action) {
    case "create":
      result = doCreate(args[1], args[2]);
      break;
    case "update":
      result = doUpdate(args[1], args[2], args[3]);
      break;
    case "add-evidence":
      result = doAddEvidence(args[1], args[2], args[3]);
      break;
    case "list":
      result = doList(args[1]);
      break;
    case "get":
      result = doGet(args[1]);
      break;
    default:
      die("Unknown action: " + action + ". Available: create, update, add-evidence, list, get");
  }

  output(result);
}

main();
