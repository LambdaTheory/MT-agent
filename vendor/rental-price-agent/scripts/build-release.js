#!/usr/bin/env node

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const archiveValidator = require("./lib/archive-validator");
const { getInstallLayout } = require("./lib/install-layout");
const { hashReleaseTree, readInstallReceipt, sha256File } = require("./lib/install-receipt");
const lifecycle = require("./lifecycle");
const { loadContractFiles, validateVersionContract } = require("./lib/version-contract");

const SKILL_DIR = path.resolve(__dirname, "..");
const REPOSITORY = Object.freeze({ provider: "gitee", owner: "lcc0628", repo: "rental-price-agent" });
const GENERATION_FORMAT_VERSION = 1;
const LIFECYCLE_GATE_TIMEOUT_MS = 180000;
const TOP_LEVEL_FILES = Object.freeze([
  "README.md", "SKILL.md", "config.example.json", "package-lock.json", "package.json", "release-manifest.json",
]);
const SCRIPT_FILES = Object.freeze([
  "scripts/batch-runner.js", "scripts/build-release.js", "scripts/diff-generator.js", "scripts/init.js",
  "scripts/lifecycle.js", "scripts/mirror-search.js", "scripts/playwright-runner.js", "scripts/task-store.js",
  "scripts/lib/action-registry.js", "scripts/lib/archive-validator.js", "scripts/lib/browser-probe.js", "scripts/lib/declarative-migration.js",
  "scripts/lib/config-loader.js", "scripts/lib/daemon-client.js", "scripts/lib/daemon-compatibility.js",
  "scripts/lib/daemon-identity.js", "scripts/lib/daemon-protocol.js", "scripts/lib/daemon-stop-control.js",
	  "scripts/lib/dependency-install.js", "scripts/lib/install-layout.js", "scripts/lib/install-receipt.js",
	  "scripts/lib/lifecycle-test-instrumentation.js", "scripts/lib/live-state-readiness.js",
  "scripts/lib/lifecycle-install.js", "scripts/lib/lifecycle-live-state.js", "scripts/lib/lifecycle-rollback.js",
  "scripts/lib/lease-lock.js", "scripts/lib/lifecycle-upgrade-safety.js", "scripts/lib/lifecycle-upgrade.js", "scripts/lib/migrations.js", "scripts/lib/process-inspector.js",
  "scripts/lib/release-source.js", "scripts/lib/restart-session.js", "scripts/lib/rule-checker.js",
  "scripts/lib/target-migration.json", "scripts/lib/upgrade-data-transaction.js", "scripts/lib/vas-model.js", "scripts/lib/version-contract.js",
]);
const REFERENCE_FILES = Object.freeze(["references/process.md"]);
const APPROVED_ASSET_FILES = Object.freeze([]);
const RELEASE_FILES = Object.freeze([...TOP_LEVEL_FILES, ...SCRIPT_FILES, ...REFERENCE_FILES, ...APPROVED_ASSET_FILES]);
const RELEASE_DIRECTORIES = Object.freeze(["references", "scripts", "scripts/lib"]);
const KNOWN_EXCLUDED_TOP_LEVEL = new Set([
  ".browser-data", ".daemon.pid", ".daemon.port", ".daemon.token", ".env", ".git", ".gitignore", ".omo",
  "browser-cache", "browser-profile", "config.json", "daemon", "install-receipt.json", "lifecycle-journal.json",
  "lifecycle.lock", "logs", "node_modules", "outputs", "restart-required.json", "tasks", "test-fixtures",
]);
const KNOWN_EXCLUDED_COMPONENTS = new Set([
  "scripts/run-lifecycle-tests.js", "scripts/run-tests.sh", "scripts/run-unit-tests.js",
  "scripts/lib/lifecycle-test-preload.js", "scripts/lib/lifecycle-test-support.js",
]);
const FORBIDDEN_COMPONENTS = /(?:^|\/)(?:\.git|\.omo|node_modules|test-fixtures|tasks|outputs|logs|archives?|browser-(?:cache|profile)|\.browser-data|daemon)(?:\/|$)|(?:^|\/)(?:config\.json|\.env|install-receipt\.json|lifecycle-journal\.json|lifecycle\.lock|restart-required\.json|\.daemon\.(?:pid|port|token))$/i;
const RESERVED_WINDOWS_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MUTABLE_COMPONENTS = new Set([
  ".browser-data", ".env", ".git", ".omo", "archives", "browser-cache", "browser-profile", "config.json",
  "daemon", "install-receipt.json", "lifecycle-journal.json", "lifecycle.lock", "logs", "node_modules",
  "outputs", "restart-required.json", "tasks", "test-fixtures", ".daemon.pid", ".daemon.port", ".daemon.token",
]);

function releaseError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) { return JSON.stringify(stableValue(value), null, 2) + "\n"; }

function normalizeRelative(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw releaseError("UNSAFE_RELEASE_PATH", "Release component path must be relative", { path: value });
  }
  const normalized = value.replace(/\\/g, "/").normalize("NFC");
  const segments = normalized.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    throw releaseError("UNSAFE_RELEASE_PATH", "Release component path contains traversal or empty segments", { path: value });
  }
  for (const segment of segments) {
    if (/[<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || RESERVED_WINDOWS_SEGMENT.test(segment)) {
      throw releaseError("UNSAFE_RELEASE_PATH", "Release component path contains an invalid Windows segment", { path: value, segment });
    }
  }
  return normalized;
}

function collisionKey(value) {
  return value.replace(/\\/g, "/").normalize("NFC").split("/")
    .map(segment => segment.replace(/[. ]+$/g, "").toLowerCase()).join("/");
}

function validateLogicalPaths(paths) {
  const seen = new Set();
  for (const item of paths) {
    const normalized = normalizeRelative(item);
    const components = normalized.split("/");
    if (FORBIDDEN_COMPONENTS.test(normalized) || components.some(component => MUTABLE_COMPONENTS.has(component.toLowerCase()))) {
      throw releaseError("FORBIDDEN_RELEASE_COMPONENT", "Mutable, derived, or secret content cannot be release-owned", { path: normalized });
    }
    const folded = collisionKey(normalized);
    if (seen.has(folded)) throw releaseError("RELEASE_PATH_COLLISION", "Release paths collide under Windows case folding", { path: normalized });
    seen.add(folded);
  }
  return true;
}

function validateReleaseAllowlist(paths) {
  validateLogicalPaths(paths);
  if (paths.length !== RELEASE_FILES.length || paths.some((item, index) => item !== RELEASE_FILES[index])) {
    throw releaseError("RELEASE_ALLOWLIST_CHANGED", "Release allowlist must match the audited component inventory exactly");
  }
  return true;
}

function assertPlainFile(stat, relativePath) {
  if (stat.isSymbolicLink()) throw releaseError("RELEASE_LINK_REJECTED", "Release source contains a link or reparse point", { path: relativePath });
  if (!stat.isFile()) throw releaseError("UNSUPPORTED_RELEASE_ENTRY", "Release component is not a regular file", { path: relativePath });
  if (stat.nlink !== 1) throw releaseError("RELEASE_HARDLINK_REJECTED", "Release source file must have exactly one link", { path: relativePath, links: stat.nlink });
}

function statIdentity(stat, relativePath) {
  return { path: relativePath, type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other", dev: stat.dev, ino: stat.ino, nlink: stat.nlink };
}

function assertDirectory(stat, relativePath, code = "RELEASE_LINK_REJECTED") {
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw releaseError(code, "Release path ancestor is a link, reparse point, or non-directory", { path: relativePath });
}

function assertAllowedAncestors(sourceDir, relativePath) {
  assertDirectory(fs.lstatSync(sourceDir), ".");
  const segments = relativePath.split("/").slice(0, -1);
  let current = sourceDir;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    current = path.join(current, segment);
    assertDirectory(fs.lstatSync(current), segments.slice(0, index + 1).join("/"));
  }
}

function assertSourceShape(sourceDir) {
  const allowedFiles = new Set(RELEASE_FILES);
  const allowedDirectories = new Set(RELEASE_DIRECTORIES);
  const excludedFiles = new Set(KNOWN_EXCLUDED_COMPONENTS);
  const shape = [];
  const seen = new Set();
  function visit(directory, relativeDirectory, excludedRoot) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? relativeDirectory + "/" + entry.name : entry.name;
      const key = collisionKey(relativePath);
      if (seen.has(key)) throw releaseError("RELEASE_PATH_COLLISION", "Source entries collide under Windows path rules", { path: relativePath });
      seen.add(key);
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw releaseError("RELEASE_LINK_REJECTED", "Release source contains a link or reparse point", { path: relativePath });
      const topName = relativePath.split("/")[0];
      const excluded = excludedRoot || KNOWN_EXCLUDED_TOP_LEVEL.has(topName) || excludedFiles.has(relativePath);
      if (!excluded && stat.isDirectory() && !allowedDirectories.has(relativePath)) {
        throw releaseError(relativeDirectory ? "UNKNOWN_RELEASE_COMPONENT" : "UNKNOWN_RELEASE_TOP_LEVEL", "Unknown source directory must be classified explicitly", { path: relativePath });
      }
      if (!excluded && stat.isFile() && !allowedFiles.has(relativePath)) {
        throw releaseError(relativeDirectory ? "UNKNOWN_RELEASE_COMPONENT" : "UNKNOWN_RELEASE_TOP_LEVEL", "Unknown source file must be classified explicitly", { path: relativePath });
      }
      if (!stat.isDirectory() && !stat.isFile()) throw releaseError("UNSUPPORTED_RELEASE_ENTRY", "Release source contains an unsupported entry", { path: relativePath });
      shape.push(statIdentity(stat, relativePath));
      if (stat.isDirectory()) visit(absolutePath, relativePath, excluded);
    }
  }
  visit(sourceDir, "", false);
  for (const required of RELEASE_FILES) if (!shape.some(entry => entry.path === required && entry.type === "file")) {
    throw releaseError("MISSING_RELEASE_COMPONENT", "Required release component is missing", { path: required });
  }
  for (const required of RELEASE_DIRECTORIES) if (!shape.some(entry => entry.path === required && entry.type === "directory")) {
    throw releaseError("MISSING_RELEASE_COMPONENT", "Required release directory is missing", { path: required });
  }
  return shape;
}

function sameStatIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.nlink === right.nlink
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.isFile() === right.isFile();
}

function readHandleExactly(handle, size) {
  const content = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytes = fs.readSync(handle, content, offset, size - offset, offset);
    if (!bytes) break;
    offset += bytes;
  }
  if (offset !== size) throw releaseError("SOURCE_CHANGED_DURING_BUILD", "Release source read was incomplete");
  return content;
}

function readStableSourceFile(sourceDir, absolutePath, relativePath) {
  assertAllowedAncestors(sourceDir, relativePath);
  const pathStatBefore = fs.lstatSync(absolutePath);
  assertPlainFile(pathStatBefore, relativePath);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const handle = fs.openSync(absolutePath, flags);
  try {
    const handleBefore = fs.fstatSync(handle);
    assertPlainFile(handleBefore, relativePath);
    if (!sameStatIdentity(pathStatBefore, handleBefore)) throw releaseError("SOURCE_CHANGED_DURING_BUILD", "Release source identity changed while opening", { path: relativePath });
    const content = readHandleExactly(handle, handleBefore.size);
    const firstHash = sha256(content);
    const secondHash = sha256(readHandleExactly(handle, handleBefore.size));
    const handleAfter = fs.fstatSync(handle);
    const pathStatAfter = fs.lstatSync(absolutePath);
    if (firstHash !== secondHash || !sameStatIdentity(handleBefore, handleAfter) || !sameStatIdentity(handleAfter, pathStatAfter)) {
      throw releaseError("SOURCE_CHANGED_DURING_BUILD", "Release source changed during stable read", { path: relativePath });
    }
    return { content, stat: handleAfter, sha256: firstHash };
  } finally { fs.closeSync(handle); }
}

function validateSkillFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw releaseError("INVALID_SKILL_FRONTMATTER", "SKILL.md must begin with YAML frontmatter");
  if (!/^name:\s*rental-price-agent\s*$/m.test(match[1]) || !/^description:\s*(?:>|[^\s].*)$/m.test(match[1])) {
    throw releaseError("INVALID_SKILL_FRONTMATTER", "SKILL.md frontmatter must declare the canonical name and description");
  }
}

function scanReleaseText(relativePath, content) {
  const text = content.toString("utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
      || /(?:password|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["'](?!\$\{|<|REDACTED|example)[^"'\r\n]{8,}["']/i.test(text)
      || /(?:^|[\s"'(])(?:[A-Za-z]:[\\/](?:Users|Documents|Desktop|AppData)[\\/]|\/(?:Users|home)\/[^<\s"']+)/m.test(text)) {
    throw releaseError("RELEASE_SECRET_OR_PATH", "Release-owned text contains a credential or local absolute path", { path: relativePath });
  }
}

function snapshotSource(sourceDir, hook) {
  validateReleaseAllowlist(RELEASE_FILES);
  const shape = assertSourceShape(sourceDir);
  const files = [];
  for (const relativePath of RELEASE_FILES) {
    const absolutePath = path.join(sourceDir, ...relativePath.split("/"));
    let stable;
    try { stable = readStableSourceFile(sourceDir, absolutePath, relativePath); } catch (error) {
      if (error.code === "ENOENT") throw releaseError("MISSING_RELEASE_COMPONENT", "Required release component is missing", { path: relativePath });
      throw error;
    }
    const { content, stat } = stable;
    scanReleaseText(relativePath, content);
    files.push({ relativePath, absolutePath, content, bytes: content.length, sha256: stable.sha256, size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino, nlink: stat.nlink });
  }
  validateSkillFrontmatter(files.find(file => file.relativePath === "SKILL.md").content.toString("utf8"));
  const contract = validateVersionContract({ ...loadContractFiles({ skillDir: sourceDir }), nodeVersion: process.versions.node });
  if (hook) hook({ phase: "snapshot", files });
  return { files, contract, sourceDir, shape };
}

function verifySnapshot(snapshot) {
  const currentShape = assertSourceShape(snapshot.sourceDir);
  if (JSON.stringify(currentShape) !== JSON.stringify(snapshot.shape)) {
    throw releaseError("SOURCE_CHANGED_DURING_BUILD", "Release source directory shape changed after snapshot");
  }
  for (const file of snapshot.files) {
    const stable = readStableSourceFile(snapshot.sourceDir, file.absolutePath, file.relativePath);
    const stat = stable.stat;
    if (stat.dev !== file.dev || stat.ino !== file.ino || stat.nlink !== file.nlink || stat.size !== file.size
        || stat.mtimeMs !== file.mtimeMs || stable.sha256 !== file.sha256) {
      throw releaseError("SOURCE_CHANGED_DURING_BUILD", "Release source changed after snapshot", { path: file.relativePath });
    }
  }
}

function writeOctal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0") + "\0";
  header.write(text, offset, length, "ascii");
}

function splitTarPath(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: "" };
  for (let index = name.lastIndexOf("/"); index > 0; index = name.lastIndexOf("/", index - 1)) {
    const prefix = name.slice(0, index);
    const base = name.slice(index + 1);
    if (Buffer.byteLength(base) <= 100 && Buffer.byteLength(prefix) <= 155) return { name: base, prefix };
  }
  throw releaseError("RELEASE_PATH_TOO_LONG", "Release path cannot be represented by USTAR", { path: name });
}

function tarHeader(name, type, size, mode) {
  const header = Buffer.alloc(512);
  const split = splitTarPath(name);
  header.write(split.name, 0, 100, "utf8");
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  if (split.prefix) header.write(split.prefix, 345, 155, "utf8");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

function buildArchive(snapshot) {
  const entries = [{ name: "rental-price-agent", type: "5", content: Buffer.alloc(0), mode: 0o755 }];
  for (const directory of RELEASE_DIRECTORIES) entries.push({ name: "rental-price-agent/" + directory, type: "5", content: Buffer.alloc(0), mode: 0o755 });
  for (const file of snapshot.files) entries.push({ name: "rental-price-agent/" + file.relativePath, type: "0", content: file.content, mode: 0o644 });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const chunks = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry.name, entry.type, entry.content.length, entry.mode));
    if (entry.content.length) {
      chunks.push(entry.content);
      const padding = (512 - (entry.content.length % 512)) % 512;
      if (padding) chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  const gzip = zlib.gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
  gzip.fill(0, 4, 8);
  gzip[9] = 255;
  return gzip;
}

function releaseTreeHash(snapshot) {
  return archiveValidator.computeManifestTreeHash(snapshot.files.map(file => ({ path: file.relativePath, sha256: file.sha256 })));
}

function externalManifest(snapshot, identity, archiveName, archive) {
  const fileRecords = snapshot.files.map(file => ({ path: file.relativePath, bytes: file.bytes, sha256: file.sha256, mode: 0o644, type: "file" }));
  return {
    generationFormatVersion: GENERATION_FORMAT_VERSION,
    schemaVersion: 2,
    name: "rental-price-agent",
    version: identity.version,
    tag: identity.tag,
    repository: { ...REPOSITORY, tag: identity.tag },
    versions: {
      skill: snapshot.contract.skillVersion, daemon: snapshot.contract.daemonVersion,
      protocol: snapshot.contract.protocolVersion, configSchema: snapshot.contract.configSchemaVersion,
      stateSchema: snapshot.contract.stateSchemaVersion,
    },
    package: {
      lockSha256: fileRecords.find(file => file.path === "package-lock.json").sha256,
      treeSha256: releaseTreeHash(snapshot), files: fileRecords,
    },
    assets: [{ name: archiveName, bytes: archive.length, sha256: sha256(archive) }],
  };
}

function assertOutputOutsideSource(sourceDir, outputDir) {
  if (!path.isAbsolute(outputDir)) throw releaseError("INVALID_RELEASE_OUTPUT", "--output must be an absolute directory");
  function nearestExisting(entryPath, code) {
    let current = path.resolve(entryPath);
    let stat = null;
    while (!stat) {
      try { stat = fs.lstatSync(current); } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const parent = path.dirname(current);
        if (parent === current) throw releaseError(code, "No existing output ancestor was found");
        current = parent;
      }
    }
    const parsed = path.parse(current);
    let segmentPath = parsed.root;
    const relativeSegments = path.relative(parsed.root, current).split(path.sep).filter(Boolean);
    const rootStat = fs.lstatSync(parsed.root);
    if (rootStat.isSymbolicLink()) throw releaseError(code, "Path root is a link or reparse point", { path: parsed.root });
    for (const segment of relativeSegments) {
      segmentPath = path.join(segmentPath, segment);
      const segmentStat = fs.lstatSync(segmentPath);
      if (segmentStat.isSymbolicLink()) throw releaseError(code, "Path contains a link or reparse point", { path: segmentPath });
    }
    if (!stat.isDirectory()) throw releaseError(code, "Nearest existing output ancestor is not a directory", { path: current });
    const real = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
    return { ancestor: current, resolved: path.join(real, path.relative(current, path.resolve(entryPath))) };
  }
  const sourceInfo = nearestExisting(sourceDir, "RELEASE_LINK_REJECTED");
  if (path.resolve(sourceInfo.ancestor) !== path.resolve(sourceDir)) throw releaseError("INVALID_RELEASE_SOURCE", "Release source directory must exist");
  const outputInfo = nearestExisting(outputDir, "UNSAFE_RELEASE_OUTPUT");
  const source = path.resolve(sourceInfo.resolved).toLowerCase();
  const output = path.resolve(outputInfo.resolved).toLowerCase();
  if (output === source || output.startsWith(source + path.sep)) throw releaseError("OUTPUT_INSIDE_SOURCE", "Release output must be outside the source tree");
  return { source, output };
}

function atomicWriteSet(outputDir, assets, fileSystem = fs, options = {}) {
  function fsyncDirectory() {
    const handle = fileSystem.openSync(outputDir, "r");
    openHandles.add(handle);
    try {
      try { fileSystem.fsyncSync(handle); } catch (error) {
        if (!error || !["EPERM", "EINVAL", "ENOTSUP"].includes(error.code)) throw error;
      }
    } finally { fileSystem.closeSync(handle); openHandles.delete(handle); }
  }
  if (options.recheck) options.recheck();
  fileSystem.mkdirSync(outputDir, { recursive: true });
  if (options.recheck) options.recheck();
  const temporary = [];
  const committed = [];
  const openHandles = new Set();
  try {
    for (const asset of assets) {
      const finalPath = path.join(outputDir, asset.name);
      if (fileSystem.existsSync(finalPath)) throw releaseError("RELEASE_OUTPUT_EXISTS", "Refusing to replace an existing release asset", { path: finalPath });
      const tempPath = finalPath + ".partial-" + process.pid + "-" + crypto.randomBytes(6).toString("hex");
      temporary.push({ tempPath, finalPath });
      const handle = fileSystem.openSync(tempPath, "wx", 0o600);
      openHandles.add(handle);
      try {
        fileSystem.writeFileSync(handle, asset.body);
        fileSystem.fsyncSync(handle);
      } finally {
        fileSystem.closeSync(handle);
        openHandles.delete(handle);
      }
    }
    fsyncDirectory();
    for (const item of temporary) {
      if (options.recheck) options.recheck();
      if (fileSystem.existsSync(item.finalPath)) throw releaseError("RELEASE_OUTPUT_EXISTS", "Refusing to replace an existing release asset", { path: item.finalPath });
      fileSystem.renameSync(item.tempPath, item.finalPath);
      committed.push(item.finalPath);
      fsyncDirectory();
    }
  } catch (error) {
    for (const handle of openHandles) { try { fileSystem.closeSync(handle); } catch {} }
    for (const item of temporary) { try { fileSystem.rmSync(item.tempPath, { force: true }); } catch {} }
    for (const finalPath of committed) { try { fileSystem.rmSync(finalPath, { force: true }); } catch {} }
    throw error;
  }
}

function runCommand(command, args, cwd, timeout = 120000) {
  const result = childProcess.spawnSync(command, args, { cwd, encoding: "utf8", timeout, windowsHide: true });
  if (result.error || result.status !== 0) throw releaseError("RELEASE_GATE_FAILED", command + " " + args.join(" ") + " failed", { status: result.status, stdout: result.stdout, stderr: result.stderr, cause: result.error && result.error.message });
  return { command: [command, ...args], status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function runGates(sourceDir) {
  const gates = [];
  gates.push(runCommand(process.execPath, ["scripts/run-unit-tests.js"], sourceDir));
  gates.push(runCommand(process.execPath, ["scripts/run-lifecycle-tests.js", "--offline", "--forbid-saas"], sourceDir, LIFECYCLE_GATE_TIMEOUT_MS));
  const jsFiles = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".js")) jsFiles.push(absolute);
    }
  }
  visit(path.join(sourceDir, "scripts"));
  for (const file of jsFiles) gates.push(runCommand(process.execPath, ["--check", file], sourceDir, 30000));
  return gates;
}

async function startAssetServer(identity, assets) {
  const prefix = "/" + REPOSITORY.owner + "/" + REPOSITORY.repo + "/releases/download/" + identity.tag + "/";
  const routes = new Map(assets.map(asset => [prefix + asset.name, asset]));
  const server = http.createServer((request, response) => {
    const asset = routes.get(new URL(request.url, "http://127.0.0.1").pathname);
    if (!asset) { response.writeHead(404); response.end("not found"); return; }
    response.writeHead(200, { "content-type": asset.contentType, "content-length": asset.body.length });
    response.end(asset.body);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: "http://127.0.0.1:" + server.address().port, stop: () => new Promise(resolve => server.close(resolve)) };
}

function smokeLoadInstalledRunner(target) {
  const runnerPath = path.join(target, "scripts", "playwright-runner.js");
  const script = [
    "const childProcess = require('child_process')",
    "const http = require('http')",
    "const https = require('https')",
    "const net = require('net')",
    "const tls = require('tls')",
    "const path = require('path')",
    "const runnerPath = process.argv[1]",
    "const counters = { browserLaunches: 0, daemonStarts: 0, networkAttempts: 0, loaded: false }",
    "const blockNetwork = () => { counters.networkAttempts++; throw new Error('release smoke blocked network activity') }",
    "http.request = blockNetwork; http.get = blockNetwork; https.request = blockNetwork; https.get = blockNetwork",
    "net.connect = blockNetwork; net.createConnection = blockNetwork; tls.connect = blockNetwork",
    "net.Server.prototype.listen = function () { counters.daemonStarts++; throw new Error('release smoke blocked daemon activity') }",
    "childProcess.spawn = function () { counters.daemonStarts++; throw new Error('release smoke blocked child process activity') }",
    "childProcess.fork = childProcess.spawn",
    "const playwright = require(path.join(path.dirname(runnerPath), '..', 'node_modules', 'playwright'))",
    "require(runnerPath)",
    "counters.browserLaunches = playwright.__releaseSmokeState.browserLaunches",
    "counters.loaded = true",
    "process.stdout.write(JSON.stringify(counters))",
  ].join("\n");
  const run = childProcess.spawnSync(process.execPath, ["-e", script, runnerPath], {
    cwd: target,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  let result = null;
  try { result = JSON.parse(run.stdout || "null"); } catch {}
  if (run.error || run.status !== 0 || !result || result.loaded !== true
      || result.browserLaunches !== 0 || result.daemonStarts !== 0 || result.networkAttempts !== 0) {
    throw releaseError("RELEASE_RUNNER_SMOKE_FAILED", "Installed Playwright runner failed the inert require-time smoke check", {
      status: run.status,
      signal: run.signal || null,
      causeCode: run.error && run.error.code ? run.error.code : null,
    });
  }
  return result;
}

async function verifyLifecycle(identity, assets, manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-release-verify-"));
  const target = path.join(root, "installed-skill");
  const layout = getInstallLayout(target);
  const server = await startAssetServer(identity, assets);
  try {
    fs.mkdirSync(layout.dataRoot, { recursive: true });
    fs.copyFileSync(path.join(SKILL_DIR, "config.example.json"), layout.configPath);
    const fakeRun = (command, args, options) => {
      if (args[0] === "ci") {
        const moduleDir = path.join(options.cwd, "node_modules", "playwright");
        fs.mkdirSync(moduleDir, { recursive: true });
        fs.writeFileSync(path.join(moduleDir, "package.json"), stableJson({ name: "playwright", version: "1.60.0", main: "index.js" }));
        fs.writeFileSync(path.join(moduleDir, "index.js"), [
          "const state = { browserLaunches: 0 };",
          "module.exports = {",
          "  chromium: { launch() { state.browserLaunches++; throw new Error('release smoke Playwright launch blocked'); } },",
          "  __releaseSmokeState: state,",
          "};",
          "",
        ].join("\n"));
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const probe = async policy => ({ ok: true, selectedSource: policy.source, version: "149.0.0.0", executablePath: "fixture-browser", probes: {} });
    const output = [];
    const install = await lifecycle.runLifecycleCli(["install", "--target", target, "--repo", REPOSITORY.owner + "/" + REPOSITORY.repo, "--tag", identity.tag, "--browser", "chrome"], {
      writeStdout: value => output.push(value), writeStderr: value => output.push(value), releaseBaseUrl: server.url,
      platform: "win32", volumeResolver: () => "fixture-volume", run: fakeRun, probeBrowserPolicy: probe,
      nodeVersion: process.versions.node, now: () => 0, timeoutMs: 2000, maxBytes: 64 * 1024 * 1024,
    });
    if (install.exitCode !== 0 || install.result.code !== "INSTALL_OK") throw releaseError("RELEASE_SELF_INSTALL_FAILED", "Generated release did not install", { install: install.result, output });
    const status = await lifecycle.runLifecycleCli(["status", "--target", target], { writeStdout() {}, writeStderr() {} });
    const doctor = await lifecycle.runLifecycleCli(["doctor", "--target", target], { writeStdout() {}, writeStderr() {}, probeBrowserPolicy: probe, nodeVersion: process.versions.node });
    const runnerSmoke = smokeLoadInstalledRunner(target);
    const receipt = readInstallReceipt({ targetDir: target });
    const archive = assets.find(asset => asset.name.endsWith(".tgz"));
    if (receipt.source.tag !== identity.tag || receipt.source.asset !== archive.name || receipt.source.sha256 !== sha256(archive.body)
        || receipt.releaseTreeSha256 !== manifest.package.treeSha256 || hashReleaseTree(target) !== manifest.package.treeSha256
        || receipt.dependencyLockSha256 !== manifest.package.lockSha256 || sha256File(path.join(target, "package-lock.json")) !== manifest.package.lockSha256
        || status.exitCode !== 0 || !doctor.result.blockers.every(code => ["RESTART_REQUIRED", "ENV_MISSING", "ENV_INCOMPLETE"].includes(code))) {
      throw releaseError("RELEASE_SELF_INSTALL_MISMATCH", "Installed receipt, status, doctor, or release hashes do not match the generated assets", {
        expectedTree: manifest.package.treeSha256, receiptTree: receipt.releaseTreeSha256, installedTree: hashReleaseTree(target),
        expectedLock: manifest.package.lockSha256, receiptLock: receipt.dependencyLockSha256, installedLock: sha256File(path.join(target, "package-lock.json")),
        statusExitCode: status.exitCode, doctorBlockers: doctor.result.blockers,
      });
    }
    return { install: install.result, status: status.result, doctor: doctor.result, receipt, runnerSmoke };
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function resolveIdentity(snapshot, options) {
  const packageJson = JSON.parse(snapshot.files.find(file => file.relativePath === "package.json").content.toString("utf8"));
  const canonicalVersion = packageJson.version;
  const canonicalTag = snapshot.contract.releaseTag;
  const version = options.version || canonicalVersion;
  const tag = options.tag || canonicalTag;
  if (version !== canonicalVersion || tag !== canonicalTag || tag !== "v" + version) throw releaseError("RELEASE_IDENTITY_MISMATCH", "Explicit version/tag must match package.json and release-manifest.json");
  return { version, tag };
}

async function buildRelease(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || SKILL_DIR);
  const outputDir = path.resolve(String(options.outputDir || ""));
  const recheck = () => { assertOutputOutsideSource(sourceDir, outputDir); };
  recheck();
  if (options.runGates !== false) runGates(sourceDir);
  const snapshot = snapshotSource(sourceDir, options.hook);
  const identity = resolveIdentity(snapshot, options);
  const archiveName = "rental-price-agent-v" + identity.version + ".tgz";
  const manifestName = "rental-price-agent-v" + identity.version + ".manifest.json";
  const checksumName = "rental-price-agent-v" + identity.version + ".sha256";
  const archive = buildArchive(snapshot);
  const manifest = externalManifest(snapshot, identity, archiveName, archive);
  archiveValidator.parseArchive(archive, { manifest });
  const manifestBody = Buffer.from(stableJson(manifest));
  const checksumBody = Buffer.from(sha256(archive) + "  " + archiveName + "\n");
  const assets = [
    { name: archiveName, body: archive, contentType: "application/gzip" },
    { name: manifestName, body: manifestBody, contentType: "application/json" },
    { name: checksumName, body: checksumBody, contentType: "text/plain" },
  ];
  if (options.hook) options.hook({ phase: "beforeCommit", snapshot, assets });
  verifySnapshot(snapshot);
  atomicWriteSet(outputDir, assets, options.fileSystem || fs, { recheck: () => { recheck(); verifySnapshot(snapshot); } });
  try {
    verifySnapshot(snapshot);
  } catch (error) {
    for (const asset of assets) fs.rmSync(path.join(outputDir, asset.name), { force: true });
    throw error;
  }
  let verification = null;
  if (options.verify) {
    const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-release-repeat-"));
    try {
      const repeat = await buildRelease({ sourceDir, outputDir: secondDir, version: identity.version, tag: identity.tag, runGates: false, verify: false });
      for (const asset of assets) {
        const second = fs.readFileSync(path.join(secondDir, asset.name));
        if (!asset.body.equals(second)) throw releaseError("NONDETERMINISTIC_RELEASE", "Repeated release build produced different bytes", { asset: asset.name });
      }
      verification = await verifyLifecycle(identity, assets, manifest);
      verification.repeat = repeat.hashes;
    } finally { fs.rmSync(secondDir, { recursive: true, force: true }); }
  }
  return {
    status: "built", outputDir, version: identity.version, tag: identity.tag,
    assets: assets.map(asset => ({ name: asset.name, bytes: asset.body.length, sha256: sha256(asset.body) })),
    hashes: Object.fromEntries(assets.map(asset => [asset.name, sha256(asset.body)])), verification,
  };
}

function usage() {
  return [
    "Usage: node scripts/build-release.js --output <absolute-temp-dir> [--verify] [--version <semver>] [--tag <vSemver>]",
    "  --output <path>   Required absolute output directory outside the Skill source",
    "  --verify          Rebuild byte-for-byte and self-install through fake loopback Gitee",
    "  --version <value> Optional explicit version; must match package.json",
    "  --tag <value>     Optional explicit tag; must match release-manifest.json",
    "  --help            Show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { outputDir: null, verify: false, version: null, tag: null, help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--verify") options.verify = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (["--output", "--version", "--tag"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw releaseError("INVALID_RELEASE_ARGUMENT", "Missing value for " + argument);
      if (argument === "--output") options.outputDir = value;
      else options[argument.slice(2)] = value;
    } else throw releaseError("INVALID_RELEASE_ARGUMENT", "Unknown argument: " + argument);
  }
  if (!options.help && !options.outputDir) throw releaseError("INVALID_RELEASE_OUTPUT", "--output is required");
  return options;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(usage() + "\n"); return; }
    const result = await buildRelease(options);
    process.stdout.write(stableJson(result));
  } catch (error) {
    process.stderr.write(stableJson({ status: "error", code: error.code || "RELEASE_BUILD_FAILED", message: error.message, details: error.details }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  APPROVED_ASSET_FILES, GENERATION_FORMAT_VERSION, KNOWN_EXCLUDED_COMPONENTS, KNOWN_EXCLUDED_TOP_LEVEL, LIFECYCLE_GATE_TIMEOUT_MS,
  RELEASE_DIRECTORIES, RELEASE_FILES, SCRIPT_FILES, TOP_LEVEL_FILES, atomicWriteSet, buildArchive, buildRelease,
  assertPlainFile, externalManifest, normalizeRelative, parseArgs, releaseTreeHash, snapshotSource, stableJson, usage,
  validateLogicalPaths, validateReleaseAllowlist, verifySnapshot,
};
