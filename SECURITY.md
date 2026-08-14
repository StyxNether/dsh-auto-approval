# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x | ✅ |

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report privately to the repository owner via GitHub's [private vulnerability reporting](https://github.com/StyxNether/dsh-auto-approval/security/advisories/new) (Security → Report a vulnerability), or open a draft security advisory.

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
- `dangerousPatterns` is scope control for the auto-approval window, not an access-control mechanism — a matched pattern defers to the human, it does not stop the operation.

### Known limitations (accepted by design)

- The trusted-area and harmless-command checks are **heuristics** over command text and paths, not a capability analysis. A command that exactly matches the harmless grammar is still executed with the escalated mode for that one call. Treat trusted areas as "areas whose commands may run without a human in the loop".
- git read commands are auto-approved only when the working directory is inside a trusted area, because untrusted repositories can weaponize git through `.git/config` (textconv, fsmonitor, pager). Trusted areas should therefore only contain repositories you also trust.
- Path containment resolves the deepest existing ancestor through `realpath` (symlinks/junctions are followed), matching the DSH sandbox's own canonicalization. A **time-of-check/time-of-use race** remains: a junction swapped between the approval decision and the tool's execution is not re-verified by this plugin (the sandbox's one-call escalation grant inherits the same accepted race from DSH core). Paths whose ancestors do not exist at decision time match nothing until they exist — the conservative outcome.
