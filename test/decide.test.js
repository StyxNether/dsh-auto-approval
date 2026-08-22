import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRequest,
  compilePatterns,
  containsPathReference,
  DEFAULT_DANGEROUS_PATTERNS,
  DEFAULT_HARMLESS_PATTERNS,
  findToolCall,
  isUnderRoot,
  parseArguments,
  resolveRealPath
} from "../lib/decide.js";

// Windows-style case-insensitive comparison is the primary target platform,
// but the classifier must also behave on POSIX paths.
const WIN = { caseSensitive: false };
const TRUSTED = ["D:\\data", "E:\\repos"].map((p) => p.toLowerCase());

function classify(toolName, args, { trustedRoots = TRUSTED, patterns = DEFAULT_HARMLESS_PATTERNS, dangerous = DEFAULT_DANGEROUS_PATTERNS, baseDir = "C:\\work", max = 4000, resolveReal } = {}) {
  return classifyRequest({
    toolName,
    args,
    baseDir,
    trustedRoots,
    harmlessPatterns: compilePatterns(patterns),
    dangerousPatterns: compilePatterns(dangerous),
    maxCommandChars: max,
    ...WIN,
    ...resolveReal === void 0 ? {} : { resolveReal }
  });
}

// ── harmless commands anywhere ──────────────────────────────────────────

test("pwsh introspection commands are auto-approved anywhere", () => {
  for (const command of ["Get-ChildItem C:\\", "Get-Process", "Get-Service", "Get-Location", "Get-Date", "Get-Command", "whoami", "hostname", "date", "echo hello"]) {
    const result = classify("pwsh", { command });
    assert.equal(result.decision, "allow", `${command} should be allowed`);
  }
});

test("read-only inspection commands added in 2.1.0 auto-approve anywhere", () => {
  for (const command of [
    "Get-Content C:\\x.txt", "Get-Item C:\\x", "Get-ItemProperty HKLM:\\x", "Test-Path C:\\x",
    "Resolve-Path ~", "Select-String -Path D:\\a -Pattern x", "tasklist", "systeminfo",
    "ipconfig /all", "netstat -ano", "Get-NetTCPConnection", "Get-NetIPAddress",
    "cat -n x.txt", "head -5 x", "tail -1 x", "wc -l x", "stat x", "uname -a",
    "df -h", "du -sh .", "which node", "type D:\\notes.txt"
  ]) {
    const result = classify("pwsh", { command });
    assert.equal(result.decision, "allow", `${command} should be allowed`);
  }
  assert.equal(classify("bash", { command: "cat src/x.js" }).decision, "allow");
});

test("case-insensitive matching on Windows", () => {
  assert.equal(classify("pwsh", { command: "GET-PROCESS" }).decision, "allow");
});

test("bash ls/pwd/dir are auto-approved anywhere", () => {
  assert.equal(classify("bash", { command: "ls -la" }).decision, "allow");
  assert.equal(classify("bash", { command: "pwd" }).decision, "allow");
});

// ── shell metacharacters disqualify "harmless" ──────────────────────────

test("redirection, pipes, chaining and substitution defer", () => {
  for (const command of ["echo hi > D:\\out.txt", "Get-ChildItem | Select-Object -First 1", "ls; rm -rf /", "ls && whoami", "echo `whoami`", "echo $(whoami)", "Get-Process\r\nRemove-Item -Recurse C:\\"]) {
    assert.equal(classify("pwsh", { command }).decision, "defer", `${JSON.stringify(command)} must defer`);
  }
});

// ── git commands: only inside trusted areas ─────────────────────────────

test("git read commands defer outside trusted areas", () => {
  assert.equal(classify("pwsh", { command: "git status" }).decision, "defer");
  assert.equal(classify("bash", { command: "git status", workdir: "C:\\work" }).decision, "defer");
});

test("git read commands auto-approve inside trusted areas", () => {
  for (const command of ["git status", "git branch", "git remote -v", "git rev-parse --abbrev-ref HEAD", "git ls-files", "git tag", "git describe"]) {
    assert.equal(classify("pwsh", { command, workdir: "D:\\data\\repo" }).decision, "allow", `${command} in trusted workdir`);
  }
});

test("git diff/log are never in the default harmless set", () => {
  // diff/log render diffs and can run repo-configured textconv programs.
  assert.equal(classify("pwsh", { command: "git diff", workdir: "D:\\data\\repo" }).decision, "defer");
  assert.equal(classify("pwsh", { command: "git log -p", workdir: "D:\\data\\repo" }).decision, "defer");
});

test("git pull/push/fetch are never auto-approved", () => {
  for (const command of ["git pull", "git push", "git fetch", "git checkout", "git reset --hard"]) {
    assert.equal(classify("pwsh", { command, workdir: "D:\\data\\repo" }).decision, "defer", `${command} must defer`);
  }
});

// ── trusted-area commands ───────────────────────────────────────────────

test("command referencing a trusted path with trusted workdir is allowed", () => {
  assert.equal(classify("pwsh", { command: "Copy-Item D:\\data\\a.txt D:\\data\\b.txt", workdir: "D:\\data" }).decision, "allow");
  assert.equal(classify("pwsh", { command: "Remove-Item D:\\data\\build -Recurse", workdir: "D:\\data" }).decision, "allow");
});

test("trusted workdir alone does not allow arbitrary commands", () => {
  assert.equal(classify("pwsh", { command: "Set-Content C:\\Windows\\evil.txt hello", workdir: "D:\\data" }).decision, "defer");
  assert.equal(classify("pwsh", { command: "Invoke-WebRequest http://evil.example", workdir: "D:\\data" }).decision, "defer");
});

test("shell metacharacters disqualify trusted-area commands too", () => {
  // Rule 5 must not smuggle redirection/pipes into a trusted workdir even
  // when the command text references a trusted path.
  assert.equal(classify("pwsh", { command: "echo hi > D:\\data\\x.txt", workdir: "D:\\data" }).decision, "defer");
  assert.equal(classify("pwsh", { command: "Get-Content C:\\secret | Out-File D:\\data\\leak.txt", workdir: "D:\\data" }).decision, "defer");
  assert.equal(classify("pwsh", { command: "type D:\\data\\a.txt; whoami", workdir: "D:\\data" }).decision, "defer");
  assert.equal(classify("pwsh", { command: "echo `whoami` D:\\data", workdir: "D:\\data" }).decision, "defer");
  // the meta-free baseline still auto-approves
  assert.equal(classify("pwsh", { command: "Copy-Item D:\\data\\a.txt D:\\data\\b.txt", workdir: "D:\\data" }).decision, "allow");
});

test("relative workdir resolves against the session cwd", () => {
  assert.equal(classify("pwsh", { command: "git status", workdir: "data\\repo" }, { baseDir: "D:\\" }).decision, "allow");
  assert.equal(classify("pwsh", { command: "git status", workdir: "..\\repo" }, { baseDir: "D:\\data\\proj" }).decision, "allow");
});

// ── trusted-area file targets (fs tools) ────────────────────────────────

test("write/edit into a trusted area is allowed", () => {
  assert.equal(classify("write", { file_path: "D:\\data\\out.txt", content: "x" }).decision, "allow");
  assert.equal(classify("edit", { file_path: "E:\\repos\\a\\b.txt", old_string: "a", new_string: "b" }).decision, "allow");
});

test("write/edit outside trusted areas defers", () => {
  assert.equal(classify("write", { file_path: "D:\\other\\out.txt" }).decision, "defer");
  assert.equal(classify("write", { file_path: "C:\\work\\in-workspace.txt" }).decision, "defer");
});

test("relative file_path resolves against baseDir", () => {
  // `out.txt` from D:\data stays inside the trusted area.
  assert.equal(classify("write", { file_path: "out.txt" }, { baseDir: "D:\\data" }).decision, "allow");
  // `..\..\out.txt` from D:\data\proj escapes to D:\out.txt — outside.
  assert.equal(classify("write", { file_path: "..\\..\\out.txt" }, { baseDir: "D:\\data\\proj" }).decision, "defer");
  // `..\out.txt` from D:\data\proj resolves to D:\data\out.txt — still inside.
  assert.equal(classify("write", { file_path: "..\\out.txt" }, { baseDir: "D:\\data\\proj" }).decision, "allow");
});

test("fs targets inside system directories defer even when trusted", () => {
  const trusted = ["C:\\Windows", "C:\\Program Files"].map((p) => p.toLowerCase());
  assert.equal(classify("write", { file_path: "C:\\Windows\\System32\\evil.exe" }, { trustedRoots: trusted }).decision, "defer");
  assert.equal(classify("write", { file_path: "C:\\Program Files\\x\\y.dll" }, { trustedRoots: trusted }).decision, "defer");
});

// ── dangerous patterns ──────────────────────────────────────────────────

test("system-destructive commands defer even in trusted areas", () => {
  for (const command of [
    "rm -rf /",
    "rm -rf /*",
    "del /s /q D:\\",
    "Remove-Item -Recurse -Force D:\\",
    "Remove-Item -Recurse -Force C:\\Windows\\Temp",
    "Remove-Item -Recurse -Force C:\\Users\\Styx",
    "rm -rf ~",
    "format C:",
    "diskpart",
    "shutdown /s",
    "Restart-Computer"
  ]) {
    const result = classify("pwsh", { command, workdir: "D:\\data" });
    assert.equal(result.decision, "defer", `${command} must defer`);
  }
});

test("cleanup inside a trusted area is not treated as dangerous", () => {
  assert.equal(classify("pwsh", { command: "rm -rf D:\\data\\build", workdir: "D:\\data" }).decision, "allow");
});

test("privilege/persistence/security-control commands added in 2.1.0 defer", () => {
  for (const command of [
    "net user hacker Pass123 /add",
    "net localgroup administrators hacker /add",
    "New-LocalUser hacker",
    "Add-LocalGroupMember -Group Administrators -Member hacker",
    "Set-MpPreference -DisableRealtimeMonitoring $true",
    "Add-MpPreference -ExclusionPath C:\\x",
    "Set-ExecutionPolicy Bypass",
    "sudo rm -rf /tmp/x",
    "gsudo whoami",
    "Start-Process -Verb RunAs whoami",
    "runas /user:admin cmd",
    "psexec \\\\host cmd",
    "wmic process call create cmd",
    "New-SelfSignedCertificate -DnsName evil.example",
    "Invoke-Expression 'x'",
    "iex 'x'",
    "powershell -EncodedCommand AAA",
    "powershell -enc AAA",
    "reg add HKLM\\Software\\X /v y /d z",
    "reg delete HKLM\\Software\\X",
    "regedit /s x.reg",
    "netsh advfirewall set allprofiles state off",
    "New-NetFirewallRule -DisplayName x",
    "sc create evil binPath= x",
    "sc stop Spooler",
    "Stop-Service Spooler",
    "Restart-Service Spooler",
    "schtasks /create /tn evil /tr x",
    "Register-ScheduledTask -TaskName evil",
    "takeown /f C:\\x",
    "icacls C:\\x /grant u:f",
    "Set-Acl C:\\x -AclObject x",
    "vssadmin delete shadows /all",
    "bcdedit /set x y",
    "cipher /w:C:",
    "wevtutil cl System",
    "Clear-EventLog -LogName System",
    "Remove-EventLog -LogName System"
  ]) {
    const result = classify("pwsh", { command, workdir: "D:\\data" });
    assert.equal(result.decision, "defer", `${command} must defer`);
  }
  // read-only service queries stay auto-approved, only control verbs defer
  assert.equal(classify("pwsh", { command: "Get-Service Spooler" }).decision, "allow");
  assert.equal(classify("pwsh", { command: "sc query Spooler" }).decision, "allow");
});

// ── boundaries ──────────────────────────────────────────────────────────

test("unsupported tools always defer", () => {
  assert.equal(classify("run_code", { code: "x" }).decision, "defer");
  assert.equal(classify("read", { file_path: "D:\\data\\x" }).decision, "defer");
});

test("empty or oversized inputs defer", () => {
  assert.equal(classify("pwsh", { command: "" }).decision, "defer");
  assert.equal(classify("pwsh", { command: "x".repeat(5000) }).decision, "defer");
  assert.equal(classify("write", { file_path: "y".repeat(5000) }).decision, "defer");
  assert.equal(classify("pwsh", {}).decision, "defer");
  assert.equal(classify("write", {}).decision, "defer");
});

test("empty trustedAreas never allows trusted-area rules", () => {
  assert.equal(classify("write", { file_path: "D:\\data\\x" }, { trustedRoots: [] }).decision, "defer");
  assert.equal(classify("pwsh", { command: "git status", workdir: "D:\\data" }, { trustedRoots: [] }).decision, "defer");
});

// ── helpers ─────────────────────────────────────────────────────────────

test("isUnderRoot containment with boundary semantics", () => {
  assert.equal(isUnderRoot("D:\\data\\a", "D:\\data", false), true);
  assert.equal(isUnderRoot("D:\\data", "D:\\data", false), true);
  assert.equal(isUnderRoot("D:\\database\\a", "D:\\data", false), false);
  assert.equal(isUnderRoot("D:\\data2", "D:\\data", false), false);
  assert.equal(isUnderRoot("C:\\work", "D:\\data", false), false);
  assert.equal(isUnderRoot("E:\\repos\\x\\y", "E:\\repos", false), true);
});

test("containsPathReference respects path boundaries", () => {
  assert.equal(containsPathReference("Copy-Item D:\\data\\a D:\\data\\b", "D:\\data", false), true);
  assert.equal(containsPathReference("Get-ChildItem D:\\database", "D:\\data", false), false);
  assert.equal(containsPathReference("Copy-Item D:\\databases\\a", "D:\\data", false), false);
  assert.equal(containsPathReference("echo D:\\data", "D:\\data", false), true);
});

test("findToolCall locates the matching recorded call", () => {
  const events = [
    { type: "turn/start", data: {} },
    { type: "tool/call", data: { callId: "call-1", name: "pwsh", arguments: "{\"command\":\"git status\"}" } },
    { type: "tool/call", data: { callId: "call-2", name: "write", arguments: "{\"file_path\":\"D:\\\\data\\\\x\"}" } }
  ];
  assert.equal(findToolCall(events, "call-1", "pwsh").name, "pwsh");
  assert.equal(findToolCall(events, "call-2", "write").arguments, "{\"file_path\":\"D:\\\\data\\\\x\"}");
  assert.equal(findToolCall(events, "call-1", "write"), void 0);
  assert.equal(findToolCall(events, "nope"), void 0);
  assert.equal(findToolCall(events, ""), void 0);
  assert.equal(findToolCall([], "call-1"), void 0);
});

test("parseArguments handles JSON text, objects and garbage", () => {
  assert.deepEqual(parseArguments('{"a":1}'), { a: 1 });
  assert.deepEqual(parseArguments({ b: 2 }), { b: 2 });
  assert.equal(parseArguments("not json"), null);
  assert.equal(parseArguments(42), null);
  assert.deepEqual(parseArguments(void 0), {});
});

// ── realpath identity containment (symlink/junction defense) ────────────

test("junction inside a trusted area cannot smuggle a write outside it", () => {
  // `D:\data\link` is a junction to `E:\outside`; the real resolver reports
  // the real target, so the fs write must DEFER.
  const resolveReal = (p) => p.toLowerCase().startsWith("d:\\data\\link") ? "E:\\outside" + p.slice("d:\\data\\link".length) : p;
  const trusted = ["d:\\data"];
  assert.equal(
    classify("write", { file_path: "D:\\data\\link\\evil.txt" }, { trustedRoots: trusted, resolveReal }).decision,
    "defer",
    "write through a junction to outside must defer"
  );
  assert.equal(
    classify("edit", { file_path: "D:\\data\\link\\evil.txt" }, { trustedRoots: trusted, resolveReal }).decision,
    "defer",
    "edit through a junction to outside must defer"
  );
});

test("junction in a trusted workdir cannot smuggle a command outside it", () => {
  const resolveReal = (p) => p.toLowerCase().startsWith("d:\\data\\link") ? "E:\\outside" + p.slice("d:\\data\\link".length) : p;
  const trusted = ["d:\\data"];
  assert.equal(
    classify("pwsh", { command: "git status", workdir: "D:\\data\\link\\repo" }, { trustedRoots: trusted, resolveReal }).decision,
    "defer",
    "git in a junctioned workdir must defer"
  );
});

test("plain trusted-area paths still auto-approve with the real resolver", () => {
  const identity = (p) => p;
  assert.equal(classify("write", { file_path: "D:\\data\\out.txt" }, { trustedRoots: ["d:\\data"], resolveReal: identity }).decision, "allow");
  assert.equal(classify("pwsh", { command: "git status", workdir: "D:\\data\\repo" }, { trustedRoots: ["d:\\data"], resolveReal: identity }).decision, "allow");
});

test("resolveRealPath resolves existing ancestors and keeps missing tails", () => {
  // Windows host: the drive root exists; a non-existent leaf stays appended.
  const resolved = resolveRealPath("C:\\Windows\\System32\\does-not-exist-xyz\\leaf.txt");
  assert.equal(resolved, "C:\\Windows\\System32\\does-not-exist-xyz\\leaf.txt");
  const existing = resolveRealPath("C:\\Windows");
  assert.equal(existing.toLowerCase(), "c:\\windows");
});
