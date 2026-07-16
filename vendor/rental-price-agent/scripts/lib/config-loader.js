/**
 * Shared config loader — reads config.json with ${ENV_VAR} resolution.
 * Also loads .env file if present.
 */

const fs = require("fs");
const path = require("path");
const { getInstallLayout } = require("./install-layout");
const { checkSchemaCompatibility, validateConfig } = require("./migrations");

const SKILL_DIR = path.resolve(__dirname, "..", "..");
const LAYOUT = getInstallLayout(SKILL_DIR);
const DATA_ROOT = LAYOUT.dataRoot;
const CONFIG_PATH = LAYOUT.configPath;
const ENV_PATH = LAYOUT.envPath;

function loadEnv(options = {}) {
  const layout = options.layout || LAYOUT;
  const environment = options.environment || process.env;
  if (fs.existsSync(layout.envPath)) {
    const stat = fs.lstatSync(layout.envPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw Object.assign(new Error(".env must be a regular file"), { code: "ENV_UNSAFE_PATH" });
    const content = fs.readFileSync(layout.envPath, "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*(\w+)\s*=\s*(.+)/);
      if (m && !environment[m[1]]) environment[m[1]] = m[2].trim();
    }
  }
  return environment;
}

function loadConfig(options = {}) {
  const layout = options.layout || LAYOUT;
  const environment = loadEnv({ layout, environment: options.environment || process.env });
  const stat = fs.lstatSync(layout.configPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw Object.assign(new Error("config.json must be a regular file"), { code: "CONFIG_UNSAFE_PATH" });
  const raw = fs.readFileSync(layout.configPath, "utf-8");
  const parsed = JSON.parse(raw);
  const compatibility = checkSchemaCompatibility("config", parsed && parsed.configSchemaVersion);
  if (compatibility.status !== "current") {
    throw Object.assign(new Error("Config schema requires explicit lifecycle migration"), { code: "CONFIG_SCHEMA_MIGRATION_REQUIRED", details: compatibility });
  }
  validateConfig(parsed);
  const resolved = raw.replace(/\$\{(\w+)\}/g, (_, name) => environment[name] || "");
  return JSON.parse(resolved);
}

module.exports = { loadConfig, SKILL_DIR, DATA_ROOT, CONFIG_PATH, ENV_PATH, LAYOUT };
