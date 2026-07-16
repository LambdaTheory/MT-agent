const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

async function withRelease(helpers, overrides, run) {
  const fixture = helpers.createReleaseFixture(Object.assign({ owner: "owner", repo: "repository" }, overrides));
  const stem = "/owner/repository/releases/download/" + fixture.manifest.tag + "/";
  const routes = Object.assign({
    [stem + fixture.archiveName]: { body: fixture.archive, headers: { "content-type": "application/gzip" } },
    [stem + fixture.manifestName]: { body: fixture.manifestBody, headers: { "content-type": "application/json" } },
    [stem + fixture.checksumName]: { body: fixture.checksumBody, headers: { "content-type": "text/plain" } },
  }, overrides && overrides.routes);
  const server = await helpers.startFakeGiteeServer({ routes });
  try {
    return await run({ fixture, server, stem });
  } finally {
    await server.stop();
  }
}

async function expectFailure(assert, promise, code) {
  await assert.rejects(promise, error => error && error.code === code, code);
}

async function withArchive(helpers, files, run) {
  const archive = helpers.support.createTarGz(files);
  const hash = helpers.sha256(archive);
  const fixture = helpers.createReleaseFixture({});
  const manifest = {
    schemaVersion: 1,
    name: "rental-price-agent",
    version: "1.0.0",
    tag: "v1.0.0",
    assets: [{ name: fixture.archiveName, size: archive.length, sha256: hash }],
  };
  const stem = "/owner/repository/releases/download/v1.0.0/";
  const server = await helpers.startFakeGiteeServer({ routes: {
    [stem + fixture.manifestName]: { body: JSON.stringify(manifest), headers: { "content-type": "application/json" } },
    [stem + fixture.checksumName]: { body: hash + "  " + fixture.archiveName + "\n", headers: { "content-type": "text/plain" } },
    [stem + fixture.archiveName]: { body: archive, headers: { "content-type": "application/gzip" } },
  } });
  try {
    return await run(server);
  } finally {
    await server.stop();
  }
}

async function register({ test, assert, helpers }) {
  const skillDir = path.resolve(__dirname, "..", "..", "..");
  const archiveValidator = require(path.join(skillDir, "scripts", "lib", "archive-validator"));
  const releaseSource = require(path.join(skillDir, "scripts", "lib", "release-source"));

  function stageOptions(root, server, tag = "v1.0.0", extra = {}) {
    return Object.assign({
      owner: "owner", repo: "repository", tag,
      targetDir: path.join(root, "active"),
      stagingDir: path.join(root, "staging", "release"),
      baseUrl: server.url,
      platform: "win32",
      timeoutMs: 500,
      maxBytes: 1024 * 1024,
      maxExpandedBytes: 2 * 1024 * 1024,
      maxRedirects: 2,
    }, extra);
  }

  test("release-download-valid-stage", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "release-valid" });
    await withRelease(helpers, {}, async ({ fixture, server }) => {
      const activeHash = await helpers.hashTree(lifecycle.paths.active);
      const result = await releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server));
      assert.equal(result.tag, "v1.0.0");
      assert.equal(result.sha256, helpers.sha256(fixture.archive));
      assert.equal(fs.existsSync(path.join(result.stagePath, "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(result.stagePath, "package.json")), true);
      assert.equal(await helpers.hashTree(lifecycle.paths.active), activeHash);
      helpers.recordProof("validReleaseStagedWithoutActivation", true);
    });
  });

  test("release-download-html-200", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "html-200" });
    await withRelease(helpers, { routes: { "/owner/repository/releases/download/v1.0.0/rental-price-agent-v1.0.0.manifest.json": { body: "<html>login</html>", headers: { "content-type": "text/html" } } } }, async ({ server }) => {
      await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server)), "UNEXPECTED_RELEASE_CONTENT");
    });
  });

  test("release-download-missing-manifest-entry", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "missing-manifest" });
    await withRelease(helpers, { manifest: { schemaVersion: 1, name: "rental-price-agent", version: "1.0.0", tag: "v1.0.0", assets: [] } }, async ({ server }) => {
      await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server)), "INVALID_RELEASE_MANIFEST");
    });
  });

  test("release-download-duplicate-manifest-entry", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "duplicate-manifest" });
    const name = "rental-price-agent-v1.0.0.tgz";
    await withRelease(helpers, { manifest: { schemaVersion: 1, name: "rental-price-agent", version: "1.0.0", tag: "v1.0.0", assets: [{ name, size: 1, sha256: "a".repeat(64) }, { name, size: 1, sha256: "a".repeat(64) }] } }, async ({ server }) => {
      await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server)), "INVALID_RELEASE_MANIFEST");
    });
  });

  test("release-download-hash-mismatch", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "hash-mismatch" });
    const checksumPath = "/owner/repository/releases/download/v1.0.0/rental-price-agent-v1.0.0.sha256";
    await withRelease(helpers, { routes: { [checksumPath]: { body: "0".repeat(64) + "  rental-price-agent-v1.0.0.tgz\n", headers: { "content-type": "text/plain" } } } }, async ({ server }) => {
      await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server)), "RELEASE_HASH_MISMATCH");
    });
  });

  test("release-download-checksum-requires-one canonical ASCII line", async () => {
    const name = "rental-price-agent-v1.0.0.tgz";
    const hash = "a".repeat(64);
    assert.equal(releaseSource.parseChecksum(Buffer.from(hash + "  " + name + "\n", "ascii"), name), hash);
    for (const body of [
      hash.toUpperCase() + "  " + name + "\n",
      hash + "  " + name + "\r\n",
      hash + "  " + name,
      hash + "\t" + name + "\n",
      hash + "   " + name + "\n",
      hash + "  " + name + "\n" + hash + "  other.tgz\n",
      hash + "  " + name + "\n\u00e9",
    ]) assert.throws(() => releaseSource.parseChecksum(Buffer.from(body), name), error => error.code === "INVALID_RELEASE_CHECKSUM", JSON.stringify(body));
  });

  test("release-download-schema-2 manifest requires exact normalized file records", async () => {
    const source = releaseSource.validateSource({
      owner: "owner", repo: "repository", tag: "v1.0.0", platform: "win32",
      targetDir: path.resolve("active"), stagingDir: path.resolve("staging"), volumeResolver: () => "C:",
    });
    const valid = helpers.createReleaseFixture({ owner: "owner", repo: "repository" }).manifest;
    assert.equal(releaseSource.parseManifest(Buffer.from(JSON.stringify(valid)), source).manifest.schemaVersion, 2);
    const mutations = [
      manifest => { manifest.package.files = []; },
      manifest => { manifest.package.files.push({ ...manifest.package.files[0] }); },
      manifest => { delete manifest.package.files[0].mode; },
      manifest => { manifest.package.files[0].path = "scripts/../evil.js"; },
      manifest => { manifest.package.files[0].sha256 = "0".repeat(64); },
    ];
    for (const mutate of mutations) {
      const manifest = JSON.parse(JSON.stringify(valid));
      mutate(manifest);
      assert.throws(() => releaseSource.parseManifest(Buffer.from(JSON.stringify(manifest)), source), error => error.code === "INVALID_RELEASE_MANIFEST");
    }
  });

  test("release-download-partial-and-oversize", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "partial-oversize" });
    await withRelease(helpers, {}, async ({ fixture, server, stem }) => {
      await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server, "v1.0.0", { maxBytes: fixture.archive.length - 1 })), "RELEASE_TOO_LARGE");
      assert.equal(fs.existsSync(path.join(lifecycle.paths.staging, "release.partial")), false);
      await server.stop();
      const partialServer = await helpers.startFakeGiteeServer({ routes: {
        [stem + fixture.manifestName]: { body: fixture.manifestBody, headers: { "content-type": "application/json" } },
        [stem + fixture.checksumName]: { body: fixture.checksumBody, headers: { "content-type": "text/plain" } },
        [stem + fixture.archiveName]: { body: fixture.archive, closeAfterBytes: Math.max(1, Math.floor(fixture.archive.length / 2)), headers: { "content-type": "application/gzip" } },
      } });
      try {
        await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, partialServer)), "PARTIAL_RELEASE_DOWNLOAD");
      } finally { await partialServer.stop(); }
    });
  });

  test("release-download-bounded-redirects", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "redirects" });
    const route = "/owner/repository/releases/download/v1.0.0/rental-price-agent-v1.0.0.manifest.json";
    const server = await helpers.startFakeGiteeServer({ routes: { [route]: { status: 302, headers: { location: route }, body: "redirect" } } });
    try {
      await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server, "v1.0.0", { maxRedirects: 1 })), "TOO_MANY_REDIRECTS");
    } finally { await server.stop(); }
  });

  test("release-download-untrusted-redirect-rejects-without-process-crash", async () => {
    for (const location of ["http://gitee.com/downgrade", "https://example.com/cross-host"]) {
      const script = [
        "const EventEmitter = require('events');",
        "const https = require('https');",
        "https.get = (url, options, callback) => {",
        "  const request = new EventEmitter();",
        "  request.setTimeout = () => request;",
        "  setImmediate(() => {",
        "    const response = new EventEmitter();",
        "    response.statusCode = 302;",
        "    response.headers = { location: " + JSON.stringify(location) + " };",
        "    response.resume = () => {};",
        "    callback(response);",
        "  });",
        "  return request;",
        "};",
        "const releaseSource = require(" + JSON.stringify(path.join(skillDir, "scripts", "lib", "release-source")) + ");",
        "const path = require('path');",
        "releaseSource.stageGiteeRelease({",
        "  owner: 'owner', repo: 'repository', tag: 'v1.0.0', platform: 'win32',",
        "  targetDir: path.resolve('active'), stagingDir: path.resolve('staging'), volumeResolver: () => 'C:'",
        "}).then(() => process.exit(2), error => {",
        "  process.stdout.write(JSON.stringify({ code: error && error.code }));",
        "  process.exit(error && error.code === 'UNTRUSTED_REDIRECT' ? 0 : 3);",
        "});",
      ].join("\n");
      const result = childProcess.spawnSync(process.execPath, ["-e", script], {
        cwd: skillDir,
        encoding: "utf8",
        timeout: 2000,
        windowsHide: true,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(JSON.parse(result.stdout), { code: "UNTRUSTED_REDIRECT" });
    }
  });

  test("release-download-timeout", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "timeout" });
    const route = "/owner/repository/releases/download/v1.0.0/rental-price-agent-v1.0.0.manifest.json";
    const server = await helpers.startFakeGiteeServer({ routes: { [route]: { hang: true } } });
    try {
      await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server, "v1.0.0", { timeoutMs: 50 })), "RELEASE_TIMEOUT");
    } finally { await server.stop(); }
  });

  test("release-download-stream-oversize-is-deterministic", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "stream-oversize" });
    const route = "/owner/repository/releases/download/v1.0.0/rental-price-agent-v1.0.0.manifest.json";
    const oversized = Buffer.alloc(257, 0x61);
    const server = await helpers.startFakeGiteeServer({ routes: {
      [route]: { body: oversized, chunked: true, splitAt: 128, headers: { "content-type": "application/json" } },
    } });
    try {
      await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server, "v1.0.0", { maxBytes: 256 })), "RELEASE_TOO_LARGE");
    } finally {
      await server.stop();
    }
  });

  test("release-download-allowlist excludes mutable and derived content", async () => {
    for (const excluded of ["config.json", ".env", ".omo", "tasks", "browser-profile", "browser-cache", "daemon", "node_modules"]) {
      assert.equal(archiveValidator.ALLOWED_TOP_LEVEL.has(excluded), false, excluded);
    }
    const mutableEntries = [
      "rental-price-agent/config.json",
      "rental-price-agent/.env",
      "rental-price-agent/tasks/state.json",
      "rental-price-agent/browser-profile/Default/Preferences",
      "rental-price-agent/browser-cache/index",
      "rental-price-agent/daemon/identity.json",
      "rental-price-agent/install-receipt.json",
      "rental-price-agent/lifecycle-journal.json",
      "rental-price-agent/lifecycle.lock",
      "rental-price-agent/.omo/evidence/task.json",
      "rental-price-agent/node_modules/playwright/package.json",
    ];
    for (const entry of mutableEntries) {
      assert.throws(() => archiveValidator.normalizeArchivePath(entry), error => error && error.code === "UNSAFE_ARCHIVE_ENTRY", entry);
    }
  });

  const unsafeCases = [
    ["archive-path-traversal", "../outside.txt", { content: "bad" }],
    ["archive-absolute-path", "C:/outside.txt", { content: "bad" }],
    ["archive-link-entry", "rental-price-agent/link", { type: "2", linkName: "SKILL.md" }],
    ["archive-mutable-content", "rental-price-agent/config.json", { content: "{}" }],
    ["archive-reserved-windows-path", "rental-price-agent/scripts/CON.txt", { content: "bad" }],
    ["archive-wrong-layout", "other-package/SKILL.md", { content: "bad" }],
  ];
  for (const [name, entryName, descriptor] of unsafeCases) {
    test(name, async () => {
      const lifecycle = await helpers.createLifecycleFixture({ name });
      const files = { [entryName]: descriptor };
      await withRelease(helpers, { files }, async ({ server }) => {
        const outside = path.join(lifecycle.root, "outside.txt");
        await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server)), "UNSAFE_ARCHIVE_ENTRY");
        assert.equal(fs.existsSync(outside), false);
      });
    });
  }

  const requiredLayoutCases = [
    ["archive-missing-root-directory-entry", {
      "rental-price-agent/SKILL.md": "# Skill\n",
      "rental-price-agent/package.json": JSON.stringify({ name: "rental-price-agent", version: "1.0.0" }),
      "rental-price-agent/release-manifest.json": JSON.stringify({ manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v1.0.0", skillVersion: "1.0.0" }),
      "rental-price-agent/scripts/": { type: "5" },
    }],
    ["archive-missing-skill-file", {
      "rental-price-agent/": { type: "5" },
      "rental-price-agent/package.json": JSON.stringify({ name: "rental-price-agent", version: "1.0.0" }),
      "rental-price-agent/release-manifest.json": JSON.stringify({ manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v1.0.0", skillVersion: "1.0.0" }),
      "rental-price-agent/scripts/": { type: "5" },
    }],
    ["archive-skill-must-be-regular-file", {
      "rental-price-agent/": { type: "5" },
      "rental-price-agent/SKILL.md/": { type: "5" },
      "rental-price-agent/package.json": JSON.stringify({ name: "rental-price-agent", version: "1.0.0" }),
      "rental-price-agent/release-manifest.json": JSON.stringify({ manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v1.0.0", skillVersion: "1.0.0" }),
      "rental-price-agent/scripts/": { type: "5" },
    }],
    ["archive-missing-package-json", {
      "rental-price-agent/": { type: "5" },
      "rental-price-agent/SKILL.md": "# Skill\n",
      "rental-price-agent/release-manifest.json": JSON.stringify({ manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v1.0.0", skillVersion: "1.0.0" }),
      "rental-price-agent/scripts/": { type: "5" },
    }],
    ["archive-missing-release-manifest", {
      "rental-price-agent/": { type: "5" },
      "rental-price-agent/SKILL.md": "# Skill\n",
      "rental-price-agent/package.json": JSON.stringify({ name: "rental-price-agent", version: "1.0.0" }),
      "rental-price-agent/scripts/": { type: "5" },
    }],
    ["archive-missing-scripts-directory", {
      "rental-price-agent/": { type: "5" },
      "rental-price-agent/SKILL.md": "# Skill\n",
      "rental-price-agent/package.json": JSON.stringify({ name: "rental-price-agent", version: "1.0.0" }),
      "rental-price-agent/release-manifest.json": JSON.stringify({ manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v1.0.0", skillVersion: "1.0.0" }),
    }],
    ["archive-scripts-must-be-directory", {
      "rental-price-agent/": { type: "5" },
      "rental-price-agent/SKILL.md": "# Skill\n",
      "rental-price-agent/package.json": JSON.stringify({ name: "rental-price-agent", version: "1.0.0" }),
      "rental-price-agent/release-manifest.json": JSON.stringify({ manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v1.0.0", skillVersion: "1.0.0" }),
      "rental-price-agent/scripts": "not-a-directory",
    }],
    ["archive-required-json-must-be-regular-files", {
      "rental-price-agent/": { type: "5" },
      "rental-price-agent/SKILL.md": "# Skill\n",
      "rental-price-agent/package.json/": { type: "5" },
      "rental-price-agent/release-manifest.json": JSON.stringify({ manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v1.0.0", skillVersion: "1.0.0" }),
      "rental-price-agent/scripts/": { type: "5" },
    }],
  ];
  for (const [name, files] of requiredLayoutCases) {
    test(name, async () => {
      assert.throws(() => archiveValidator.parseArchive(helpers.support.createTarGz(files)), error => error.code === "INVALID_ARCHIVE_LAYOUT");
    });
  }

  test("archive-duplicate-normalized-path", async () => {
    const archive = helpers.support.createTarGz({
      "rental-price-agent/SKILL.md": "one",
      "rental-price-agent/skill.md": "two",
      "rental-price-agent/package.json": JSON.stringify({ name: "rental-price-agent", version: "1.0.0" }),
      "rental-price-agent/release-manifest.json": JSON.stringify({ manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v1.0.0", skillVersion: "1.0.0" }),
    });
    assert.throws(() => archiveValidator.parseArchive(archive), error => error.code === "UNSAFE_ARCHIVE_ENTRY");
  });

  test("archive-manifest allowlist rejects unknown nested, mutable nested, NFC collisions, and inconsistent hashes", async () => {
    const fixture = helpers.createReleaseFixture({});
    const { manifest } = fixture;
    const unknown = helpers.support.createTarGz({
      ...fixture.files,
      "rental-price-agent/scripts/nested/unknown.js": "bad\n",
    });
    assert.throws(() => archiveValidator.parseArchive(unknown, { manifest }), error => error.code === "ARCHIVE_MANIFEST_MISMATCH" || error.code === "UNSAFE_ARCHIVE_ENTRY");

    const mutable = helpers.support.createTarGz({
      ...fixture.files,
      "rental-price-agent/scripts/tasks/state.json": "bad\n",
    });
    assert.throws(() => archiveValidator.parseArchive(mutable, { manifest }), error => error.code === "UNSAFE_ARCHIVE_ENTRY");

    const nfc = helpers.support.createTarGz({
      ...fixture.files,
      "rental-price-agent/scripts/caf\u00e9.js": "one\n",
      "rental-price-agent/scripts/cafe\u0301.js": "two\n",
    });
    assert.throws(() => archiveValidator.parseArchive(nfc, { manifest }), error => error.code === "UNSAFE_ARCHIVE_ENTRY");

    const inconsistent = JSON.parse(JSON.stringify(manifest));
    inconsistent.package.files[0].sha256 = "0".repeat(64);
    assert.throws(() => archiveValidator.parseArchive(fixture.archive, { manifest: inconsistent }), error => error.code === "ARCHIVE_MANIFEST_MISMATCH");
  });

  test("release-download-cross-volume", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "cross-volume" });
    await withRelease(helpers, {}, async ({ server }) => {
      const options = stageOptions(lifecycle.root, server, "v1.0.0", { volumeResolver: value => value.includes("staging") ? "D:" : "C:" });
      await expectFailure(assert, releaseSource.stageGiteeRelease(options), "CROSS_VOLUME_STAGING");
    });
  });

  test("release-download-tag-mismatch", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "tag-mismatch" });
    await withRelease(helpers, { releaseManifest: { manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v2.0.0", skillVersion: "1.0.0" } }, async ({ server }) => {
      await expectFailure(assert, releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server)), "RELEASE_IDENTITY_MISMATCH");
    });
  });

  test("release-download-input-and-stale-partial-probes", async () => {
    const lifecycle = await helpers.createLifecycleFixture({ name: "input-probes" });
    await assert.rejects(releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, { url: "http://127.0.0.1" }, "master")), error => error.code === "INVALID_RELEASE_TAG");
    await assert.rejects(releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, { url: "http://127.0.0.1" }, "v1.0.0", { owner: "../evil" })), error => error.code === "INVALID_RELEASE_SOURCE");
    const stale = path.join(lifecycle.paths.staging, "release.partial");
    fs.writeFileSync(stale, "unowned");
    await assert.rejects(releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, { url: "http://127.0.0.1" })), error => error.code === "UNSAFE_STAGING_PATH");
    fs.unlinkSync(stale);
    fs.mkdirSync(stale);
    fs.writeFileSync(path.join(stale, ".rental-price-agent-staging-partial"), "rental-price-agent-staging-v1\n");
    await withRelease(helpers, {}, async ({ server }) => {
      const result = await releaseSource.stageGiteeRelease(stageOptions(lifecycle.root, server));
      assert.equal(fs.existsSync(stale), false);
      assert.equal(fs.existsSync(result.stagePath), true);
    });
  });

  test("release-download-unsupported-platform", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-platform-"));
    try {
      await assert.rejects(releaseSource.stageGiteeRelease({ owner: "owner", repo: "repo", tag: "v1.0.0", targetDir: path.join(root, "active"), stagingDir: path.join(root, "stage"), platform: "linux" }), error => error.code === "UNSUPPORTED_PLATFORM");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

module.exports = { register };
