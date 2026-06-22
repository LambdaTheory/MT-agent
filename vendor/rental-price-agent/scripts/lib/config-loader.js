/**
 * Shared config loader — reads config.json with ${ENV_VAR} resolution.
 * Also loads .env file if present.
 */

const fs = require("fs");
const path = require("path");

const SKILL_DIR = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = SKILL_DIR + "/config.json";
const ENV_PATH = SKILL_DIR + "/.env";

function loadEnv() {
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*(\w+)\s*=\s*(.+)/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}

function loadConfig() {
  loadEnv();
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const resolved = raw.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || "");
  return JSON.parse(resolved);
}

module.exports = { loadConfig, SKILL_DIR, CONFIG_PATH };
