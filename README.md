# dsh-auto-approval-plugin

> 🌐 **Language**: English | [简体中文](README.zh.md)

A middle permission tier for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), between **Workspace Write** and **Full access** (danger-full-access): it adds a `auto-approval` preset to the permission settings and backs it with an automated approval answerer that approves **harmless commands** and operations whose target lies inside **configured trusted areas** — including areas outside the current workspace — and asks the user for everything else.

> ⚠️ **Scope control, not a security boundary.** This plugin automates the *human* approval step for a narrow, verifiable class of requests. The DSH sandbox still confines every non-escalated call; an auto-approved call runs with the wider mode for exactly that one call (the same one-shot grant a human click would produce). Do not use it on machines or sessions you would not trust a human operator to run commands on.

## What it does

| | Workspace Write | **Auto Approval** (this plugin) | Full access |
|---|---|---|---|
| Sandbox mode | `workspace-write` | `workspace-write` | `danger-full-access` |
| Approval policy | `ask` | `ask` | `never` |
| Writes inside workspace / temp | allowed | allowed | allowed |
| Harmless commands (see rule table) | ask | **auto-approved** | never asks |
| Targets inside trusted areas | ask | **auto-approved** | never asks |
| Everything else | ask | ask | never asks |

After installing, the new preset appears in both permission surfaces:

- **General settings → Permission** — sets `auto-approval` as the default for future sessions;
- **`/permission` picker** — switches the current session immediately (`/permission auto-approval`).

> While the plugin is disabled (`mode: off`), picking the Auto Approval tier behaves exactly like Workspace Write — the tier stays visible in both surfaces, but nothing is auto-approved.

## How it works

DSH routes every operation that needs approval through the `approval/request` waterfall (official docs: [approval seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md) / [Chinese](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.zh.md)). This plugin registers a listener with `prepend`, so it runs **before** the web approval prompt:

1. For each request it looks up the recorded `tool/call` event by `callId` in the session log and reads the **real tool arguments** (command text, `file_path`, `workdir`) — it never trusts the model-written justification string.
2. The pure decision core ([`lib/decide.js`](lib/decide.js)) classifies the request as `allow` or `defer`. Path containment is evaluated on **real identity**: the deepest existing ancestor of every candidate path is resolved through `realpath` (the same mechanism the DSH filesystem sandbox uses), so symlinks and junctions cannot smuggle an auto-approval to a target outside a trusted area.
3. `allow` returns `allowed-once` — the request never reaches the human UI; the audit pair `approval/asked` + `approval/decided: allowed-once` is still written to the session log, and the plugin logs the matched rule.
4. `defer` calls `next()` — the deployment's human answerer decides as usual. **The plugin never denies anything.**

For the formal architecture and request/decision flow, see [docs/architecture.md](docs/architecture.md) ([中文](docs/architecture.zh.md)).

### Two-layer model: what an agent may do on the Auto Approval tier

The tier's permission scope decomposes into exactly two layers (the architecture doc has the full seven-layer model; this is the user-facing summary):

- **Inner layer: the workspace-write execution boundary** — identical to the official Workspace Write tier, not broadened. The DSH sandbox enforces it per tool call: writes inside the session workspace and platform temp areas are allowed, everything else (file/command effects) is denied (reading anywhere stays allowed). Operations inside the workspace are allowed directly by the sandbox — **no approval request is ever raised for them**.
- **Outer layer: the auto-approval policy (this plugin)** — when an operation is denied by the inner layer and the agent explicitly retries with `sandbox_permissions`, the plugin decides, **before** the human answerer, on a small class of verifiably safe requests and returns `allowed-once`; everything else passes through to the human unchanged.
- **There is no third layer of privilege**: auto-approval is not Full access with the prompts removed — a granted call runs once with the escalation mode the agent asked for, the session's standing tier is untouched, and the plugin never denies anything.

In one sentence: **Auto Approval ≠ an automatic Full access**. It is exactly *the Workspace Write sandbox scope + an automatic adjudicator in front of the human confirmation step*.

## Install

```bash
# from the npm registry
dsh plugin --profile <profile> add dsh-auto-approval-plugin
# or from GitHub (pin a commit for reproducibility)
dsh plugin --profile <profile> add github:StyxNether/dsh-auto-approval-plugin#<commit>
```

The bundle patch restates the complete permission preset table (DSH patches replace a row's whole config), so keep it in sync with `@deepseek-ai/dsh-base`'s table when upgrading DSH — the patch warns and is skipped if the target row is missing.

## Configure

Two layers, both live (no restart needed):

1. **Web settings page** (easiest): Settings → **Auto Approval** (a dedicated page in the settings sidebar). The page has a single master switch "Enable auto-approval"; once enabled it asks for the scope: "Only when the session tier is Auto Approval" (default) or "Globally, regardless of the session tier". You can also edit trusted areas (one absolute path per line), the harmless/dangerous pattern tables, the decision length limit and the log switch there. Changes are written to the `auto-approval` section of `settings.yaml` and apply immediately. The page also shows the last few auto-approval decisions.
2. **Composition config** (the default base): set in your profile's `cordis.patch.yml`:

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: auto-approval
  config:
    # Master switch: off | global (any tier) | gated (auto-approval tier
    # only). Default after install: gated.
    mode: gated
    # Absolute paths treated as trusted areas. Commands whose workdir lies
    # inside one (and reference it), and fs write/edit targets inside one,
    # are auto-approved. Empty by default: the feature is inert until you
    # add areas.
    trustedAreas:
      - 'D:\data'
      - 'E:\repos'
    # Regex sources matched (case-insensitive) against command text.
    harmlessPatterns: [ ... ]   # defaults: see lib/decide.js
    dangerousPatterns: [ ... ]  # a match defers to the human, never denies
    maxCommandChars: 4000
    logDecisions: true
    # Non-loopback hosts allowed to reach the configuration HTTP API
    # (loopback is always allowed; cross-site requests are rejected).
    trustedHosts: []
```

> Legacy saved configurations (≤ 2.0.0, the `enabled` / `requireTrustedPreset` booleans) migrate to `mode` automatically when read — no manual step needed.

Settings values overlay the composition defaults; the web card marks fields you have overridden and offers a one-click reset back to the defaults.

### Every configuration option, and what changing it does

| Option | Default | What it does | Effect of changing it |
|---|---|---|---|
| `mode` | `gated` | Master switch + scope | `off`: disables auto-approval entirely (the Auto Approval tier then behaves exactly like Workspace Write); `global`: auto-approve under any session tier; `gated`: auto-approve only while the session tier is `auto-approval` |
| `trustedAreas` | `[]` | Trusted areas (absolute paths) | Empty: the plugin is left with only the harmless-introspection capability. Adding directories grants in-area git read commands, in-area simple commands, and in-area fs writes (see "Trusted area vs outside" below) |
| `harmlessPatterns` | read-only introspection set (see `lib/decide.js`) | Regexes that classify a command as "harmless"; a match (without shell metacharacters) auto-approves | Adding entries auto-approves more commands; removing restores human confirmation. **Add only read-only, side-effect-free commands** (the read surface should not exceed the DSH `read` tool) |
| `dangerousPatterns` | high-impact set (system wipes, privilege escalation, ACL, firewall, registry, persistence…) | A match defers to the human — **never auto-approved, never denied** | More entries send more high-impact operations to the human; fewer entries widen the auto window (**not recommended**). The principle is "rather wider than miss": a false positive costs one extra confirmation, a false negative could auto-approve a destructive command |
| `maxCommandChars` | `4000` | Length cap for commands/targets; longer inputs defer | Smaller: longer commands always ask; larger: longer commands may participate in auto-decision (mind the widening) |
| `logDecisions` | `true` | Whether each auto-approval is written to the process log (`auto-approval: granted … (rule)`) | `false` quiets the log but drops rule-level audit lines (the `approval/decided` audit pair in the session log is still written) |
| `trustedHosts` | `[]` | Non-loopback hosts allowed to reach the plugin's config HTTP API | Unset: loopback only. Adding entries allows remote management from those hosts (cross-site requests are still rejected) |

> All of the above apply immediately: `settings.yaml` is hot-reloaded and the web card saves take effect without a restart.

## Config file and log locations

`$DSH_HOME` defaults to `~/.dsh` (override with the `DSH_HOME` environment variable). The plugin reads/writes these locations:

| Content | Location | Notes |
|---|---|---|
| Plugin composition defaults | `<profile>/node_modules/dsh-auto-approval-plugin/cordis.patch.yml` | The bundle patch (default base layer); normally not hand-edited |
| Composition overlay | `~/.dsh/profiles/<profile>/cordis.patch.yml` | Add an `- id: auto-approval` block to override the defaults (example above) |
| User settings (hot-reloaded) | the `auto-approval:` section of `~/.dsh/settings.yaml` | Where the web card saves; **manual edits apply immediately**, no restart. Back it up first and keep the YAML valid: |
| Session audit log | `~/.dsh/sessions/<workspace>/<session-id>/session.jsonl.zstd` | zstd-compressed JSONL; every auto-approval is the audit pair `approval/asked` + `approval/decided: allowed-once`. Decompress with `zstd -d` to read |
| Process runtime log | The DSH process's standard error (the terminal/launcher that started the harness) | Plugin decision lines are prefixed `auto-approval:` (e.g. `granted pwsh call ... (harmless-command)`); warnings/errors appear here too |
| Recent approvals | memory only (the settings card shows the last 5) | Cleared when DSH restarts |

Hand-editing `settings.yaml`, canonical shape:

```yaml
auto-approval:
  mode: global                      # off | global | gated
  trustedAreas: ['D:\data', 'E:\repos']
  logDecisions: true
```

> Convention: do not hand-write the legacy `enabled` / `requireTrustedPreset` keys — they still migrate on read, but the next card save rewrites the section in `mode` form.

## What is auto-approved (rule table)

For `pwsh` / `bash` calls:

| Rule | Condition | Example |
|---|---|---|
| `harmless-command` | Pure introspection, no shell metacharacters (`; & \| < > \` ` $( newline`) | `ls -la`, `Get-Process`, `whoami`, `echo hello` |
| `harmless-repo-command` | git/hub read command **and** workdir inside a trusted area | `git status`, `git branch` in `D:\repos\app` |
| `trusted-area-command` | workdir inside a trusted area **and** the command references a trusted path | `Copy-Item D:\data\a D:\data\b` with workdir `D:\data` |

For `write` / `edit` (fs) calls:

| Rule | Condition | Example |
|---|---|---|
| `trusted-area-target` | `file_path` (absolute, or relative resolved against the session cwd / workdir) lies inside a trusted area | `write` to `D:\data\out.txt` |

Everything else — including `git pull`/`push`/`fetch`/`checkout`, `git diff`/`log -p` (they can run repo-configured textconv/pager programs), commands with redirection or pipes, writes outside trusted areas, and every other tool — **defers to the user**.

### The exact meaning of "trusted area"

A trusted area is **not** "everything inside runs without a human". Per-request:

- **Auto-approved**: a `write`/`edit` whose resolved target lies inside the area; or a **metacharacter-free** command run from a workdir inside the area that matches the harmless table (git/hub read families) or additionally references a trusted path.
- **Not auto-approved**: a command run from a trusted workdir that neither matches the harmless table nor references a trusted path (e.g. `Invoke-WebRequest`) → defers; any command containing shell metacharacters (`; & | < > \` ` $( newline`) → defers; anything matching `dangerousPatterns` → defers, inside trusted areas too.
- **Not even seen by the plugin**: writes into the current DSH workspace are allowed directly by the sandbox, so no approval request is ever raised.

### Trusted area vs outside: the actual privileges

Example: `D:\data` configured as a trusted area, `C:\work` as the session workspace ("inside" = workdir ∈ area / target ∈ area):

| Operation | Outside | Inside (trusted area) |
|---|---|---|
| `git status` (run inside `D:\data\repo`) | defers | ✅ auto-approved |
| `Copy-Item D:\data\a.txt D:\data\b.txt` | defers | ✅ auto-approved |
| `Remove-Item D:\data\build -Recurse` (cleanup) | defers | ✅ auto-approved |
| `write` / `edit` to `D:\data\…` | defers | ✅ auto-approved |
| `Get-Process`, `Get-Content`, … (harmless introspection) | ✅ auto-approved | ✅ auto-approved (no difference) |
| `echo hi > D:\data\x.txt` (redirection) | defers | defers (no metacharacter exemption) |
| `Invoke-WebRequest http://…` (trusted workdir, no area path referenced) | defers | defers (no arbitrary-command exemption) |
| `reg add` / `icacls` / `sudo …` (dangerous pattern) | defers | defers (no dangerous-operation exemption) |

The trusted area grants exactly three privileges: **in-area git read commands, in-area "simple single commands" (metacharacter-free and referencing an area path), and fs writes whose target resolves inside the area**. It never exempts metacharacters, arbitrary commands, or dangerous patterns.

### Deliberately never auto-approved

- Shell metacharacter commands (redirects, pipes, chaining, substitution) — the "harmless" window accepts only a single simple command; the trusted-area rule is bound by the same restriction.
- git operations that write, fetch or merge, and `git diff`/`git log -p` — untrusted repositories can weaponize git via `.git/config` (textconv, fsmonitor, pager), so git auto-approval requires a trusted workdir and stays on the read-only family.
- Anything matching `dangerousPatterns` — drive/system-root wipes, `rm -rf /`, `format`, `diskpart`, `shutdown`, fs targets inside `Windows` / `Program Files` / `ProgramData`, and since 2.1.0 also **privilege escalation** (`sudo`/`gsudo`/`runas`/`Start-Process -Verb RunAs`/`psexec`), **account & ACL changes** (`net user`/`net localgroup`/`*-LocalUser*`/`icacls`/`takeown`/`Set-Acl`), **security-control changes** (antivirus `*-MpPreference`, firewall `netsh`/`*-NetFirewall*`, `Set-ExecutionPolicy`), **persistence** (`sc`, `*-Service`, `schtasks`, `*-ScheduledTask`), **registry & boot** (`reg add/delete/import/save/restore`, `regedit /s`, `bcdedit`), **dynamic execution** (`Invoke-Expression`/`iex`/`-EncodedCommand`/`-enc`), **log tampering** (`wevtutil cl`/`Clear-EventLog`) and more — these defer to the human even inside trusted areas. The default table errs on the wider side: a false positive costs one extra human confirmation, never a denial.
- Requests whose `tool/call` cannot be found in the session log, or whose arguments are missing or oversized — no data, no auto-approval.

## Security

- **No secrets.** The plugin contains no API keys, no network access beyond its own same-origin config API, and no `eval`/dynamic code. It never reads configuration outside its own config and settings section.
- **Auditable.** Every auto-approval is a one-shot grant recorded in the session log (`approval/asked` + `approval/decided`) plus a logger line naming the matched rule; the settings card shows the most recent decisions.
- **Fail-safe direction.** Errors in the decision path log a warning and delegate; the plugin cannot deny, block, or lock out a session.
- **Gated config API.** `GET/PUT /api/dsh-auto-approval-plugin/config` accepts only loopback (or configured `trustedHosts`) same-origin requests; cross-site fetches are rejected. It reads and writes only the plugin's own settings namespace.
- See [SECURITY.md](SECURITY.md) for the threat model and reporting.

## Uninstall (no residue)

1. Remove the plugin: `dsh plugin --profile <profile> remove dsh-auto-approval-plugin`
2. Remove the trusted-area override from your profile's `cordis.patch.yml` (the `- id: auto-approval` entry, if you added one).
3. Remove the `auto-approval:` section from `settings.yaml` (written by the web card, if you saved there).
4. Verify no residue: `dsh --profile <profile> --dump-config` should contain no `auto-approval` row; `grep -n "auto-approval" ~/.dsh/settings.yaml` should find nothing.

Nothing else is touched: no other files, no sessions, no credentials.

## Development

```bash
npm test          # node:test unit tests for the decision core
npm run check     # syntax check + tests
node scripts/verify-composition.js <profile>   # offline composition/schema check
```

The decision core is dependency-free plain JavaScript; the plugin surface is a standard Cordis plugin (see `lib/index.js`). Architecture: [docs/architecture.md](docs/architecture.md). Relevant official material: [extension cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md), [plugin configuration](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md), [tool execution pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md).
