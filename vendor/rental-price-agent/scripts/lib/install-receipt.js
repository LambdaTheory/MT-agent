#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getInstallLayout } = require("./install-layout");
const { loadContractFiles, validateVersionContract } = require("./version-contract");

const RECEIPT_SCHEMA_VERSION = 1;
const RELEASE_TREE_ALLOWLIST = Object.freeze([
  ".gitignore", "README.md", "SKILL.md", "config.example.json", "package-lock.json",
  "package.json", "references", "release-manifest.json", "scripts",
]);
const RECEIPT_FIELDS = new Set([
  "receiptSchemaVersion", "targetDir", "dataRoot", "source", "installedAt", "versions",
  "dependencyLockSha256", "browser", "releaseTreeSha256",
]);

function receiptError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function canonicalPath(entryPath, fileSystem = fs) {
  return fileSystem.realpathSync.native ? fileSystem.realpathSync.native(entryPath) : fileSystem.realpathSync(entryPath);
}

function comparablePath(entryPath) {
  const resolved = path.resolve(entryPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertPlainObject(value, code, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw receiptError(code, label + " must be an object");
}

function rejectUnknown(value, allowed, code, label) {
  assertPlainObject(value, code, label);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw receiptError(code, "Unknown " + label + " field: " + unknown[0], { field: unknown[0] });
}

function requireString(value, field, pattern) {
  if (typeof value !== "string" || !value.trim() || (pattern && !pattern.test(value))) {
    throw receiptError("INSTALL_RECEIPT_MALFORMED", field + " is invalid", { field });
  }
  return value;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function releaseTreeEntries(targetDir) {
  const entries = [];
  function visit(entryPath, relativePath) {
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) throw receiptError("RELEASE_TREE_UNSAFE_ENTRY", "Release tree contains a symbolic link", { path: relativePath });
    if (stat.isDirectory()) {
      entries.push([relativePath.replace(/\\/g, "/") + "/", "directory"]);
      const names = fs.readdirSync(entryPath).sort((left, right) => left.localeCompare(right, "en"));
      for (const name of names) visit(path.join(entryPath, name), path.join(relativePath, name));
      return;
    }
    if (!stat.isFile()) throw receiptError("RELEASE_TREE_UNSAFE_ENTRY", "Release tree contains an unsupported entry", { path: relativePath });
    entries.push([relativePath.replace(/\\/g, "/"), sha256File(entryPath)]);
  }
  const actualNames = fs.readdirSync(targetDir);
  for (const allowedName of RELEASE_TREE_ALLOWLIST) {
    const matches = actualNames.filter(name => name.toLowerCase() === allowedName.toLowerCase());
    matches.sort((left, right) => left.localeCompare(right, "en"));
    for (const name of matches) visit(path.join(targetDir, name), name);
  }
  return entries;
}

function hashReleaseTree(targetDir) {
  const resolved = path.resolve(targetDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw receiptError("INSTALL_TARGET_MISSING", "Installation target is missing or is not a directory");
  }
  return crypto.createHash("sha256").update(JSON.stringify(releaseTreeEntries(resolved))).digest("hex");
}

function validateCanonicalLayout(targetDir, fileSystem = fs) {
  const layout = getInstallLayout(targetDir);
  if (!fileSystem.existsSync(layout.targetDir) || !fileSystem.statSync(layout.targetDir).isDirectory()) throw receiptError("INSTALL_TARGET_MISSING", "Installation target is missing");
  if (!fileSystem.existsSync(layout.dataRoot) || !fileSystem.statSync(layout.dataRoot).isDirectory()) throw receiptError("INSTALL_DATA_ROOT_MISSING", "Installation data root is missing");
  const target = canonicalPath(layout.targetDir, fileSystem);
  const dataRoot = canonicalPath(layout.dataRoot, fileSystem);
  const canonicalParent = canonicalPath(path.dirname(layout.dataRoot), fileSystem);
  const expectedDataRoot = path.join(canonicalParent, path.basename(layout.dataRoot));
  if (comparablePath(dataRoot) !== comparablePath(expectedDataRoot)) throw receiptError("INSTALL_DATA_ROOT_UNSAFE", "Installation data root resolves through a symlink or junction");
  return { layout, target, dataRoot };
}

function validateReceiptFilePath(targetDir, fileSystem = fs) {
  const canonical = validateCanonicalLayout(targetDir, fileSystem);
  let stat;
  try {
    stat = fileSystem.lstatSync(canonical.layout.receiptPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw receiptError("INSTALL_RECEIPT_UNREADABLE", "Install receipt path could not be inspected", { causeCode: error.code || null });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw receiptError("INSTALL_RECEIPT_UNSAFE_PATH", "Install receipt must be a regular non-link file inside the data root");
  }
  let canonicalReceipt;
  let canonicalParent;
  try {
    canonicalReceipt = canonicalPath(canonical.layout.receiptPath, fileSystem);
    canonicalParent = canonicalPath(path.dirname(canonical.layout.receiptPath), fileSystem);
  } catch (error) {
    throw receiptError("INSTALL_RECEIPT_UNSAFE_PATH", "Install receipt path could not be canonicalized", { causeCode: error.code || null });
  }
  const relative = path.relative(canonical.dataRoot, canonicalReceipt);
  const expectedReceipt = path.join(canonical.dataRoot, path.basename(canonical.layout.receiptPath));
  if (comparablePath(canonicalParent) !== comparablePath(canonical.dataRoot)
      || comparablePath(canonicalReceipt) !== comparablePath(expectedReceipt)
      || relative === "" || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw receiptError("INSTALL_RECEIPT_UNSAFE_PATH", "Install receipt resolves outside its canonical data root");
  }
  return canonical.layout.receiptPath;
}

function validateReceipt(value, options = {}) {
  rejectUnknown(value, RECEIPT_FIELDS, "INSTALL_RECEIPT_MALFORMED", "receipt");
  if (value.receiptSchemaVersion !== RECEIPT_SCHEMA_VERSION) throw receiptError("INSTALL_RECEIPT_SCHEMA_UNSUPPORTED", "Unsupported install receipt schema", { value: value.receiptSchemaVersion });
  const targetDir = requireString(value.targetDir, "targetDir");
  const dataRoot = requireString(value.dataRoot, "dataRoot");
  if (!path.isAbsolute(targetDir) || !path.isAbsolute(dataRoot)) throw receiptError("INSTALL_RECEIPT_MALFORMED", "Receipt paths must be absolute");
  if (path.normalize(targetDir) !== targetDir || path.normalize(dataRoot) !== dataRoot) {
    throw receiptError("INSTALL_RECEIPT_PATH_MISMATCH", "Receipt paths must be canonical absolute paths");
  }

  rejectUnknown(value.source, new Set(["provider", "owner", "repo", "tag", "asset", "sha256"]), "INSTALL_RECEIPT_MALFORMED", "receipt source");
  if (value.source.provider !== "gitee") throw receiptError("INSTALL_RECEIPT_MALFORMED", "Receipt source provider must be gitee");
  for (const field of ["owner", "repo", "tag", "asset"]) requireString(value.source[field], "source." + field);
  requireString(value.source.sha256, "source.sha256", /^[a-f0-9]{64}$/);

  rejectUnknown(value.versions, new Set(["skill", "daemon", "protocol", "configSchema", "stateSchema"]), "INSTALL_RECEIPT_MALFORMED", "receipt versions");
  for (const field of ["skill", "daemon", "protocol", "configSchema", "stateSchema"]) requireString(value.versions[field], "versions." + field);
  requireString(value.dependencyLockSha256, "dependencyLockSha256", /^[a-f0-9]{64}$/);
  requireString(value.releaseTreeSha256, "releaseTreeSha256", /^[a-f0-9]{64}$/);
  requireString(value.installedAt, "installedAt");
  if (new Date(value.installedAt).toISOString() !== value.installedAt) throw receiptError("INSTALL_RECEIPT_MALFORMED", "installedAt must be an ISO timestamp");

  rejectUnknown(value.browser, new Set(["policy", "selectedSource", "version"]), "INSTALL_RECEIPT_MALFORMED", "receipt browser");
  rejectUnknown(value.browser.policy, new Set(["source", "allowFallback"]), "INSTALL_RECEIPT_MALFORMED", "receipt browser policy");
  if (!["chrome", "chromium"].includes(value.browser.policy.source) || typeof value.browser.policy.allowFallback !== "boolean") {
    throw receiptError("INSTALL_RECEIPT_MALFORMED", "Receipt browser policy is invalid");
  }
  requireString(value.browser.selectedSource, "browser.selectedSource");
  requireString(value.browser.version, "browser.version");

  if (options.targetDir) {
    const canonical = validateCanonicalLayout(options.targetDir);
    if (comparablePath(targetDir) !== comparablePath(canonical.target) || comparablePath(dataRoot) !== comparablePath(canonical.dataRoot)) {
      throw receiptError("INSTALL_RECEIPT_PATH_MISMATCH", "Receipt target/data paths do not own this installation", {
        expectedTarget: canonical.target,
        expectedDataRoot: canonical.dataRoot,
      });
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function fsyncDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(directoryPath, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!error || !["EINVAL", "EISDIR", "EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeJsonAtomicDurable(filePath, value) {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, "." + path.basename(filePath) + ".tmp-" + process.pid + "-" + crypto.randomBytes(8).toString("hex"));
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fsyncDirectory(directory);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function buildInstallReceipt(options) {
  const canonical = validateCanonicalLayout(options.targetDir);
  const contractFiles = loadContractFiles({ skillDir: canonical.layout.targetDir });
  const manifest = validateVersionContract({ ...contractFiles, nodeVersion: options.nodeVersion || process.versions.node });
  const value = {
    receiptSchemaVersion: RECEIPT_SCHEMA_VERSION,
    targetDir: canonical.target,
    dataRoot: canonical.dataRoot,
    source: { provider: "gitee", ...options.source },
    installedAt: options.installedAt || new Date().toISOString(),
    versions: {
      skill: manifest.skillVersion,
      daemon: manifest.daemonVersion,
      protocol: manifest.protocolVersion,
      configSchema: manifest.configSchemaVersion,
      stateSchema: manifest.stateSchemaVersion,
    },
    dependencyLockSha256: sha256File(path.join(canonical.layout.targetDir, "package-lock.json")),
    browser: options.browser,
    releaseTreeSha256: hashReleaseTree(canonical.layout.targetDir),
  };
  return validateReceipt(value, { targetDir: canonical.layout.targetDir });
}

async function writeInstallReceipt(options) {
  const value = buildInstallReceipt(options);
  const layout = getInstallLayout(options.targetDir);
  if (comparablePath(path.dirname(layout.receiptPath)) !== comparablePath(layout.dataRoot)) {
    throw receiptError("INSTALL_RECEIPT_PATH_MISMATCH", "Install receipt must be stored directly in the data root");
  }
  writeJsonAtomicDurable(layout.receiptPath, value);
  return value;
}

function readInstallReceipt(options) {
  const fileSystem = options.fileSystem || fs;
  const receiptPath = validateReceiptFilePath(options.targetDir, fileSystem);
  if (!receiptPath) return null;
  let value;
  try {
    value = JSON.parse(fileSystem.readFileSync(receiptPath, "utf8"));
  } catch (error) {
    const code = error instanceof SyntaxError ? "INSTALL_RECEIPT_MALFORMED" : "INSTALL_RECEIPT_UNREADABLE";
    throw receiptError(code, code === "INSTALL_RECEIPT_MALFORMED" ? "Install receipt is not valid JSON" : "Install receipt could not be read", { causeCode: error.code || null });
  }
  return validateReceipt(value, { targetDir: options.targetDir });
}

module.exports = {
  RECEIPT_SCHEMA_VERSION,
  RELEASE_TREE_ALLOWLIST,
  buildInstallReceipt,
  hashReleaseTree,
  readInstallReceipt,
  sha256File,
  validateReceipt,
  writeInstallReceipt,
  writeJsonAtomicDurable,
};
