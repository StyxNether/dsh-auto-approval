# dsh-auto-approval

> 🌐 **Language**: English | [简体中文](README.zh.md)

A middle permission tier for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), between **Workspace Write** and **Full access** (danger-full-access): it adds a `trusted-auto` preset to the permission settings and backs it with an automated approval answerer that approves **harmless commands** and operations whose target lies inside **configured trusted areas** — including areas outside the current workspace — and asks the user for everything else.

> ⚠️ **Scope control, not a security boundary.** This plugin automates the *human* approval step for a narrow, verifiable class of requests. The DSH sandbox still confines every non-escalated call; an auto-approved call runs with the wider mode for exactly that one call (the same one-shot grant a human click would produce). Do not use it on machines or sessions you would not trust a human operator to run commands on.

## What it does

| | Workspace Write | **Trusted Auto** (this plugin) | Full access |
|---|---|---|---|
| Sandbox mode | `workspace-write` | `workspace-write` | `danger-full-access` |
| Approval policy | `ask` | `ask` | `never` |
| Writes inside workspace / temp | allowed | allowed | allowed |
| Harmless commands (see rule table) | ask | **auto-approved** | never asks |
| Targets inside trusted areas | ask | **auto-approved** | never asks |
| Everything else | ask | ask | never asks |

After installing, the new preset appears in both permission surfaces:

- **General settings → Permission** — sets `trusted-auto` as the default for future sessions;
- **`/permission` picker** — switches the current session immediately (`/permission trusted-auto`).

## How it works

DSH routes every operation that needs approval through the `approval/request` waterfall ([approval seam](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/approval.md)). This plugin registers a listener with `prepend`, so it runs **before** the web approval prompt:

1. For each request it looks up the recorded `tool/call` event by `callId` in the session log and reads the **real tool arguments** (command text, `file_path`, `workdir`) — it never trusts the model-written justification string.
2. The pure decision core ([`lib/decide.js`](lib/decide.js)) classifies the request as `allow` or `defer`. Path containment is evaluated on **real identity**: the deepest existing ancestor of every candidate path is resolved through `realpath` (the same mechanism the DSH filesystem sandbox uses), so symlinks and junctions cannot smuggle an auto-approval to a target outside a trusted area.
3. `allow` returns `allowed-once` — the request never reaches the human UI; the audit pair `approval/asked` + `approval/decided: allowed-once` is still written to the session log, and the plugin logs the matched rule.
4. `defer` calls `next()` — the deployment's human answerer decides as usual. **The plugin never denies anything.**

## Install

```bash
# from the repo (recommended: pin a commit)
dsh plugin add github:StyxNether/dsh-auto-approval#<commit>
```

The bundle patch restates the complete permission preset table (DSH patches replace a row's whole config), so keep it in sync with `@deepseek-ai/dsh-base`'s table when upgrading DSH — the patch warns and is skipped if the target row is missing.

## Configure

All knobs live in the plugin row config. Set them in your profile's `cordis.patch.yml`:

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: auto-approval
  config:
    # Absolute paths treated as trusted areas. Commands whose workdir lies
    # inside one (and reference it), and fs write/edit targets inside one,
    # are auto-approved. Empty by default: the feature is inert until you
    # add areas.
    trustedAreas:
      - 'D:\data'
      - 'E:\repos'
    # Only sessions whose effective preset is `trusted-auto` auto-approve.
    requireTrustedPreset: true
    # Regex sources matched (case-insensitive) against command text.
    harmlessPatterns: [ ... ]   # defaults: see lib/decide.js
    dangerousPatterns: [ ... ]  # a match defers to the human, never denies
    maxCommandChars: 4000
    logDecisions: true
```

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

### Deliberately never auto-approved

- Shell metacharacter commands (redirects, pipes, chaining, substitution) — the "harmless" window accepts only a single simple command.
- git operations that write, fetch or merge, and `git diff`/`git log -p` — untrusted repositories can weaponize git via `.git/config` (textconv, fsmonitor, pager), so git auto-approval requires a trusted workdir and stays on the read-only family.
- Anything matching `dangerousPatterns` (drive/system-root wipes, `rm -rf /`, `format`, `diskpart`, `shutdown`, fs targets inside `Windows` / `Program Files`, …) — these defer to the human even inside trusted areas.
- Requests whose `tool/call` cannot be found in the session log, or whose arguments are missing or oversized — no data, no auto-approval.

## Security

- **No secrets.** The plugin contains no API keys, no network access, and no `eval`/dynamic code. It never reads configuration outside its own config.
- **Auditable.** Every auto-approval is a one-shot grant recorded in the session log (`approval/asked` + `approval/decided`) plus a logger line naming the matched rule.
- **Fail-safe direction.** Errors in the decision path log a warning and delegate; the plugin cannot deny, block, or lock out a session.
- See [SECURITY.md](SECURITY.md) for the threat model and reporting.

## Development

```bash
npm test          # node:test unit tests for the decision core
npm run check     # syntax check + tests
```

The decision core is dependency-free plain JavaScript; the plugin surface is a standard Cordis plugin (see `lib/index.js`).

## License

MIT — see [LICENSE](LICENSE).
