/**
 * dsh-auto-approval — decision core (pure, dependency-free).
 *
 * Classifies one approval request as `allow` or `defer`, using the REAL tool
 * arguments recorded in the session log (`tool/call` events) rather than the
 * model-written justification string. The module is deliberately free of
 * Cordis imports so it can be unit-tested in isolation.
 *
 * Rule summary (see README for the full contract):
 *  1. Only `pwsh`, `bash`, `write` and `edit` calls are ever auto-approved;
 *     every other tool defers to the human answerer.
 *  2. A command that matches a `dangerousPatterns` entry defers even when it
 *     would otherwise qualify (defense in depth; the plugin never denies,
 *     it only declines to auto-approve).
 *  3. A pure-introspection command (ls/dir/pwd/whoami/…, Get-* cmdlets) with
 *     no shell metacharacters is auto-approved anywhere.
 *  4. A git/hub read command (status/branch/remote/rev-parse/…) is
 *     auto-approved only when its workdir lies inside a trusted area
 *     (untrusted repositories can weaponize git via config — textconv,
 *     fsmonitor, pager — so they are never auto-approved).
 *  5. A command is auto-approved when its workdir lies inside a trusted area
 *     AND the command references a trusted path or is a qualified harmless
 *     command.
 *  6. A filesystem write/edit is auto-approved when its target lies inside a
 *     trusted area (absolute path, or relative resolved against the session
 *     cwd / workdir).
 *  7. Oversized or unparseable inputs defer.
 */

import { isAbsolute, resolve, sep } from "node:path";

/** Tools whose command text is inspected. */
export const COMMAND_TOOLS = new Set(["pwsh", "bash"]);
/** Filesystem mutation tools whose `file_path` is inspected. */
export const FS_TOOLS = new Set(["write", "edit"]);
/** Shell metacharacters that disqualify a "harmless" command (redirection, pipes, chaining, substitution). */
export const SHELL_META = /[;&|<>`]|\$\(|\r?\n/;
/** Command families that are inherently scoped to their working directory. */
export const CWD_SCOPED = /^(git|hub|ls|dir|pwd|Get-Location|Get-ChildItem|Get-Process|Get-Service)\b/i;
/** Repo-command families (run inside a git/hub repository). */
export const REPO_COMMAND = /^(git|hub)\b/i;

/**
 * Default "harmless" patterns: pure introspection only. These commands do not
 * execute repository-controlled programs, so they are safe outside trusted
 * areas too. Git read commands are NOT here: they belong to the
 * `harmlessPatterns` config list but only auto-approve inside trusted areas
 * (see rule 4).
 */
export const DEFAULT_HARMLESS_PATTERNS = [
  // plain directory / process / identity introspection
  "^ls(\\s|$)",
  "^dir(\\s|$)",
  "^pwd(\\s|$)",
  "^whoami(\\s|$)",
  "^hostname(\\s|$)",
  "^date(\\s|$)",
  "^echo(\\s|$)",
  "^Get-Location(\\s|$)",
  "^Get-Date(\\s|$)",
  "^Get-ChildItem(\\s|$)",
  "^Get-Process(\\s|$)",
  "^Get-Service(\\s|$)",
  "^Get-Command(\\s|$)",
  "^Write-Host(\\s|$)",
  // read-only git families — auto-approved ONLY inside trusted areas
  "^(git|hub)\\s+(status|branch|remote|rev-parse|ls-files|tag|describe|help|shortlog|name-rev|count-objects|for-each-ref|whatchanged)(\\s|$)"
];

/**
 * Default "dangerous" patterns: operations aimed at system or drive roots.
 * A match DEFERS (the human answerer still decides) — it never denies. This
 * list is scope control for the auto-approval window, not a security boundary.
 */
export const DEFAULT_DANGEROUS_PATTERNS = [
  // drive-root wipes: `del /s /q D:\`, `Remove-Item -Recurse D:\`, `rm -rf D:\`
  "(^|[\\s;|&])(rm|Remove-Item|del|erase|rd|rmdir)(\\s+-[a-zA-Z]*[rfqFQ][a-zA-Z]*)*\\s+(\"?[A-Za-z]:\\\\)(\"|\\s|$)",
  // system-directory wipes: C:\Windows, C:\Program Files, C:\Users
  "(^|[\\s;|&])(rm|Remove-Item|del|erase|rd|rmdir)(\\s+-[a-zA-Z]*[rfqFQ][a-zA-Z]*)*\\s+(\"?[A-Za-z]:\\\\(Windows|Program Files|Program Files \\(x86\\)|Users))(\"|\\\\|\\s|$)",
  // POSIX root wipes: `rm -rf /`, `rm -rf /*`
  "(^|[\\s;|&])(rm|Remove-Item|del|erase|rd|rmdir)(\\s+-[a-zA-Z]*[rfqFQ][a-zA-Z]*)*\\s+/(\\*)?(\\s|$)",
  // home-directory wipes
  "(^|[\\s;|&])(rm|Remove-Item|del|erase|rd|rmdir)(\\s+-[a-zA-Z]*[rfqFQ][a-zA-Z]*)*\\s+~(\"|\\\\|\\s|$)",
  // environment-variable system roots
  "%SystemRoot%|%WINDIR%|\\$env:SystemRoot|\\$env:WINDIR",
  // raw block-device operations
  "\\bmkfs\\b|\\bfdisk\\b|\\bparted\\b|\\bdiskpart\\b|\\bclean\\s+all\\b",
  // machine control
  "\\bshutdown\\b|\\brestart-computer\\b|\\bstop-computer\\b",
  // fs targets inside system directories (checked against `file_path`)
  "(^|[\\\\/])(Windows|Program Files|Program Files \\(x86\\))([\\\\/]|$)",
  "^[A-Za-z]:[\\\\/]$"
];

/** Compile config pattern strings into RegExp objects (case-insensitive). */
export function compilePatterns(patterns) {
  return patterns.map((source) => new RegExp(source, "i"));
}

/** Path comparison key: trailing separator stripped, case-folded on Windows. */
export function foldPath(path, caseSensitive) {
  let value = path;
  while (value.length > 3 && value.endsWith(sep)) value = value.slice(0, -1);
  return caseSensitive ? value : value.toLowerCase();
}

/** Lexical containment: is `candidate` the root itself or beneath it? */
export function isUnderRoot(candidate, root, caseSensitive = false) {
  const target = foldPath(candidate, caseSensitive);
  const base = foldPath(root, caseSensitive);
  if (target === base) return true;
  const prefix = base.endsWith(sep) ? base : base + sep;
  return target.startsWith(prefix);
}

/**
 * Whether `text` contains `root` as a path reference (bounded by non-path
 * characters on both sides, so `D:\data` does not match `D:\database`).
 */
export function containsPathReference(text, root, caseSensitive = false) {
  const hay = foldPath(text, caseSensitive);
  const needle = foldPath(root, caseSensitive);
  const isPathChar = (ch) => /[A-Za-z0-9_\-.]/.test(ch);
  let index = 0;
  while (index < hay.length) {
    const at = hay.indexOf(needle, index);
    if (at === -1) return false;
    const before = at === 0 ? "" : hay[at - 1];
    const afterIndex = at + needle.length;
    const after = afterIndex >= hay.length ? "" : hay[afterIndex];
    if (!isPathChar(before) && !isPathChar(after)) return true;
    index = at + needle.length;
  }
  return false;
}

/** Resolve a possibly-relative path against the base directory. */
function resolveTarget(path, baseDir) {
  return isAbsolute(path) ? path : resolve(baseDir ?? process.cwd(), path);
}

/**
 * Classify one approval request.
 *
 * @param {object} input
 * @param {string} input.toolName - the tool that raised the request.
 * @param {object} input.args - the REAL tool arguments from the session log.
 * @param {string} [input.baseDir] - the session cwd, for relative paths.
 * @param {string[]} input.trustedRoots - normalized trusted-area roots.
 * @param {RegExp[]} input.harmlessPatterns
 * @param {RegExp[]} input.dangerousPatterns
 * @param {number} input.maxCommandChars
 * @param {boolean} [input.caseSensitive] - default: true off-Windows.
 * @returns {{decision: "allow"|"defer", rule: string}}
 */
export function classifyRequest({
  toolName,
  args,
  baseDir,
  trustedRoots,
  harmlessPatterns,
  dangerousPatterns,
  maxCommandChars,
  caseSensitive = process.platform !== "win32"
}) {
  const defer = (rule) => ({ decision: "defer", rule });
  const allow = (rule) => ({ decision: "allow", rule });

  if (COMMAND_TOOLS.has(toolName)) {
    const command = typeof args.command === "string" ? args.command : "";
    if (command === "") return defer("no-command");
    if (command.length > maxCommandChars) return defer("command-too-long");
    if (dangerousPatterns.some((re) => re.test(command))) return defer("dangerous-pattern");

    const rawWorkdir = typeof args.workdir === "string" && args.workdir !== "" ? args.workdir : null;
    const workdir = rawWorkdir === null ? null : resolveTarget(rawWorkdir, baseDir);
    const workdirTrusted = workdir !== null && trustedRoots.some((root) => isUnderRoot(workdir, root, caseSensitive));

    const harmlessMatch = harmlessPatterns.some((re) => re.test(command)) && !SHELL_META.test(command);

    // Rule 3: pure introspection anywhere.
    if (harmlessMatch && !REPO_COMMAND.test(command)) return allow("harmless-command");
    // Rule 4: git/hub read commands only inside trusted areas.
    if (harmlessMatch && workdirTrusted) return allow("harmless-repo-command");
    // Rule 5: trusted workdir + trusted path reference (or qualified harmless).
    if (workdirTrusted) {
      const referencesTrusted = trustedRoots.some((root) => containsPathReference(command, root, caseSensitive));
      if (referencesTrusted) return allow("trusted-area-command");
    }
    return defer("unmatched");
  }

  if (FS_TOOLS.has(toolName)) {
    const rawPath = typeof args.file_path === "string" ? args.file_path : "";
    if (rawPath === "") return defer("no-target");
    if (rawPath.length > maxCommandChars) return defer("target-too-long");
    const target = resolveTarget(rawPath, typeof args.workdir === "string" && args.workdir !== "" ? args.workdir : baseDir);
    if (dangerousPatterns.some((re) => re.test(target))) return defer("dangerous-target");
    if (trustedRoots.some((root) => isUnderRoot(target, root, caseSensitive))) return allow("trusted-area-target");
    return defer("unmatched");
  }

  return defer("unsupported-tool");
}

/** Locate the recorded `tool/call` event for one approval request. */
export function findToolCall(events, callId, toolName) {
  if (typeof callId !== "string" || callId === "") return void 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "tool/call") continue;
    const data = event.data;
    if (data === void 0 || data === null) continue;
    if (data.callId !== callId) continue;
    if (toolName !== void 0 && data.name !== toolName) continue;
    return data;
  }
  return void 0;
}

/** Parse the recorded tool arguments (model protocol stores them as JSON text). */
export function parseArguments(raw) {
  if (raw === void 0 || raw === null) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return typeof raw === "object" ? raw : null;
}
