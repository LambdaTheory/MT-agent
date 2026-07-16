const childProcess = require("child_process");
const path = require("path");
const { acquireLeaseLock, releaseLeaseLock } = require("./lease-lock");

function createWindowsProcessTerminator(options = {}) {
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  const platform = options.platform || process.platform;
  return {
    async terminateIfIdentityMatches(pid, expectedCreationToken) {
      if (!Number.isInteger(pid) || pid <= 0 || typeof expectedCreationToken !== "string" || !expectedCreationToken) {
        return { outcome: "failed" };
      }
      if (platform !== "win32") return { outcome: "failed" };
      const script = [
        "$ErrorActionPreference='Stop'",
        "try {",
        "  $PidValue=[int]$env:RENTAL_AGENT_STOP_PID",
        "  $ExpectedToken=[string]$env:RENTAL_AGENT_STOP_CREATION_TOKEN",
        "  $p=Get-CimInstance Win32_Process -Filter (\"ProcessId=\"+$PidValue)",
        "  if($null -eq $p){@{outcome='absent'}|ConvertTo-Json -Compress;exit 0}",
        "  $creationTime=[string]$p.CreationDate",
        "  $sha=[System.Security.Cryptography.SHA256]::Create()",
        "  try{$bytes=[System.Text.Encoding]::UTF8.GetBytes(([string]$PidValue)+[char]0+$creationTime);$actual=([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}",
        "  if($actual -ne $ExpectedToken){@{outcome='identity_mismatch'}|ConvertTo-Json -Compress;exit 0}",
        "  Stop-Process -Id $PidValue -ErrorAction Stop",
        "  @{outcome='terminated'}|ConvertTo-Json -Compress",
        "} catch { @{outcome='failed'}|ConvertTo-Json -Compress }",
      ].join(";");
      try {
        const text = String(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
          encoding: "utf8",
          env: { ...process.env, RENTAL_AGENT_STOP_PID: String(pid), RENTAL_AGENT_STOP_CREATION_TOKEN: expectedCreationToken },
          timeout: 5000,
          windowsHide: true,
        })).trim();
        const result = JSON.parse(text);
        return ["terminated", "identity_mismatch", "absent", "failed"].includes(result.outcome) ? { outcome: result.outcome } : { outcome: "failed" };
      } catch {
        return { outcome: "failed" };
      }
    },
  };
}

function stopLockPath(layout) {
  return path.join(layout.dataRoot, "daemon-stop.lock");
}

function acquireStopLock(layout, options) {
  const lockPath = stopLockPath(layout);
  try {
    return acquireLeaseLock({
      lockPath,
      lockKind: "daemon-stop",
      operationId: options.operationId || "daemon-stop-" + process.pid + "-" + Date.now().toString(36),
      operationPhase: "validating",
      processInspector: options.processInspector,
      now: options.now,
      fs: options.lockFs,
    });
  } catch (error) {
    if (error.code === "LOCKED") return null;
    throw error;
  }
}

function releaseStopLock(lock) {
  return releaseLeaseLock(lock);
}

module.exports = { acquireStopLock, createWindowsProcessTerminator, releaseStopLock };
