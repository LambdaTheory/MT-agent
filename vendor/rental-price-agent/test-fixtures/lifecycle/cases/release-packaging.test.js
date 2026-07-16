const fs = require("fs")
const childProcess = require("child_process")
const os = require("os")
const path = require("path")
const zlib = require("zlib")

const builder = require("../../../scripts/build-release.js")
const archiveValidator = require("../../../scripts/lib/archive-validator.js")

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..")

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rpa-packaging-" + name + "-"))
}

function copyReleaseSource(destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const directory of builder.RELEASE_DIRECTORIES) fs.mkdirSync(path.join(destination, ...directory.split("/")), { recursive: true })
  for (const relativePath of builder.RELEASE_FILES) {
    const target = path.join(destination, ...relativePath.split("/"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(SKILL_DIR, ...relativePath.split("/")), target)
  }
}

function readAssets(outputDir) {
  return fs.readdirSync(outputDir).sort().map(name => ({ name, body: fs.readFileSync(path.join(outputDir, name)) }))
}

async function register({ test, assert, helpers }) {
  test("release-packaging: strict inventory rejects mutable, traversal, case collisions, links, and allowlist drift", async () => {
    assert.throws(() => builder.validateLogicalPaths(["config.json"]), error => error.code === "FORBIDDEN_RELEASE_COMPONENT")
    assert.throws(() => builder.validateLogicalPaths(["README.md", "readme.md"]), error => error.code === "RELEASE_PATH_COLLISION")
    assert.throws(() => builder.validateLogicalPaths(["references/caf\u00e9.md", "references/cafe\u0301.md"]), error => error.code === "RELEASE_PATH_COLLISION")
    assert.throws(() => builder.validateLogicalPaths(["scripts/name", "scripts/name. "]), error => error.code === "RELEASE_PATH_COLLISION" || error.code === "UNSAFE_RELEASE_PATH")
    assert.throws(() => builder.normalizeRelative("../outside"), error => error.code === "UNSAFE_RELEASE_PATH")
    assert.throws(() => builder.assertPlainFile({ isSymbolicLink: () => true, isFile: () => false }, "scripts/link.js"), error => error.code === "RELEASE_LINK_REJECTED")
    assert.throws(() => builder.validateReleaseAllowlist(builder.RELEASE_FILES.concat("config.json")), error => error.code === "FORBIDDEN_RELEASE_COMPONENT" || error.code === "RELEASE_ALLOWLIST_CHANGED")
    for (const excluded of ["config.json", ".env", ".git", ".omo", "test-fixtures", "node_modules", "tasks", "browser-profile", "browser-cache", "daemon"] ) {
      assert.equal(builder.RELEASE_FILES.some(item => item === excluded || item.startsWith(excluded + "/")), false, excluded)
    }
  })

  test("release-packaging: deterministic USTAR archive and rich manifest use normalized metadata", async () => {
    const root = tempRoot("deterministic")
    const first = path.join(root, "first")
    const second = path.join(root, "second")
    try {
      const one = await builder.buildRelease({ outputDir: first, runGates: false })
      const two = await builder.buildRelease({ outputDir: second, runGates: false })
      assert.deepEqual(one.hashes, two.hashes)
      const firstAssets = readAssets(first)
      const secondAssets = readAssets(second)
      assert.deepEqual(firstAssets, secondAssets)
      const archive = firstAssets.find(asset => asset.name.endsWith(".tgz")).body
      assert.equal(archive.readUInt32LE(4), 0)
      assert.equal(archive[9], 255)
      const entries = archiveValidator.parseArchive(archive)
      assert.equal(entries.some(entry => /(?:config\.json|test-fixtures|node_modules|\.omo|\.git)/i.test(entry.relativeName)), false)
      assert.equal(entries.some(entry => entry.relativeName === "scripts/lib/lifecycle-test-instrumentation.js"), true)
      assert.equal(entries.some(entry => entry.relativeName === "scripts/lib/target-migration.json"), true)
      assert.equal(entries.some(entry => entry.relativeName === "scripts/lib/target-migration.js"), false)
      assert.equal(entries.some(entry => entry.relativeName === "scripts/lib/lifecycle-test-preload.js"), false)
      assert.equal(entries.some(entry => entry.relativeName === "scripts/lib/lifecycle-test-support.js"), false)
      const tar = zlib.gunzipSync(archive)
      for (let offset = 0; offset + 512 <= tar.length; ) {
        const header = tar.subarray(offset, offset + 512)
        if (header.every(byte => byte === 0)) break
        assert.equal(header.subarray(108, 116).toString("ascii").replace(/\0.*$/, "").trim(), "0000000")
        assert.equal(header.subarray(116, 124).toString("ascii").replace(/\0.*$/, "").trim(), "0000000")
        assert.equal(header.subarray(136, 148).toString("ascii").replace(/\0.*$/, "").trim(), "00000000000")
        assert.equal(header.subarray(257, 263).toString("ascii"), "ustar\0")
        const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim()
        const size = sizeText ? Number.parseInt(sizeText, 8) : 0
        offset += 512 + Math.ceil(size / 512) * 512
      }
      const manifest = JSON.parse(firstAssets.find(asset => asset.name.endsWith(".manifest.json")).body)
      assert.equal(manifest.generationFormatVersion, 1)
      assert.equal(manifest.repository.owner, "lcc0628")
      assert.equal(manifest.repository.repo, "rental-price-agent")
      assert.equal(manifest.versions.skill, "1.0.0")
      assert.match(manifest.package.lockSha256, /^[a-f0-9]{64}$/)
      assert.match(manifest.package.treeSha256, /^[a-f0-9]{64}$/)
      assert.equal(manifest.package.files.length, builder.RELEASE_FILES.length)
      assert.deepEqual(Object.keys(manifest.assets[0]).sort(), ["bytes", "name", "sha256"])
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  test("release-packaging: separate Node processes produce byte-identical assets", async () => {
    const root = tempRoot("process-deterministic")
    try {
      const results = []
      for (let index = 0; index < 2; index++) {
        const output = path.join(root, "process-" + index)
        const script = [
          "const builder = require(" + JSON.stringify(path.join(SKILL_DIR, "scripts", "build-release.js")) + ")",
          "builder.buildRelease({ outputDir: " + JSON.stringify(output) + ", runGates: false }).then(",
          "  result => process.stdout.write(JSON.stringify(result.hashes)),",
          "  error => { process.stderr.write(error.stack || error.message); process.exit(1) },",
          ")",
        ].join("\n")
        const run = childProcess.spawnSync(process.execPath, ["-e", script], { cwd: SKILL_DIR, encoding: "utf8", timeout: 60000, windowsHide: true })
        assert.equal(run.status, 0, run.stderr || run.stdout)
        results.push({ hashes: JSON.parse(run.stdout), assets: readAssets(output) })
      }
      assert.deepEqual(results[0], results[1])
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  test("release-packaging: mutable source presence is excluded and unknown top-level entries fail closed", async () => {
    const root = tempRoot("source-shape")
    const source = path.join(root, "source")
    const output = path.join(root, "output")
    try {
      copyReleaseSource(source)
      fs.writeFileSync(path.join(source, "config.json"), "{\"secret\":true}\n")
      fs.writeFileSync(path.join(source, ".env"), "SECRET=must-not-read\n")
      fs.mkdirSync(path.join(source, "tasks"))
      const originalReadFileSync = fs.readFileSync
      fs.readFileSync = (...args) => {
        const candidate = path.resolve(String(args[0]))
        if (candidate === path.join(source, "config.json") || candidate === path.join(source, ".env")) throw new Error("excluded secret was read")
        return originalReadFileSync(...args)
      }
      try { await builder.buildRelease({ sourceDir: source, outputDir: output, runGates: false }) }
      finally { fs.readFileSync = originalReadFileSync }
      const archive = readAssets(output).find(asset => asset.name.endsWith(".tgz")).body
      assert.equal(archiveValidator.parseArchive(archive).some(entry => entry.relativeName === "config.json" || entry.relativeName.startsWith("tasks/")), false)
      fs.writeFileSync(path.join(source, "unclassified.bin"), "x")
      await assert.rejects(builder.buildRelease({ sourceDir: source, outputDir: path.join(root, "rejected"), runGates: false }), error => error.code === "UNKNOWN_RELEASE_TOP_LEVEL")
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  test("release-packaging: source CAS, output containment, and partial commit cleanup fail closed", async () => {
    const root = tempRoot("failures")
    const source = path.join(root, "source")
    try {
      copyReleaseSource(source)
      await assert.rejects(builder.buildRelease({ sourceDir: source, outputDir: path.join(source, "dist"), runGates: false }), error => error.code === "OUTPUT_INSIDE_SOURCE")
      const changedOutput = path.join(root, "changed")
      await assert.rejects(builder.buildRelease({
        sourceDir: source, outputDir: changedOutput, runGates: false,
        hook(event) { if (event.phase === "beforeCommit") fs.appendFileSync(path.join(source, "README.md"), "changed\n") },
      }), error => error.code === "SOURCE_CHANGED_DURING_BUILD")
      assert.equal(fs.existsSync(changedOutput) ? fs.readdirSync(changedOutput).length : 0, 0)
      fs.copyFileSync(path.join(SKILL_DIR, "README.md"), path.join(source, "README.md"))
      const partialOutput = path.join(root, "partial")
      const adapter = Object.create(fs)
      let renames = 0
      adapter.renameSync = (from, to) => { renames++; if (renames === 2) throw new Error("injected rename failure"); return fs.renameSync(from, to) }
      await assert.rejects(builder.buildRelease({ sourceDir: source, outputDir: partialOutput, runGates: false, fileSystem: adapter }), /injected rename failure/)
      assert.deepEqual(fs.readdirSync(partialOutput), [])
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  test("release-packaging: hardlinks, junction aliases, and post-snapshot shape changes fail closed", async () => {
    const root = tempRoot("identity-shape")
    const source = path.join(root, "source")
    try {
      copyReleaseSource(source)
      const outside = path.join(root, "outside-readme.md")
      fs.copyFileSync(path.join(source, "README.md"), outside)
      fs.unlinkSync(path.join(source, "README.md"))
      fs.linkSync(outside, path.join(source, "README.md"))
      await assert.rejects(builder.buildRelease({ sourceDir: source, outputDir: path.join(root, "hardlink-output"), runGates: false }), error => error.code === "RELEASE_HARDLINK_REJECTED")

      fs.unlinkSync(path.join(source, "README.md"))
      fs.copyFileSync(path.join(SKILL_DIR, "README.md"), path.join(source, "README.md"))
      const alias = path.join(root, "source-alias")
      fs.symlinkSync(source, alias, "junction")
      await assert.rejects(builder.buildRelease({ sourceDir: source, outputDir: path.join(alias, "dist"), runGates: false }), error => error.code === "OUTPUT_INSIDE_SOURCE" || error.code === "UNSAFE_RELEASE_OUTPUT")

      const output = path.join(root, "shape-output")
      await assert.rejects(builder.buildRelease({
        sourceDir: source, outputDir: output, runGates: false,
        hook(event) {
          if (event.phase === "beforeCommit") fs.writeFileSync(path.join(source, "scripts", "unclassified-added.js"), "module.exports = true\n")
        },
      }), error => error.code === "SOURCE_CHANGED_DURING_BUILD" || error.code === "UNKNOWN_RELEASE_COMPONENT")
      assert.equal(fs.existsSync(output) ? fs.readdirSync(output).length : 0, 0)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  test("release-packaging: every interrupted atomic write position removes all owned partials", async () => {
    const operations = ["openSync", "writeFileSync", "fsyncSync", "closeSync", "renameSync"]
    for (const operation of operations) {
      for (let failureAt = 1; failureAt <= 3; failureAt++) {
        const root = tempRoot("atomic-" + operation + "-" + failureAt)
        const source = path.join(root, "source")
        const output = path.join(root, "output")
        copyReleaseSource(source)
        const adapter = Object.create(fs)
        let calls = 0
        adapter[operation] = (...args) => {
          calls++
          if (calls !== failureAt) return fs[operation](...args)
          if (operation === "openSync") {
            const handle = fs.openSync(...args)
            fs.closeSync(handle)
          } else if (operation === "closeSync") {
            fs.closeSync(...args)
          }
          const error = new Error("injected " + operation + " failure " + failureAt)
          error.code = "EINJECTED"
          throw error
        }
        try {
          await assert.rejects(builder.buildRelease({ sourceDir: source, outputDir: output, runGates: false, fileSystem: adapter }), error => error.code === "EINJECTED")
          assert.deepEqual(fs.existsSync(output) ? fs.readdirSync(output) : [], [], operation + " #" + failureAt)
        } finally { fs.rmSync(root, { recursive: true, force: true }) }
      }
    }
  })

  test("release-packaging: generated assets self-install through loopback and verify receipt hashes", async () => {
    const root = tempRoot("self-install")
    try {
      const result = await builder.buildRelease({ outputDir: root, runGates: false, verify: true })
      assert.equal(result.verification.install.code, "INSTALL_OK")
      assert.equal(result.verification.receipt.source.tag, "v1.0.0")
      assert.equal(result.verification.receipt.source.sha256, result.assets.find(asset => asset.name.endsWith(".tgz")).sha256)
      assert.equal(result.verification.doctor.blockers.every(code => ["ENV_MISSING", "RESTART_REQUIRED"].includes(code)), true)
      assert.deepEqual(result.verification.runnerSmoke, {
        browserLaunches: 0,
        daemonStarts: 0,
        networkAttempts: 0,
        loaded: true,
      })
      assert.deepEqual(result.hashes, result.verification.repeat)
      helpers.recordProof("releaseSelfInstallVerified", true)
      helpers.recordProof("releaseRealGiteeRequests", 0)
      helpers.recordProof("releaseSaasRequests", 0)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}

module.exports = { register }
