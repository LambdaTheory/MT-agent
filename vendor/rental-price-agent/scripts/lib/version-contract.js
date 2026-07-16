#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ERROR_CODES = Object.freeze({
  MALFORMED_SEMVER: "MALFORMED_SEMVER",
  UNSUPPORTED_NODE: "UNSUPPORTED_NODE",
  PLAYWRIGHT_DEPENDENCY_DRIFT: "PLAYWRIGHT_DEPENDENCY_DRIFT",
  UNKNOWN_COMPATIBILITY_FIELD: "UNKNOWN_COMPATIBILITY_FIELD",
  UNKNOWN_MANIFEST_FIELD: "UNKNOWN_MANIFEST_FIELD",
  INVALID_VERSION_RANGE: "INVALID_VERSION_RANGE",
  PACKAGE_IDENTITY_MISMATCH: "PACKAGE_IDENTITY_MISMATCH",
  PACKAGE_VERSION_MISMATCH: "PACKAGE_VERSION_MISMATCH",
  NODE_RANGE_MISMATCH: "NODE_RANGE_MISMATCH",
  RELEASE_TAG_VERSION_MISMATCH: "RELEASE_TAG_VERSION_MISMATCH",
  INVALID_BROWSER_POLICY: "INVALID_BROWSER_POLICY",
  INVALID_HANDSHAKE_METADATA: "INVALID_HANDSHAKE_METADATA",
});

const MANIFEST_FIELDS = new Set([
  "manifestSchemaVersion",
  "name",
  "releaseTag",
  "skillVersion",
  "daemonVersion",
  "protocolVersion",
  "configSchemaVersion",
  "stateSchemaVersion",
  "nodeRange",
  "playwrightVersion",
  "browserPolicy",
  "compatibility",
  "migration",
]);
const COMPATIBILITY_VERSIONS = Object.freeze({
  skill: "skillVersion",
  daemon: "daemonVersion",
  protocol: "protocolVersion",
  configSchema: "configSchemaVersion",
  stateSchema: "stateSchemaVersion",
});
const BROWSER_POLICY_FIELDS = new Set(["supported", "default", "allowFallback"]);
const SUPPORTED_BROWSERS = new Set(["managed-chromium", "system-chrome"]);
const MIGRATION_FIELDS = new Set(["contractVersion", "definition", "sources"]);
const MIGRATION_SOURCE_FIELDS = new Set(["configSchema", "stateSchema"]);
const RELEASE_TREE_ALLOWLIST = Object.freeze([
  ".gitignore", "README.md", "SKILL.md", "config.example.json", "package-lock.json",
  "package.json", "references", "release-manifest.json", "scripts",
]);
const HANDSHAKE_FIELDS = new Set([
  "skillVersion",
  "daemonVersion",
  "protocolVersion",
  "minClientProtocolVersion",
  "maxClientProtocolVersion",
  "configSchemaVersion",
  "stateSchemaVersion",
  "instanceId",
  "browserSource",
  "browserVersion",
  "upgradeLock",
  "restartRequired",
  "releaseTreeSha256",
  "persistedStateReady",
  "persistedStateDigest",
  "persistedStateBlockers",
  "actualSchemaVersions",
]);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NODE_RANGE_PATTERN = /^>=(\S+) <(\S+)$/;

function hashHandshakeReleaseTree(skillDir) {
  const entries = [];
  function visit(entryPath, relativePath) {
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "Release tree contains a symbolic link", { path: relativePath });
    if (stat.isDirectory()) {
      entries.push([relativePath.replace(/\\/g, "/") + "/", "directory"]);
      for (const name of fs.readdirSync(entryPath).sort((left, right) => left.localeCompare(right, "en"))) visit(path.join(entryPath, name), path.join(relativePath, name));
      return;
    }
    if (!stat.isFile()) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "Release tree contains an unsupported entry", { path: relativePath });
    entries.push([relativePath.replace(/\\/g, "/"), crypto.createHash("sha256").update(fs.readFileSync(entryPath)).digest("hex")]);
  }
  const names = fs.readdirSync(skillDir);
  for (const allowedName of RELEASE_TREE_ALLOWLIST) {
    const matches = names.filter(name => name.toLowerCase() === allowedName.toLowerCase()).sort((left, right) => left.localeCompare(right, "en"));
    for (const name of matches) visit(path.join(skillDir, name), name);
  }
  return crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

class VersionContractError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "VersionContractError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new VersionContractError(code, message, details);
}

function parseSemver(value, field) {
  if (typeof value !== "string") fail(ERROR_CODES.MALFORMED_SEMVER, field + " must be a semantic version", { field, value });
  const match = SEMVER_PATTERN.exec(value);
  if (!match) fail(ERROR_CODES.MALFORMED_SEMVER, field + " must be a semantic version", { field, value });
  const prerelease = match[4] || "";
  if (prerelease.split(".").some(identifier => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))) {
    fail(ERROR_CODES.MALFORMED_SEMVER, field + " must be a semantic version", { field, value });
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function comparePrereleaseIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    if (left.length !== right.length) return left.length < right.length ? -1 : 1;
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareSemver(left, right) {
  const a = typeof left === "string" ? parseSemver(left, "leftVersion") : left;
  const b = typeof right === "string" ? parseSemver(right, "rightVersion") : right;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const leftIdentifiers = a.prerelease.split(".");
  const rightIdentifiers = b.prerelease.split(".");
  const sharedLength = Math.min(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < sharedLength; index++) {
    const precedence = comparePrereleaseIdentifier(leftIdentifiers[index], rightIdentifiers[index]);
    if (precedence !== 0) return precedence;
  }
  return leftIdentifiers.length < rightIdentifiers.length ? -1 : 1;
}

function parseNodeRange(value) {
  if (typeof value !== "string") fail(ERROR_CODES.INVALID_VERSION_RANGE, "nodeRange must be a bounded range", { value });
  const match = NODE_RANGE_PATTERN.exec(value);
  if (!match) fail(ERROR_CODES.INVALID_VERSION_RANGE, "nodeRange must use the form >=x.y.z <x.y.z", { value });
  const min = parseSemver(match[1], "nodeRange.min");
  const maxExclusive = parseSemver(match[2], "nodeRange.maxExclusive");
  if (compareSemver(min, maxExclusive) >= 0) fail(ERROR_CODES.INVALID_VERSION_RANGE, "nodeRange minimum must be below its maximum", { value });
  return { min, maxExclusive };
}

function validateNodeVersion(nodeVersion, nodeRange) {
  const version = parseSemver(String(nodeVersion || "").replace(/^v/, ""), "nodeVersion");
  const range = parseNodeRange(nodeRange);
  if (compareSemver(version, range.min) < 0 || compareSemver(version, range.maxExclusive) >= 0) {
    fail(ERROR_CODES.UNSUPPORTED_NODE, "Node " + nodeVersion + " is outside " + nodeRange, { nodeVersion, nodeRange });
  }
}

function rejectUnknownFields(value, allowed, code, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, context + " must be an object");
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) fail(code, "Unknown " + context + " field: " + unknown[0], { field: unknown[0] });
}

function validateCompatibility(manifest) {
  rejectUnknownFields(manifest.compatibility, new Set(Object.keys(COMPATIBILITY_VERSIONS)), ERROR_CODES.UNKNOWN_COMPATIBILITY_FIELD, "compatibility");
  for (const [domain, versionField] of Object.entries(COMPATIBILITY_VERSIONS)) {
    const range = manifest.compatibility[domain];
    rejectUnknownFields(range, new Set(["min", "max"]), ERROR_CODES.UNKNOWN_COMPATIBILITY_FIELD, "compatibility." + domain);
    const min = parseSemver(range.min, "compatibility." + domain + ".min");
    const max = parseSemver(range.max, "compatibility." + domain + ".max");
    const current = parseSemver(manifest[versionField], versionField);
    if (compareSemver(min, max) > 0 || compareSemver(current, min) < 0 || compareSemver(current, max) > 0) {
      fail(ERROR_CODES.INVALID_VERSION_RANGE, domain + " compatibility does not include the current version", { domain, current: manifest[versionField], min: range.min, max: range.max });
    }
  }
}

function validateBrowserPolicy(policy) {
  rejectUnknownFields(policy, BROWSER_POLICY_FIELDS, ERROR_CODES.INVALID_BROWSER_POLICY, "browserPolicy");
  if (!Array.isArray(policy.supported) || policy.supported.length === 0 || new Set(policy.supported).size !== policy.supported.length) {
    fail(ERROR_CODES.INVALID_BROWSER_POLICY, "browserPolicy.supported must be a non-empty unique array");
  }
  if (policy.supported.some(browser => !SUPPORTED_BROWSERS.has(browser)) || !policy.supported.includes(policy.default) || typeof policy.allowFallback !== "boolean") {
    fail(ERROR_CODES.INVALID_BROWSER_POLICY, "browserPolicy contains an unsupported selection");
  }
}

function validateMigrationContract(migration) {
  rejectUnknownFields(migration, MIGRATION_FIELDS, ERROR_CODES.UNKNOWN_MANIFEST_FIELD, "migration");
  if (migration.contractVersion !== 2 || migration.definition !== "scripts/lib/target-migration.json") {
    fail(ERROR_CODES.UNKNOWN_MANIFEST_FIELD, "migration must declare contractVersion 2 and the canonical target definition");
  }
  rejectUnknownFields(migration.sources, MIGRATION_SOURCE_FIELDS, ERROR_CODES.UNKNOWN_MANIFEST_FIELD, "migration.sources");
  for (const domain of MIGRATION_SOURCE_FIELDS) {
    const ranges = migration.sources[domain];
    if (!Array.isArray(ranges) || ranges.length === 0) fail(ERROR_CODES.INVALID_VERSION_RANGE, "migration source ranges must be non-empty", { domain });
    for (const range of ranges) {
      rejectUnknownFields(range, new Set(["min", "max"]), ERROR_CODES.UNKNOWN_MANIFEST_FIELD, "migration.sources." + domain);
      const min = parseSemver(range.min, "migration.sources." + domain + ".min");
      const max = parseSemver(range.max, "migration.sources." + domain + ".max");
      if (compareSemver(min, max) > 0) fail(ERROR_CODES.INVALID_VERSION_RANGE, "migration source range minimum exceeds maximum", { domain, range });
    }
  }
}

function validateVersionContract({ manifest, packageJson, lockfile, nodeVersion = process.versions.node }) {
  rejectUnknownFields(manifest, MANIFEST_FIELDS, ERROR_CODES.UNKNOWN_MANIFEST_FIELD, "manifest");
  for (const field of ["skillVersion", "daemonVersion", "protocolVersion", "configSchemaVersion", "stateSchemaVersion", "playwrightVersion"]) {
    parseSemver(manifest[field], field);
  }
  if (manifest.manifestSchemaVersion !== 1) fail(ERROR_CODES.UNKNOWN_MANIFEST_FIELD, "Unsupported manifestSchemaVersion", { value: manifest.manifestSchemaVersion });
  if (manifest.releaseTag !== "v" + manifest.skillVersion) {
    fail(ERROR_CODES.RELEASE_TAG_VERSION_MISMATCH, "releaseTag must equal v + skillVersion", { releaseTag: manifest.releaseTag, skillVersion: manifest.skillVersion });
  }
  if (manifest.name !== "rental-price-agent" || packageJson.name !== manifest.name) {
    fail(ERROR_CODES.PACKAGE_IDENTITY_MISMATCH, "Package and manifest identity must be rental-price-agent");
  }
  parseSemver(packageJson.version, "package.version");
  if (packageJson.version !== manifest.skillVersion) {
    fail(ERROR_CODES.PACKAGE_VERSION_MISMATCH, "package.json version must equal skillVersion", { packageVersion: packageJson.version, skillVersion: manifest.skillVersion });
  }
  const lockRoot = lockfile && lockfile.packages && lockfile.packages[""];
  if (!packageJson.engines || packageJson.engines.node !== manifest.nodeRange || !lockRoot || !lockRoot.engines || lockRoot.engines.node !== manifest.nodeRange) {
    fail(ERROR_CODES.NODE_RANGE_MISMATCH, "package.json and package-lock.json root engines.node must equal manifest nodeRange");
  }
  validateNodeVersion(nodeVersion, manifest.nodeRange);
  validateCompatibility(manifest);
  validateBrowserPolicy(manifest.browserPolicy);
  validateMigrationContract(manifest.migration);

  const installedPlaywright = lockfile && lockfile.packages && lockfile.packages["node_modules/playwright"];
  if (lockRoot) parseSemver(lockRoot.version, "lockfile.root.version");
  const dependencyVersions = [
    packageJson.dependencies && packageJson.dependencies.playwright,
    lockRoot && lockRoot.dependencies && lockRoot.dependencies.playwright,
    installedPlaywright && installedPlaywright.version,
  ];
  if (dependencyVersions.some(version => version !== manifest.playwrightVersion)) {
    fail(ERROR_CODES.PLAYWRIGHT_DEPENDENCY_DRIFT, "Playwright must be pinned exactly across manifest, package, and lockfile", { expected: manifest.playwrightVersion, actual: dependencyVersions });
  }
  if (!lockRoot || lockRoot.name !== manifest.name || lockRoot.version !== manifest.skillVersion) {
    fail(ERROR_CODES.PACKAGE_VERSION_MISMATCH, "Lockfile root identity/version must equal the manifest");
  }

  return JSON.parse(JSON.stringify(manifest));
}

function loadContractFiles({ skillDir = path.resolve(__dirname, "..", "..") } = {}) {
  const readJson = file => JSON.parse(fs.readFileSync(path.join(skillDir, file), "utf8"));
  return {
    manifest: readJson("release-manifest.json"),
    packageJson: readJson("package.json"),
    lockfile: readJson("package-lock.json"),
  };
}

function readCurrentMetadata(options = {}) {
  return validateVersionContract({ ...loadContractFiles(options), nodeVersion: options.nodeVersion || process.versions.node });
}

function buildHandshakeMetadata(options = {}) {
  const manifest = options.manifest || readCurrentMetadata(options);
  const protocolRange = manifest.compatibility && manifest.compatibility.protocol;
  const handshake = {
    skillVersion: manifest.skillVersion,
    daemonVersion: manifest.daemonVersion,
    protocolVersion: manifest.protocolVersion,
    minClientProtocolVersion: protocolRange && protocolRange.min,
    maxClientProtocolVersion: protocolRange && protocolRange.max,
    configSchemaVersion: manifest.configSchemaVersion,
    stateSchemaVersion: manifest.stateSchemaVersion,
    instanceId: options.instanceId,
    browserSource: options.browserSource === undefined ? null : options.browserSource,
    browserVersion: options.browserVersion === undefined ? null : options.browserVersion,
    upgradeLock: options.upgradeLock === undefined ? false : options.upgradeLock,
    restartRequired: options.restartRequired === undefined ? false : options.restartRequired,
    releaseTreeSha256: options.releaseTreeSha256 || hashHandshakeReleaseTree(options.skillDir || path.resolve(__dirname, "..", "..")),
    persistedStateReady: options.persistedStateReady === undefined ? true : options.persistedStateReady,
    persistedStateDigest: options.persistedStateDigest || "0".repeat(64),
    persistedStateBlockers: options.persistedStateBlockers || [],
    actualSchemaVersions: options.actualSchemaVersions || { config: manifest.configSchemaVersion, state: [] },
  };
  return validateHandshakeMetadata(handshake, { manifest });
}

function validateHandshakeMetadata(handshake, options = {}) {
  try {
    rejectUnknownFields(handshake, HANDSHAKE_FIELDS, ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake");
    const missing = [...HANDSHAKE_FIELDS].filter(field => !Object.prototype.hasOwnProperty.call(handshake, field));
    if (missing.length) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "Missing handshake field: " + missing[0], { field: missing[0] });
    for (const field of ["skillVersion", "daemonVersion", "protocolVersion", "minClientProtocolVersion", "maxClientProtocolVersion", "configSchemaVersion", "stateSchemaVersion"]) {
      parseSemver(handshake[field], "handshake." + field);
    }
    if (typeof handshake.instanceId !== "string" || !handshake.instanceId.trim()) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake.instanceId must be a non-empty string");
    for (const field of ["browserSource", "browserVersion"]) {
      if (handshake[field] !== null && (typeof handshake[field] !== "string" || !handshake[field].trim())) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake." + field + " must be null or a non-empty string");
    }
    if (typeof handshake.upgradeLock !== "boolean" || typeof handshake.restartRequired !== "boolean" || typeof handshake.persistedStateReady !== "boolean") fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake readiness flags must be boolean");
    if (!/^[a-f0-9]{64}$/.test(handshake.releaseTreeSha256)) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake.releaseTreeSha256 must be a SHA-256 hash");
    if (!/^[a-f0-9]{64}$/.test(handshake.persistedStateDigest)) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake.persistedStateDigest must be a SHA-256 hash");
    if (!Array.isArray(handshake.persistedStateBlockers) || handshake.persistedStateBlockers.some(code => typeof code !== "string" || !code)) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake.persistedStateBlockers must be an array of blocker codes");
    if (!handshake.actualSchemaVersions || typeof handshake.actualSchemaVersions !== "object" || Array.isArray(handshake.actualSchemaVersions)
      || !Object.prototype.hasOwnProperty.call(handshake.actualSchemaVersions, "config") || !Object.prototype.hasOwnProperty.call(handshake.actualSchemaVersions, "state")
      || (handshake.actualSchemaVersions.config !== null && typeof handshake.actualSchemaVersions.config !== "string")
      || !Array.isArray(handshake.actualSchemaVersions.state)) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake.actualSchemaVersions is invalid");
    if (handshake.actualSchemaVersions.config !== null) parseSemver(handshake.actualSchemaVersions.config, "handshake.actualSchemaVersions.config");
    for (const version of handshake.actualSchemaVersions.state) parseSemver(version, "handshake.actualSchemaVersions.state");
    if (compareSemver(handshake.minClientProtocolVersion, handshake.maxClientProtocolVersion) > 0
      || compareSemver(handshake.protocolVersion, handshake.minClientProtocolVersion) < 0
      || compareSemver(handshake.protocolVersion, handshake.maxClientProtocolVersion) > 0) {
      fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake protocol range must include protocolVersion");
    }
    const manifest = options.manifest || readCurrentMetadata(options);
    const expected = {
      skillVersion: manifest.skillVersion,
      daemonVersion: manifest.daemonVersion,
      protocolVersion: manifest.protocolVersion,
      minClientProtocolVersion: manifest.compatibility.protocol.min,
      maxClientProtocolVersion: manifest.compatibility.protocol.max,
    };
    for (const [field, value] of Object.entries(expected)) {
      if (handshake[field] !== value) fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, "handshake." + field + " does not match the version contract", { field, expected: value, actual: handshake[field] });
    }
    return JSON.parse(JSON.stringify(handshake));
  } catch (error) {
    if (error && error.code === ERROR_CODES.INVALID_HANDSHAKE_METADATA) throw error;
    fail(ERROR_CODES.INVALID_HANDSHAKE_METADATA, error.message, { causeCode: error.code });
  }
}

function runCli() {
  try {
    const metadata = readCurrentMetadata();
    process.stdout.write(JSON.stringify(metadata, null, process.argv.includes("--json") ? 2 : 0) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, code: error.code || "VERSION_CONTRACT_ERROR", message: error.message }) + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();

module.exports = {
  ERROR_CODES,
  HANDSHAKE_FIELDS,
  VersionContractError,
  buildHandshakeMetadata,
  compareSemver,
  loadContractFiles,
  parseSemver,
  readCurrentMetadata,
  validateHandshakeMetadata,
  validateNodeVersion,
  validateVersionContract,
};
