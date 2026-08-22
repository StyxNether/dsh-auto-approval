# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 2.x | ✅ |
| 1.x | ✅ (migrates automatically to the 2.x `mode` shape) |

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report privately to the repository owner via GitHub's [private vulnerability reporting](https://github.com/StyxNether/dsh-auto-approval-plugin/security/advisories/new) (Security → Report a vulnerability), or open a draft security advisory.

Please include:

- the affected version and DSH version;
- a minimal reproduction;
- the impact you believe applies.

You should receive a reply within 7 days.

## Threat model

This plugin automates the human approval step for a deliberately narrow class of requests. It is **not** a security boundary:

- The DSH sandbox (`workspace-write` mode) still confines every non-escalated call. Auto-approval only ever produces the same one-shot grant a human click on the approval prompt would produce.
- The decision core reads only the session log (`tool/call` arguments) and its own configuration. It contains no secrets, no network access, no `eval`, and no dynamic code.
- The plugin never denies a request: every non-qualifying request is delegated to the deployment's human answerer, and any error in the decision path also delegates. It cannot lock a session out.
- The `mode` switch is the master control: `off` disables the answerer entirely; `gated` (the default) limits it to sessions whose effective preset is `auto-approval`; `global` applies it to every session. Configurations saved by ≤ 2.0.0 (`enabled` / `requireTrustedPreset`) migrate to `mode` automatically.
- `dangerousPatterns` is scope control for the auto-approval window, not an access-control mechanism — a matched pattern defers to the human, it does not stop the operation.
- The configuration HTTP surface (`/api/dsh-auto-approval-plugin/config`, `/api/dsh-auto-approval-plugin/status`) is gated by the same trusted-origin rule the DSH upload manager uses: loopback hosts or configured `trustedHosts` only, cross-site fetches rejected, and an `Origin` header must match the `Host`. It exposes no secrets and reads/writes only the plugin's own `auto-approval` settings namespace. Settings writes are validated (trusted areas must be absolute paths, regexes must compile) before persistence.

### Trusted-area semantics (what "inside a trusted area" means)

A trusted area is **not** an "everything inside runs without a human" zone. The auto-approval window per request is:

- **`write` / `edit` calls**: auto-approved when the resolved target path lies inside a trusted area (relative paths resolve against the session cwd/workdir first; the deepest existing ancestor is realpath-resolved).
- **`pwsh` / `bash` commands**, three gates, all of which require **no shell metacharacters** (`; & | < > \` ` $( ` newline):
  1. A command matching `harmlessPatterns`:
     - plain introspection (not git/hub) — auto-approved **anywhere**, trusted area or not;
     - git/hub read families — auto-approved **only when the workdir is inside a trusted area**.
  2. Any other command — auto-approved only when the workdir is inside a trusted area **and** the command text references a trusted path.
  3. A `dangerousPatterns` match defers **before** any of the above, inside trusted areas too.
- Anything else defers to the human answerer. In particular, a command run from a trusted workdir that neither matches `harmlessPatterns` nor references a trusted path — e.g. `Invoke-WebRequest` — is **not** auto-approved.
- Operations inside the current DSH workspace never reach this plugin at all: the DSH filesystem sandbox allows them directly, so no approval request is raised.

### Known limitations (accepted by design)

- The trusted-area and harmless-command checks are **heuristics** over command text and paths, not a capability analysis. A command that exactly matches the harmless grammar is still executed with the escalated mode for that one call. Treat trusted areas as "areas whose simple commands may run without a human in the loop".
- git read commands are auto-approved only when the working directory is inside a trusted area, because untrusted repositories can weaponize git through `.git/config` (textconv, fsmonitor, pager). Trusted areas should therefore only contain repositories you also trust.
- Path containment resolves the deepest existing ancestor through `realpath` (symlinks/junctions are followed), matching the DSH sandbox's own canonicalization. A **time-of-check/time-of-use race** remains: a junction swapped between the approval decision and the tool's execution is not re-verified by this plugin (the sandbox's one-call escalation grant inherits the same accepted race from DSH core). Paths whose ancestors do not exist at decision time match nothing until they exist — the conservative outcome.
- The default `harmlessPatterns` read surface (e.g. `Get-Content`, `cat`) is no larger than what the DSH `read` tool already permits in any session mode; convenience was extended only over read-only, side-effect-free commands. The default `dangerousPatterns` list errs on the side of deferring high-impact operations (privilege escalation, persistence, security-control changes, registry/ACL/firewall mutation); a false positive only routes one request to the human answerer.