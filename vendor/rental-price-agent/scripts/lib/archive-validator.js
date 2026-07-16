#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BLOCK_SIZE = 512;
const PACKAGE_ROOT = "rental-price-agent";
const PARTIAL_MARKER = ".rental-price-agent-staging-partial";
const PARTIAL_MARKER_CONTENT = "rental-price-agent-staging-v1\n";
const RELEASE_TREE_TOP_LEVEL = Object.freeze([
  ".gitignore", "README.md", "SKILL.md", "config.example.json", "package-lock.json",
  "package.json", "references", "release-manifest.json", "scripts",
]);
const ALLOWED_TOP_LEVEL = new Set(RELEASE_TREE_TOP_LEVEL);
const MUTABLE_TOP_LEVEL = new Set([
  ".browser-data", ".env", ".omo", "browser-cache", "browser-profile", "config.json",
  "daemon", "migration-backups", "node_modules", "outputs", "tasks",
]);
const MUTABLE_FILES = new Set([
  ".daemon.pid", ".daemon.port", ".daemon.token", "install-receipt.json",
  "lifecycle-journal.json", "lifecycle.lock",
]);
const RESERVED_WINDOWS_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MUTABLE_COMPONENTS = new Set([...MUTABLE_TOP_LEVEL, ...MUTABLE_FILES, ".git", "test-fixtures", "logs", "restart-required.json"]);

class ArchiveValidationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ArchiveValidationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ArchiveValidationError(code, message, details);
}

function readString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  return buffer.subarray(offset, end === -1 || end > offset + length ? offset + length : end).toString("utf8");
}

function readOctal(buffer, offset, length, field) {
  const value = buffer.subarray(offset, offset + length).toString("ascii").replace(/\0.*$/, "").trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) fail("INVALID_ARCHIVE", "Invalid tar " + field);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("INVALID_ARCHIVE", "Invalid tar " + field);
  return parsed;
}

function verifyHeaderChecksum(header) {
  const expected = readOctal(header, 148, 8, "checksum");
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  if (actual !== expected) fail("INVALID_ARCHIVE", "Tar header checksum mismatch");
}

function normalizeArchivePath(rawName, options = {}) {
  if (typeof rawName !== "string" || !rawName || rawName.includes("\0")) {
    fail("UNSAFE_ARCHIVE_ENTRY", "Archive entry has an empty or malformed path");
  }
  if (/^(?:[a-zA-Z]:[\\/]|[\\/]{1,2}|\\\\[?.]\\)/.test(rawName)) {
    fail("UNSAFE_ARCHIVE_ENTRY", "Archive entry uses an absolute, UNC, or device path", { entry: rawName });
  }
  const slashName = rawName.replace(/\\/g, "/").replace(/\/+$/, "").normalize("NFC");
  const segments = slashName.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    fail("UNSAFE_ARCHIVE_ENTRY", "Archive entry contains traversal or empty path segments", { entry: rawName });
  }
  for (const segment of segments) {
    if (/[<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || RESERVED_WINDOWS_SEGMENT.test(segment)) {
      fail("UNSAFE_ARCHIVE_ENTRY", "Archive entry contains an invalid Windows path segment", { entry: rawName, segment });
    }
  }
  if (segments[0] !== PACKAGE_ROOT || (segments.length < 2 && !options.allowPackageRoot)) {
    fail("UNSAFE_ARCHIVE_ENTRY", "Archive must contain exactly the rental-price-agent top-level directory", { entry: rawName });
  }
  if (segments.length === 1) return PACKAGE_ROOT;
  const ownedName = segments[1];
  if (!ALLOWED_TOP_LEVEL.has(ownedName)) {
    const mutable = MUTABLE_TOP_LEVEL.has(ownedName.toLowerCase()) || MUTABLE_FILES.has(ownedName.toLowerCase());
    fail("UNSAFE_ARCHIVE_ENTRY", mutable ? "Archive contains mutable installation content" : "Archive contains an unexpected top-level path", { entry: rawName });
  }
  if (segments.slice(1).some(segment => MUTABLE_COMPONENTS.has(segment.toLowerCase()))) {
    fail("UNSAFE_ARCHIVE_ENTRY", "Archive contains mutable installation content", { entry: rawName });
  }
  return segments.join("/");
}

function collisionKey(value) {
  return value.normalize("NFC").split("/").map(segment => segment.replace(/[. ]+$/g, "").toLowerCase()).join("/");
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function derivedDirectories(filePaths) {
  const directories = new Set();
  for (const filePath of filePaths) {
    const segments = filePath.split("/");
    for (let index = 1; index < segments.length; index++) directories.add(segments.slice(0, index).join("/"));
  }
  return [...directories].sort((left, right) => left.localeCompare(right, "en"));
}

function computeManifestTreeHash(files) {
  const byPath = new Map(files.map(file => [file.path, file]));
  const directories = derivedDirectories(files.map(file => file.path));
  const directorySet = new Set(directories);
  const children = parent => {
    const prefix = parent ? parent + "/" : "";
    return [...new Set([...byPath.keys(), ...directories].filter(item => item.startsWith(prefix) && item !== parent)
      .map(item => item.slice(prefix.length).split("/")[0]))].sort((left, right) => left.localeCompare(right, "en"));
  };
  const entries = [];
  function visit(relativePath) {
    if (directorySet.has(relativePath)) {
      entries.push([relativePath + "/", "directory"]);
      for (const child of children(relativePath)) visit(relativePath + "/" + child);
    } else entries.push([relativePath, byPath.get(relativePath).sha256]);
  }
  const rootChildren = new Set(children(""));
  for (const child of RELEASE_TREE_TOP_LEVEL) if (rootChildren.has(child)) visit(child);
  return sha256(JSON.stringify(entries));
}

function validateExternalManifest(manifest) {
  const files = manifest && manifest.schemaVersion === 2 && manifest.package && manifest.package.files;
  if (!Array.isArray(files) || files.length === 0) fail("ARCHIVE_MANIFEST_MISMATCH", "Verified external manifest has no release files");
  const seen = new Set();
  const validated = [];
  for (const record of files) {
    const keys = record && typeof record === "object" && !Array.isArray(record) ? Object.keys(record).sort().join("\0") : "";
    if (keys !== ["bytes", "mode", "path", "sha256", "type"].sort().join("\0") || record.type !== "file"
        || record.mode !== 0o644 || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      fail("ARCHIVE_MANIFEST_MISMATCH", "External manifest file record is invalid");
    }
    const normalized = normalizeArchivePath(PACKAGE_ROOT + "/" + record.path).slice(PACKAGE_ROOT.length + 1);
    if (normalized !== record.path) fail("ARCHIVE_MANIFEST_MISMATCH", "External manifest path is not canonical", { path: record.path });
    const key = collisionKey(normalized);
    if (seen.has(key)) fail("ARCHIVE_MANIFEST_MISMATCH", "External manifest paths collide", { path: record.path });
    seen.add(key);
    validated.push({ ...record, path: normalized });
  }
  const lock = validated.find(record => record.path === "package-lock.json");
  if (!lock || manifest.package.lockSha256 !== lock.sha256 || !/^[a-f0-9]{64}$/.test(manifest.package.treeSha256)
      || computeManifestTreeHash(validated) !== manifest.package.treeSha256) {
    fail("ARCHIVE_MANIFEST_MISMATCH", "External manifest lock or tree hash is inconsistent");
  }
  return validated;
}

function validateArchiveAgainstManifest(entries, manifest) {
  const files = validateExternalManifest(manifest);
  const expectedDirectories = derivedDirectories(files.map(file => file.path));
  const expected = new Set([...files.map(file => file.path), ...expectedDirectories]);
  const actual = new Set(entries.map(entry => entry.relativeName));
  if (expected.size !== actual.size || [...expected].some(name => !actual.has(name))) {
    fail("ARCHIVE_MANIFEST_MISMATCH", "Archive entries do not exactly match the external manifest");
  }
  const records = [];
  for (const file of files) {
    const entry = entries.find(candidate => candidate.relativeName === file.path);
    if (!entry || entry.type === "5" || entry.size !== file.bytes || entry.mode !== file.mode || sha256(entry.content) !== file.sha256) {
      fail("ARCHIVE_MANIFEST_MISMATCH", "Archive file does not match the external manifest", { path: file.path });
    }
    records.push({ ...file, bytes: entry.size, sha256: sha256(entry.content) });
  }
  if (computeManifestTreeHash(records) !== manifest.package.treeSha256) fail("ARCHIVE_MANIFEST_MISMATCH", "Archive tree hash does not match the external manifest");
}

function validateRequiredLayout(entries, rootDirectorySeen) {
  if (!rootDirectorySeen) fail("INVALID_ARCHIVE_LAYOUT", "Archive is missing the rental-price-agent root directory entry");
  const required = [
    ["SKILL.md", type => type === "\0" || type === "0", "regular file"],
    ["package.json", type => type === "\0" || type === "0", "regular file"],
    ["release-manifest.json", type => type === "\0" || type === "0", "regular file"],
    ["scripts", type => type === "5", "directory"],
  ];
  for (const [name, acceptsType, expectedType] of required) {
    const entry = entries.find(candidate => candidate.relativeName === name);
    if (!entry || !acceptsType(entry.type)) {
      fail("INVALID_ARCHIVE_LAYOUT", "Archive requires " + name + " as a " + expectedType);
    }
  }
}

function parseArchive(archive, options = {}) {
  if (!Buffer.isBuffer(archive) || archive.length < 2 || archive[0] !== 0x1f || archive[1] !== 0x8b) {
    fail("INVALID_ARCHIVE", "Release archive is not gzip content");
  }
  const maxExpandedBytes = Number(options.maxExpandedBytes || 128 * 1024 * 1024);
  let tar;
  try {
    tar = zlib.gunzipSync(archive, { maxOutputLength: maxExpandedBytes });
  } catch (error) {
    if (error && (error.code === "ERR_BUFFER_TOO_LARGE" || /larger than/i.test(error.message))) {
      fail("ARCHIVE_EXPANDED_TOO_LARGE", "Expanded archive exceeds the configured limit");
    }
    fail("INVALID_ARCHIVE", "Release archive could not be decompressed");
  }
  if (tar.length > maxExpandedBytes) fail("ARCHIVE_EXPANDED_TOO_LARGE", "Expanded archive exceeds the configured limit");

  const entries = [];
  const normalizedNames = new Set();
  let rootDirectorySeen = false;
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    offset += BLOCK_SIZE;
    if (header.every(byte => byte === 0)) {
      zeroBlocks++;
      if (zeroBlocks >= 2) break;
      continue;
    }
    zeroBlocks = 0;
    verifyHeaderChecksum(header);
    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const rawName = prefix ? prefix + "/" + name : name;
    const type = String.fromCharCode(header[156] || 0);
    if (type !== "\0" && type !== "0" && type !== "5") {
      fail("UNSAFE_ARCHIVE_ENTRY", "Archive links, special files, and metadata entries are not accepted", { entry: rawName, type });
    }
    const rootDirectory = rawName.replace(/\\/g, "/").replace(/\/+$/, "") === PACKAGE_ROOT;
    if (rootDirectory && type !== "5") fail("UNSAFE_ARCHIVE_ENTRY", "Package root must be a directory entry");
    if (rootDirectory) rootDirectorySeen = true;
    const normalized = normalizeArchivePath(rawName, { allowPackageRoot: rootDirectory });
    const comparisonName = collisionKey(normalized);
    if (normalizedNames.has(comparisonName)) {
      fail("UNSAFE_ARCHIVE_ENTRY", "Archive contains duplicate normalized paths", { entry: rawName });
    }
    normalizedNames.add(comparisonName);
    const size = readOctal(header, 124, 12, "entry size");
    const mode = readOctal(header, 100, 8, "entry mode");
    if (type === "5" && size !== 0) fail("INVALID_ARCHIVE", "Tar directory entry has content", { entry: rawName });
    if (offset + size > tar.length) fail("INVALID_ARCHIVE", "Tar entry is truncated", { entry: rawName });
    const content = tar.subarray(offset, offset + size);
    if (!rootDirectory) entries.push({ name: normalized, relativeName: normalized.slice(PACKAGE_ROOT.length + 1), type, size, mode, content });
    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }
  if (zeroBlocks < 2) fail("INVALID_ARCHIVE", "Tar archive is missing its end marker");
  validateRequiredLayout(entries, rootDirectorySeen);
  if (options.manifest) validateArchiveAgainstManifest(entries, options.manifest);
  return entries;
}

function parseJsonEntry(entries, name, code) {
  const entry = entries.find(candidate => candidate.relativeName.toLowerCase() === name.toLowerCase());
  if (!entry || entry.type === "5") fail(code, "Archive is missing " + name);
  try {
    return JSON.parse(entry.content.toString("utf8"));
  } catch {
    fail(code, name + " is not valid JSON");
  }
}

function validateArchiveIdentity(entries, expected) {
  const packageJson = parseJsonEntry(entries, "package.json", "RELEASE_IDENTITY_MISMATCH");
  const releaseManifest = parseJsonEntry(entries, "release-manifest.json", "RELEASE_IDENTITY_MISMATCH");
  if (packageJson.name !== "rental-price-agent" || releaseManifest.name !== "rental-price-agent"
      || packageJson.version !== expected.version || releaseManifest.skillVersion !== expected.version
      || releaseManifest.releaseTag !== expected.tag) {
    fail("RELEASE_IDENTITY_MISMATCH", "Archive package, manifest, and requested tag/version do not match");
  }
  return { packageJson, releaseManifest };
}

function lstatIfExists(entryPath) {
  try { return fs.lstatSync(entryPath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function removeOwnedPartial(partialPath) {
  const stat = lstatIfExists(partialPath);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("UNSAFE_STAGING_PATH", "Staging partial path is not an owned directory");
  const markerPath = path.join(partialPath, PARTIAL_MARKER);
  const markerStat = lstatIfExists(markerPath);
  if (!markerStat || markerStat.isSymbolicLink() || !markerStat.isFile() || fs.readFileSync(markerPath, "utf8") !== PARTIAL_MARKER_CONTENT) {
    fail("UNSAFE_STAGING_PATH", "Staging partial ownership marker is missing or invalid");
  }
  fs.rmSync(partialPath, { recursive: true, force: true });
}

function extractEntries(entries, stagingDir) {
  const resolvedStaging = path.resolve(stagingDir);
  const partialPath = resolvedStaging + ".partial";
  if (lstatIfExists(resolvedStaging)) fail("STAGING_ALREADY_EXISTS", "Staging destination already exists");
  removeOwnedPartial(partialPath);
  fs.mkdirSync(partialPath, { recursive: false });
  fs.writeFileSync(path.join(partialPath, PARTIAL_MARKER), PARTIAL_MARKER_CONTENT, { encoding: "utf8", flag: "wx" });
  try {
    for (const entry of entries) {
      const destination = path.join(partialPath, ...entry.relativeName.split("/"));
      const relative = path.relative(partialPath, destination);
      if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        fail("UNSAFE_ARCHIVE_ENTRY", "Archive entry escapes staging", { entry: entry.name });
      }
      if (entry.type === "5") {
        fs.mkdirSync(destination, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const handle = fs.openSync(destination, "wx", 0o644);
        try { fs.writeFileSync(handle, entry.content); } finally { fs.closeSync(handle); }
      }
    }
    fs.unlinkSync(path.join(partialPath, PARTIAL_MARKER));
    fs.renameSync(partialPath, resolvedStaging);
    return resolvedStaging;
  } catch (error) {
    fs.rmSync(partialPath, { recursive: true, force: true });
    throw error;
  }
}

function validateAndStageArchive(options = {}) {
  const entries = parseArchive(options.archive, { maxExpandedBytes: options.maxExpandedBytes, manifest: options.manifest });
  const identity = validateArchiveIdentity(entries, { tag: options.tag, version: options.version });
  const stagePath = extractEntries(entries, options.stagingDir);
  return { stagePath, entries: entries.map(entry => ({ name: entry.name, type: entry.type, size: entry.size })), ...identity };
}

module.exports = {
  ALLOWED_TOP_LEVEL,
  ArchiveValidationError,
  computeManifestTreeHash,
  PACKAGE_ROOT,
  PARTIAL_MARKER,
  PARTIAL_MARKER_CONTENT,
  MUTABLE_TOP_LEVEL,
  normalizeArchivePath,
  parseArchive,
  removeOwnedPartial,
  validateAndStageArchive,
  validateArchiveIdentity,
  validateExternalManifest,
};
