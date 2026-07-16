#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const archiveValidator = require("./archive-validator");

const DEFAULT_BASE_URL = "https://gitee.com";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

class ReleaseSourceError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ReleaseSourceError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ReleaseSourceError(code, message, details);
}

function isLoopback(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
}

function validateSource(options) {
  if ((options.platform || process.platform) !== "win32") fail("UNSUPPORTED_PLATFORM", "Release staging is currently supported only on Windows");
  if (!IDENTIFIER_PATTERN.test(String(options.owner || "")) || !IDENTIFIER_PATTERN.test(String(options.repo || ""))) {
    fail("INVALID_RELEASE_SOURCE", "Explicit Gitee owner and repository identifiers are required");
  }
  const tagMatch = TAG_PATTERN.exec(String(options.tag || ""));
  if (!tagMatch) fail("INVALID_RELEASE_TAG", "Release tag must be an explicit immutable v<semver> tag");
  if (typeof options.targetDir !== "string" || typeof options.stagingDir !== "string") {
    fail("INVALID_STAGING_PATH", "Explicit targetDir and stagingDir are required");
  }
  const targetDir = path.resolve(options.targetDir);
  const stagingDir = path.resolve(options.stagingDir);
  if (targetDir === stagingDir || stagingDir.startsWith(targetDir + path.sep) || targetDir.startsWith(stagingDir + path.sep)) {
    fail("INVALID_STAGING_PATH", "Staging and active target paths must be separate");
  }
  const volumeResolver = options.volumeResolver || (value => path.parse(path.resolve(value)).root.toLowerCase());
  if (volumeResolver(targetDir) !== volumeResolver(stagingDir)) fail("CROSS_VOLUME_STAGING", "Staging must be on the same volume as the active target");
  if (!options.volumeResolver) {
    const targetParent = canonicalExistingAncestor(path.dirname(targetDir));
    const stagingParent = canonicalExistingAncestor(path.dirname(stagingDir));
    if (volumeResolver(targetParent) !== volumeResolver(stagingParent)) fail("CROSS_VOLUME_STAGING", "Staging must resolve to the same physical volume as the active target");
  }
  const baseUrl = new URL(options.baseUrl || DEFAULT_BASE_URL);
  const injected = options.baseUrl !== undefined;
  if (injected) {
    if (!/^https?:$/.test(baseUrl.protocol) || !isLoopback(baseUrl.hostname)) fail("INVALID_RELEASE_SOURCE", "Injected release base URL must be loopback HTTP(S)");
  } else if (baseUrl.protocol !== "https:" || baseUrl.hostname !== "gitee.com") {
    fail("INVALID_RELEASE_SOURCE", "Production Gitee release URLs must use https://gitee.com");
  }
  const version = options.tag.slice(1);
  const stem = "rental-price-agent-v" + version;
  return {
    owner: options.owner, repo: options.repo, tag: options.tag, version, targetDir, stagingDir,
    baseUrl, injected,
    names: { archive: stem + ".tgz", manifest: stem + ".manifest.json", checksum: stem + ".sha256" },
  };
}

function canonicalExistingAncestor(entryPath) {
  let current = path.resolve(entryPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) fail("INVALID_STAGING_PATH", "No existing ancestor was found for staging");
    current = parent;
  }
  const stat = fs.lstatSync(current);
  if (!stat.isDirectory()) fail("INVALID_STAGING_PATH", "Staging ancestor is not a directory");
  return fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
}

function cleanupStalePartial(stagingDir) {
  archiveValidator.removeOwnedPartial(stagingDir + ".partial");
}

function buildAssetUrl(source, assetName) {
  const url = new URL(source.baseUrl.href);
  url.pathname = ["", source.owner, source.repo, "releases", "download", source.tag, assetName].map((segment, index) => index === 0 ? "" : encodeURIComponent(segment)).join("/");
  url.search = "";
  url.hash = "";
  return url;
}

function assertRequestUrl(url, source) {
  if (source.injected) {
    if (!/^https?:$/.test(url.protocol) || !isLoopback(url.hostname)) fail("UNTRUSTED_REDIRECT", "Test release redirects must remain on loopback");
  } else if (url.protocol !== "https:" || (url.hostname !== "gitee.com" && !url.hostname.endsWith(".gitee.com"))) {
    fail("UNTRUSTED_REDIRECT", "Production release redirects must remain on HTTPS Gitee hosts");
  }
}

function download(url, options, source, redirects = 0) {
  assertRequestUrl(url, source);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  const maxRedirects = Number(options.maxRedirects === undefined ? DEFAULT_MAX_REDIRECTS : options.maxRedirects);
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    let settled = false;
    const rejectOnce = error => { if (!settled) { settled = true; reject(error); } };
    const request = client.get(url, { headers: { accept: options.accept || "*/*", "user-agent": "rental-price-agent-lifecycle/1" } }, response => {
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        if (redirects >= maxRedirects) return rejectOnce(new ReleaseSourceError("TOO_MANY_REDIRECTS", "Release download exceeded redirect limit"));
        const location = response.headers.location;
        if (!location) return rejectOnce(new ReleaseSourceError("INVALID_REDIRECT", "Release redirect omitted Location"));
        let redirected;
        try { redirected = new URL(location, url); } catch { return rejectOnce(new ReleaseSourceError("INVALID_REDIRECT", "Release redirect Location is malformed")); }
        settled = true;
        return Promise.resolve().then(() => download(redirected, options, source, redirects + 1)).then(resolve, reject);
      }
      if (status !== 200) {
        response.resume();
        return rejectOnce(new ReleaseSourceError("RELEASE_HTTP_STATUS", "Release asset returned HTTP " + status, { url: url.href, status }));
      }
      const declaredLength = Number(response.headers["content-length"] || 0);
      if (declaredLength > maxBytes) {
        rejectOnce(new ReleaseSourceError("RELEASE_TOO_LARGE", "Release asset exceeds the configured byte limit"));
        response.destroy();
        return;
      }
      const chunks = [];
      let received = 0;
      response.on("data", chunk => {
        received += chunk.length;
        if (received > maxBytes) {
          rejectOnce(new ReleaseSourceError("RELEASE_TOO_LARGE", "Release asset exceeds the configured byte limit"));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on("aborted", () => rejectOnce(new ReleaseSourceError("PARTIAL_RELEASE_DOWNLOAD", "Release asset download was interrupted")));
      response.on("error", error => rejectOnce(new ReleaseSourceError("PARTIAL_RELEASE_DOWNLOAD", "Release asset download failed: " + error.message)));
      response.on("end", () => {
        if (settled) return;
        if (declaredLength && declaredLength !== received) return rejectOnce(new ReleaseSourceError("PARTIAL_RELEASE_DOWNLOAD", "Release asset length did not match Content-Length"));
        settled = true;
        resolve({ body: Buffer.concat(chunks), headers: response.headers, url: url.href });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new ReleaseSourceError("RELEASE_TIMEOUT", "Release asset request timed out")));
    request.on("error", error => rejectOnce(error instanceof ReleaseSourceError ? error : new ReleaseSourceError("RELEASE_DOWNLOAD_FAILED", error.message)));
  });
}

function assertContent(response, kind) {
  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  const preview = response.body.subarray(0, 256).toString("utf8").trim().toLowerCase();
  if (!response.body.length || contentType.includes("text/html") || /^<!doctype html|^<html/.test(preview)) {
    fail("UNEXPECTED_RELEASE_CONTENT", "Release " + kind + " response is empty or HTML");
  }
  if (kind === "manifest" && !/(?:application\/json|text\/plain|application\/octet-stream)/.test(contentType)) {
    fail("UNEXPECTED_RELEASE_CONTENT", "Release manifest has an unexpected content type");
  }
  if (kind === "archive" && response.body.subarray(0, 2).toString("hex") !== "1f8b") {
    fail("UNEXPECTED_RELEASE_CONTENT", "Release archive is not gzip content");
  }
}

function parseManifest(body, source) {
  let manifest;
  try { manifest = JSON.parse(body.toString("utf8")); } catch { fail("INVALID_RELEASE_MANIFEST", "Release manifest is malformed JSON"); }
  const richKeys = ["assets", "generationFormatVersion", "name", "package", "repository", "schemaVersion", "tag", "version", "versions"];
  const keys = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? Object.keys(manifest).sort().join("\0") : "";
  const rich = keys === richKeys.sort().join("\0") && manifest.schemaVersion === 2 && manifest.generationFormatVersion === 1;
  if (!rich || manifest.name !== "rental-price-agent"
      || manifest.tag !== source.tag || manifest.version !== source.version
      || !Array.isArray(manifest.assets) || manifest.assets.length !== 1) {
    fail("INVALID_RELEASE_MANIFEST", "Release manifest identity or shape is invalid");
  }
  const asset = manifest.assets[0];
  const expectedAssetKeys = ["bytes", "name", "sha256"];
  const assetSize = asset && asset.bytes;
  if (!asset || Object.keys(asset).sort().join("\0") !== expectedAssetKeys.sort().join("\0")
      || asset.name !== source.names.archive || !Number.isSafeInteger(assetSize) || assetSize <= 0
      || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    fail("INVALID_RELEASE_MANIFEST", "Release manifest must contain exactly the deterministic archive asset");
  }
  const repositoryKeys = ["owner", "provider", "repo", "tag"];
  const versionKeys = ["configSchema", "daemon", "protocol", "skill", "stateSchema"];
  const packageKeys = ["files", "lockSha256", "treeSha256"];
  if (!manifest.repository || Object.keys(manifest.repository).sort().join("\0") !== repositoryKeys.sort().join("\0")
      || manifest.repository.provider !== "gitee" || manifest.repository.owner !== source.owner
      || manifest.repository.repo !== source.repo || manifest.repository.tag !== source.tag
      || !manifest.versions || Object.keys(manifest.versions).sort().join("\0") !== versionKeys.sort().join("\0")
      || manifest.versions.skill !== source.version
      || !manifest.package || Object.keys(manifest.package).sort().join("\0") !== packageKeys.sort().join("\0")) {
    fail("INVALID_RELEASE_MANIFEST", "Rich release manifest metadata is invalid");
  }
  try { archiveValidator.validateExternalManifest(manifest); } catch (error) {
    fail("INVALID_RELEASE_MANIFEST", "Release manifest package inventory is invalid", { cause: error.code });
  }
  return { manifest, asset: { ...asset, size: assetSize } };
}

function parseChecksum(body, expectedName) {
  if (!Buffer.isBuffer(body) || [...body].some(byte => byte > 0x7f)) fail("INVALID_RELEASE_CHECKSUM", "Checksum asset must be canonical ASCII");
  const text = body.toString("ascii");
  const match = /^([a-f0-9]{64}) {2}([^\r\n]+)\n$/.exec(text);
  if (!match || match[2] !== expectedName) fail("INVALID_RELEASE_CHECKSUM", "Checksum asset must contain exactly one deterministic archive entry");
  return match[1];
}

function equalHash(left, right) {
  return /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right)
    && crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

async function stageGiteeRelease(options = {}) {
  const source = validateSource(options);
  cleanupStalePartial(source.stagingDir);
  const manifestResponse = await download(buildAssetUrl(source, source.names.manifest), { timeoutMs: options.timeoutMs, maxBytes: Math.min(Number(options.maxBytes || DEFAULT_MAX_BYTES), 64 * 1024), maxRedirects: options.maxRedirects, accept: "application/json" }, source);
  assertContent(manifestResponse, "manifest");
  const { manifest, asset } = parseManifest(manifestResponse.body, source);
  const checksumResponse = await download(buildAssetUrl(source, source.names.checksum), { timeoutMs: options.timeoutMs, maxBytes: 1024, maxRedirects: options.maxRedirects, accept: "text/plain" }, source);
  assertContent(checksumResponse, "checksum");
  const checksumHash = parseChecksum(checksumResponse.body, source.names.archive);
  if (!equalHash(asset.sha256, checksumHash)) fail("RELEASE_HASH_MISMATCH", "Manifest and checksum asset hashes do not match");
  if (asset.size > Number(options.maxBytes || DEFAULT_MAX_BYTES)) fail("RELEASE_TOO_LARGE", "Manifest-declared archive size exceeds the configured limit");
  const archiveResponse = await download(buildAssetUrl(source, source.names.archive), { timeoutMs: options.timeoutMs, maxBytes: options.maxBytes, maxRedirects: options.maxRedirects, accept: "application/gzip, application/octet-stream" }, source);
  assertContent(archiveResponse, "archive");
  if (archiveResponse.body.length !== asset.size) fail("PARTIAL_RELEASE_DOWNLOAD", "Downloaded archive size does not match the release manifest");
  const actualHash = crypto.createHash("sha256").update(archiveResponse.body).digest("hex");
  if (!equalHash(actualHash, asset.sha256)) fail("RELEASE_HASH_MISMATCH", "Downloaded archive SHA-256 does not match the release manifest");

  const stalePartial = source.stagingDir + ".partial";
  try {
    const staged = archiveValidator.validateAndStageArchive({
      archive: archiveResponse.body,
      stagingDir: source.stagingDir,
      tag: source.tag,
      version: source.version,
      maxExpandedBytes: options.maxExpandedBytes,
      manifest,
    });
    return {
      owner: source.owner, repo: source.repo, tag: source.tag, version: source.version,
      archiveName: source.names.archive, manifestName: source.names.manifest, checksumName: source.names.checksum,
      sha256: actualHash, size: archiveResponse.body.length, stagePath: staged.stagePath,
      entries: staged.entries,
    };
  } catch (error) {
    const stat = (() => { try { return fs.lstatSync(stalePartial); } catch (caught) { if (caught.code === "ENOENT") return null; throw caught; } })();
    if (stat && !stat.isSymbolicLink()) fs.rmSync(stalePartial, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  ReleaseSourceError,
  buildAssetUrl,
  cleanupStalePartial,
  parseChecksum,
  parseManifest,
  stageGiteeRelease,
  validateSource,
};
