const fs = require("fs")
const path = require("path")

const lifecycle = require("../../../scripts/lifecycle.js")
const initCli = require("../../../scripts/init.js")
const releaseBuilder = require("../../../scripts/build-release.js")

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..")
const README_PATH = path.join(SKILL_DIR, "README.md")
const SKILL_PATH = path.join(SKILL_DIR, "SKILL.md")
const PROCESS_PATH = path.join(SKILL_DIR, "references", "process.md")
const CONFIG_EXAMPLE_PATH = path.join(SKILL_DIR, "config.example.json")
const MANIFEST_PATH = path.join(SKILL_DIR, "release-manifest.json")
const PACKAGE_PATH = path.join(SKILL_DIR, "package.json")
const GITIGNORE_PATH = path.join(SKILL_DIR, ".gitignore")
const DOC_PATHS = [README_PATH, SKILL_PATH, PROCESS_PATH]
const RELEASE_OWNED_PATHS = DOC_PATHS.concat(CONFIG_EXAMPLE_PATH)
const TARGET_PATH = "D:\\rental-price-agent"
const DATA_ROOT_PATH = "D:\\.rental-price-agent-data"
const CONFIRM_TOKEN = "v1.0.0@0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8")
}

function shellWords(command) {
  const matches = command.match(/"[^"]*"|'[^']*'|\S+/g) || []
  return matches.map(token => token.replace(/^['"]|['"]$/g, ""))
}

function normalizeCommand(command) {
  return command
    .replace(/<absolute-skill-target>/g, TARGET_PATH)
    .replace(/<sibling-data-root>/g, DATA_ROOT_PATH)
    .replace(/<absolute-path>/g, TARGET_PATH)
    .replace(/v1\.0\.0@0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/g, CONFIRM_TOKEN)
}

function extractCommands(text, prefix) {
  const lines = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith(prefix)) lines.push(normalizeCommand(line))
  }
  return lines
}

function getReleaseOwnedText() {
  return RELEASE_OWNED_PATHS.map(readUtf8).join("\n")
}

function getDocAndHelpText() {
  return getReleaseOwnedText() + "\n" + lifecycle.usage() + "\n" + initCli.usage() + "\n" + releaseBuilder.usage()
}

async function assertLifecycleHelpWorks(assert) {
  const topLevel = await lifecycle.runLifecycleCli(["--help"], {
    writeStdout() {},
    writeStderr() {},
  })
  assert.equal(topLevel.exitCode, 0)
  assert.ok(lifecycle.usage().includes("install"))
  assert.ok(lifecycle.usage().includes("rollback"))
}

async function assertInitHelpWorks(assert) {
  const result = await initCli.runCli(["--help"])
  assert.equal(result.exitCode, 0)
  assert.equal(result.help, initCli.usage())
  assert.match(result.help, /--target <absolute-path>/)
  assert.match(result.help, /--json/)
}

async function register({ test, assert }) {
  test("documentation-contract: lifecycle and init help expose the current command surface", async () => {
    await assertLifecycleHelpWorks(assert)
    await assertInitHelpWorks(assert)
    const helpText = lifecycle.usage() + "\n" + initCli.usage()
    assert.match(helpText, /Without --target, init checks the current skill directory only\./)
    assert.match(helpText, /does not infer an install target/i)
    for (const stale of ["uninstall", "hot-upgrade", "self-install", "copy config.example.json"]) {
      assert.equal(helpText.includes(stale), false)
    }
  })

  test("documentation-contract: release builder help exposes deterministic verified output", async () => {
    const parsed = releaseBuilder.parseArgs(["--verify", "--output", TARGET_PATH, "--version", "1.0.0", "--tag", "v1.0.0"])
    assert.equal(parsed.verify, true)
    assert.equal(parsed.outputDir, TARGET_PATH)
    assert.match(releaseBuilder.usage(), /--output <absolute-temp-dir>/)
    assert.match(releaseBuilder.usage(), /--verify/)
  })

  test("documentation-contract: documented lifecycle and init snippets parse against the real CLI", async () => {
    const commands = DOC_PATHS.flatMap(filePath => {
      const text = readUtf8(filePath)
      return extractCommands(text, "node scripts/lifecycle.js").map(command => ({ command, kind: "lifecycle", filePath }))
        .concat(extractCommands(text, "node scripts/init.js").map(command => ({ command, kind: "init", filePath })))
        .concat(extractCommands(text, "node scripts/build-release.js").map(command => ({ command, kind: "release", filePath })))
    })
    assert.ok(commands.length >= 8, "expected lifecycle/init snippets in the operator docs")
    for (const item of commands) {
      if (item.kind === "init") assert.match(item.command, /--target/)
      const argv = shellWords(item.command).slice(2)
      if (item.kind === "lifecycle") {
        assert.doesNotThrow(() => lifecycle.parseArgs(argv), path.basename(item.filePath) + ": " + item.command)
      } else if (item.kind === "init") {
        assert.doesNotThrow(() => initCli.parseCliArgs(argv), path.basename(item.filePath) + ": " + item.command)
      } else {
        assert.doesNotThrow(() => releaseBuilder.parseArgs(argv), path.basename(item.filePath) + ": " + item.command)
      }
    }
  })

  test("documentation-contract: release docs stay aligned with manifest, package, and required warnings", async () => {
    const manifest = JSON.parse(readUtf8(MANIFEST_PATH))
    const packageJson = JSON.parse(readUtf8(PACKAGE_PATH))
    const joined = getDocAndHelpText()
    assert.equal(packageJson.version, manifest.skillVersion)
    assert.match(joined, new RegExp(manifest.nodeRange.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.match(joined, /lcc0628\/rental-price-agent/)
    assert.match(joined, /Skill version/)
    assert.match(joined, /Daemon version/)
    assert.match(joined, /Protocol version/)
    assert.match(joined, /Config schema version/)
    assert.match(joined, /State schema version/)
    assert.match(joined, /checksum.*not.*Gitee account/i)
    assert.match(joined, /Do not run reverse migrations during rollback\./)
    assert.match(joined, /manual OpenCode restart/i)
    assert.match(joined, /one retained previous release/i)
    assert.match(joined, /Do not rely on automatic local copy discovery or any hot-upgrade path\./)
  })

  test("documentation-contract: docs distinguish release rollback from SaaS rollback and require exact confirm flow", async () => {
    const readme = readUtf8(README_PATH)
    const processDoc = readUtf8(PROCESS_PATH)
    assert.match(readme, /release activation rollback/i)
    assert.match(readme, /batch-runner\.js rollback/)
    assert.match(readme, /version@digest/)
    assert.match(processDoc, /preview by default, activate only after exact `version@digest` confirmation/)
    assert.match(processDoc, /Do not confuse it with SaaS field rollback or batch rollback\./)
  })

  test("documentation-contract: docs enforce the two-root layout, declarative migration contract, and daemon diagnostics boundary", async () => {
    const joined = getReleaseOwnedText()
    assert.match(joined, /<absolute-skill-target>[\\/].*release-owned tree/i)
    assert.match(joined, /<sibling-data-root>[\\/].*mutable data root/i)
    assert.equal(/^├── \.env/m.test(joined), false)
    assert.equal(/target-migration\.js(?!on)/.test(joined), false)
    assert.equal(joined.includes("run-tests.sh"), false)
    assert.equal(joined.includes("Get-Content .daemon.token"), false)
    assert.match(joined, /target-migration\.json/i)
    assert.match(joined, /declarative migration contract v2|declarative contract v2/i)
    assert.match(joined, /no target code executes|no target release code executes/i)
    assert.match(joined, /schema-less JSON/i)
    assert.match(joined, /preserved byte-for-byte/i)
    assert.match(joined, /not reverse-migrated|do not run reverse migrations/i)
    assert.match(joined, /prefer `?daemon send`?/i)
    assert.match(joined, /advanced diagnostics/i)
    assert.match(joined, /daemon\\daemon\.token|path\.join\(dataRoot, "daemon", "daemon\.token"\)/i)
    assert.match(joined, /Split-Path -Parent/i)
  })

  test("documentation-contract: docs surface recovery-required and lock-release failure codes, and .gitignore excludes .omo", async () => {
    const joined = getReleaseOwnedText()
    const gitignore = readUtf8(GITIGNORE_PATH)
    for (const code of ["DAEMON_RECOVERY_REQUIRED", "LIFECYCLE_LOCK_RELEASE_FAILED", "MIGRATION_LOCK_RELEASE_FAILED", "DAEMON_STOP_LOCK_RELEASE_FAILED"]) {
      assert.match(joined, new RegExp(code))
    }
    assert.match(gitignore, /^\.omo\/$/m)
  })

  test("documentation-contract: release-owned docs, help, and config example reject local paths, live hosts, secrets, stale commands, and init contradictions", async () => {
    const joined = getDocAndHelpText()
    const configExample = JSON.parse(readUtf8(CONFIG_EXAMPLE_PATH))
    const urls = joined.match(/https?:\/\/[^\s"']+/g) || []
    assert.equal(/(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?:Users|home)\/)/.test(joined), false)
    for (const url of urls) {
      assert.match(url, /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)|^https?:\/\/[^\/\s"']+\.invalid(?:\/|$)/, url)
    }
    assert.equal(/^node scripts\/init\.js\s*$/m.test(getReleaseOwnedText()), false)
    assert.equal(joined.includes("D:\\rental-price-agent"), false)
    assert.equal(joined.includes("D:\\.rental-price-agent-data"), false)
    assert.match(joined, /<absolute-skill-target>/)
    assert.match(joined, /<sibling-data-root>/)
    assert.match(joined, /current skill directory only/i)
    assert.match(joined, /not install-target inference|does not infer an install target/i)
    assert.equal(configExample.saas.baseUrl.endsWith(".invalid"), true)
    assert.equal(configExample.saas.loginUrl.includes(".invalid/"), true)
    assert.equal(configExample.saas.productDetailUrl.includes(".invalid/"), true)
    assert.equal(configExample.saas.productListUrl.includes(".invalid/"), true)
    assert.equal(configExample.mirror.baseUrl.endsWith(".invalid"), true)
    assert.equal(configExample.saas.credentials.username, "${SAAS_USERNAME}")
    assert.equal(configExample.saas.credentials.password, "${SAAS_PASSWORD}")
    assert.equal(configExample.mirror.apiKey, "${MIRROR_API_KEY}")
    assert.equal(configExample.configSchemaVersion, JSON.parse(readUtf8(MANIFEST_PATH)).configSchemaVersion)
  })
}

module.exports = { register }
