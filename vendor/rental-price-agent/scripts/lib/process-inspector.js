const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");

let cachedCurrentProcessIdentity = null;

function creationToken(pid, creationTime) {
  return crypto.createHash("sha256").update(String(pid) + "\0" + String(creationTime)).digest("hex");
}

function createWindowsProcessInspector(options = {}) {
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  const platform = options.platform || process.platform;
  function inspectSync(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return { exists: false };
    if (pid === process.pid && cachedCurrentProcessIdentity) return { ...cachedCurrentProcessIdentity };
    if (platform === "win32") {
      const script = "$p=Get-CimInstance Win32_Process -Filter \"ProcessId=" + pid + "\";if($null -eq $p){'null'}else{$p|Select-Object ProcessId,CreationDate,ExecutablePath|ConvertTo-Json -Compress}";
      try {
        const text = String(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 3000, windowsHide: true })).trim();
        if (!text || text === "null") return { exists: false };
        const value = JSON.parse(text);
        const creationTime = String(value.CreationDate || "");
        if (!creationTime) return { exists: false, inspectionFailed: true };
        const result = { exists: true, creationToken: creationToken(pid, creationTime), creationTime, executablePath: value.ExecutablePath || null };
        if (pid === process.pid) cachedCurrentProcessIdentity = result;
        return result;
      } catch { return { exists: false, inspectionFailed: true }; }
    }
    if (platform === "linux") {
      try {
        const stat = String(fs.readFileSync("/proc/" + pid + "/stat", "utf8"));
        const close = stat.lastIndexOf(")");
        const startTime = stat.slice(close + 2).split(" ")[19];
        if (!startTime) return { exists: false, inspectionFailed: true };
        const result = { exists: true, creationToken: creationToken(pid, startTime), creationTime: startTime, executablePath: null };
        if (pid === process.pid) cachedCurrentProcessIdentity = result;
        return result;
      } catch (error) { return error.code === "ENOENT" ? { exists: false } : { exists: false, inspectionFailed: true }; }
    }
    return { exists: false, inspectionFailed: true };
  }
  return { inspectSync, async inspect(pid) { return inspectSync(pid); } };
}

function inspectProcess(inspector, pid) {
  if (!inspector || typeof inspector.inspectSync !== "function") return { exists: false, inspectionFailed: true };
  try {
    const result = inspector.inspectSync(pid);
    return result && typeof result === "object" ? result : { exists: false, inspectionFailed: true };
  } catch { return { exists: false, inspectionFailed: true }; }
}

module.exports = { createWindowsProcessInspector, inspectProcess };
