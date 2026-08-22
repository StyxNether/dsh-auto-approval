# Architecture

How `dsh-auto-approval-plugin` is put together, and how a request flows
through it. Terminology follows the [DSH approval seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md):
*request* = one `approval/request`; *answerer* = a waterfall listener that
produces an `ApprovalOutcome`; *grant* = the `allowed-once` outcome.

## Components

| File | Role |
|---|---|
| `lib/index.js` | Cordis plugin entry (`apply`): row registration, the `approval/request` answerer, model-facing prompt narration, and the configuration HTTP surface. |
| `lib/decide.js` | Pure, dependency-free decision core (`classifyRequest`). No Cordis imports; unit-tested in isolation. |
| `lib/settings.js` | The `auto-approval` settings namespace: schema, `mode` vocabulary, legacy migration helpers, validation. |
| `lib/http.js` | Same-origin-gated REST handlers for the web settings card. |
| `client.js` | Web client plugin: the Auto Approval page in the settings sidebar (`settings.section` slot), i18n dictionaries, status display. |
| `cordis.patch.yml` | Bundle patch: restates the permission preset table, inserts the `auto-approval` row with its defaults. |

## Request flow

```
tool call (pwsh/bash/write/edit)
  └─ sandbox denies, model retries with sandbox_permissions + justification
       └─ dsh-tools → approval.request({agent, toolName, callId, reason})
            ├─ session.append("approval/asked", {id, toolName, callId})
            └─ ApprovalService.decide → ctx.waterfall("approval/request", ...)
                 ├─ this plugin's answerer (prepend):
                 │    1. effective config (mode off/gated/global gate) → next() if inactive
                 │    2. findToolCall(session.events, callId, toolName) → real arguments
                 │    3. classifyRequest → "allow" → return "allowed-once" (chain stops)
                 │                    → "defer"/error → next()
                 │    4. remember() + ctx.logger.info (audit aid)
                 └─ next answerer (e.g. dsh-host-apiproxy → browser prompt)
                       → "allowed-once" | "rejected" | "cancelled" | "unavailable"
            └─ session.append("approval/decided", {id, outcome})   (audit pair)
```

The answerer returns `"allowed-once"` **only** for requests it can verify
from the recorded `tool/call` arguments. Every other path calls `next()`;
the plugin never produces `rejected`/`cancelled`, so it cannot lock a
session out.

## Decision core (`classifyRequest`)

Order of checks, first match wins:

1. tool not `pwsh`/`bash`/`write`/`edit` → `defer`
2. missing/oversized inputs → `defer`
3. `dangerousPatterns` match → `defer` (scope control, checked first for commands and targets)
4. command tools:
   - no shell metacharacters (`; & | < > \` ` $( ` newline):
     - `harmlessPatterns` match + not git/hub → `allow` anywhere
     - `harmlessPatterns` match + git/hub → `allow` only when workdir ∈ trusted area
     - workdir ∈ trusted area + command references a trusted path → `allow`
   - everything else → `defer`
5. fs tools: resolved target ∈ trusted area → `allow`; else `defer`

Path containment runs on **real identity**: the deepest existing ancestor is
realpath-resolved (same canonicalization the DSH filesystem sandbox uses),
so symlinks/junctions cannot smuggle a target outside a trusted area.

## Configuration lifecycle

```
cordis.patch.yml (composition base)      ← bundle patch, defaults
        ▼
auto-approval settings namespace          ← ~/.dsh/settings.yaml user layer,
   (schema defaults → base → user layer)    hot-reloaded, web card writes here
        ▼
effective() = normalizeConfig(resolved)   ← legacy booleans folded into mode
        ▼
read at every decision boundary           ← card edits apply immediately
```

Legacy documents from ≤ 2.0.0 (`enabled` / `requireTrustedPreset`) are
folded into `mode` on every read (`normalizeConfig`), and a one-shot
migration (`replace`) strips the stored legacy keys once, both at plugin
start and after any write from an older client.

## Security contract

- **Never denies**: unmatched, unsupported, unparseable, or erroring
  requests all delegate via `next()`.
- **One-shot**: `allowed-once` grants exactly the one call that asked; the
  session's standing sandbox mode is untouched.
- **Real arguments, not justifications**: the decision reads the recorded
  `tool/call` event by `callId` from the session log.
- **Gated surface**: the config API accepts only loopback (or configured
  `trustedHosts`) same-origin requests; `trustedHosts` itself is
  composition-only and cannot be altered through the API.
- **Validation before persist**: settings writes resolve through the schema
  and `assertValidEffectiveConfig` (absolute trusted areas, compilable
  regexes) before anything is written to disk.