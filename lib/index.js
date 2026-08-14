/**
 * dsh-auto-approval — the "Trusted Auto" permission tier for DeepSeek Harness.
 *
 * Adds a permission preset between `workspace-write` and `danger-full-access`
 * (see cordis.patch.yml) and backs it with an automated approval answerer: a
 * `prepend`-registered listener on the `approval/request` waterfall that
 * auto-grants (`allowed-once`) requests whose underlying tool call is
 * verifiably safe — a harmless command, or an operation whose target lies in
 * a configured trusted area — and delegates every other request to the
 * deployment's human answerer via `next()`.
 *
 * Safety contract:
 *  - The listener NEVER denies: unmatched requests are delegated, never
 *    rejected, so this plugin cannot lock a session out of a legitimate ask.
 *  - Auto-approval is one-shot: it answers a single `approval/request`; the
 *    sandbox mode of the next call is resolved afresh by the session policy.
 *  - The decision uses the REAL tool arguments recorded in the session log
 *    (`tool/call` events keyed by `callId`), not the model-written
 *    justification string.
 *  - Dangerous-pattern matches short-circuit to delegation even inside
 *    trusted areas (defense in depth; the human answerer still decides).
 *  - By default the answerer is active only for sessions whose effective
 *    permission preset is `trusted-auto`.
 */

import { isAbsolute } from "node:path";
import z from "@deepseek-ai/schemastery";
import {
  classifyRequest,
  compilePatterns,
  DEFAULT_DANGEROUS_PATTERNS,
  DEFAULT_HARMLESS_PATTERNS,
  findToolCall,
  foldPath,
  parseArguments,
  resolveRealPath
} from "./decide.js";

export const name = "dsh-auto-approval";

/** No hard service dependency: everything the plugin reads is optional. */
export const inject = [];

export const Config = z.object({
  enabled: z.boolean().default(true),
  requireTrustedPreset: z.boolean().default(true),
  trustedAreas: z.array(z.string()).default([]),
  harmlessPatterns: z.array(z.string()).default(DEFAULT_HARMLESS_PATTERNS),
  dangerousPatterns: z.array(z.string()).default(DEFAULT_DANGEROUS_PATTERNS),
  maxCommandChars: z.number().default(4000),
  logDecisions: z.boolean().default(true)
});

/** The preset name this plugin backs (must match the `permission` row patch). */
export const PRESET_NAME = "trusted-auto";

const CASE_SENSITIVE = process.platform !== "win32";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function apply(ctx, config) {
  for (const area of config.trustedAreas) {
    if (!isAbsolute(area)) {
      throw new Error(`dsh-auto-approval: trustedAreas entries must be absolute paths, got "${area}"`);
    }
  }
  // Trusted roots are normalized to their REAL identity (symlinks/junctions
  // resolved) so containment checks compare like with like.
  const trustedRoots = config.trustedAreas.map((area) => foldPath(resolveRealPath(area), CASE_SENSITIVE));
  const harmlessPatterns = compilePatterns(config.harmlessPatterns);
  const dangerousPatterns = compilePatterns(config.dangerousPatterns);

  /** Whether auto-approval is active for one session (preset gate). */
  const isActiveFor = (session) => {
    if (!config.requireTrustedPreset) return true;
    const presets = ctx.get("permissionPresets");
    if (presets === void 0) return false;
    try {
      return presets.current(session.events) === PRESET_NAME;
    } catch {
      return false;
    }
  };

  /**
   * The automated answerer. Registered with `prepend` so it runs BEFORE the
   * deployment's terminal answerer (e.g. the web approval prompt): a request
   * that qualifies returns `allowed-once` and never reaches the human UI; any
   * other request calls `next()` and the human answerer decides as usual.
   */
  ctx.on(
    "approval/request",
    (req, next) => {
      if (!config.enabled) return next();
      try {
        if (!isActiveFor(req.agent.session)) return next();
        const call = findToolCall(req.agent.session.events, req.callId, req.toolName);
        if (call === void 0) return next();
        const args = parseArguments(call.arguments);
        if (args === null) return next();
        const outcome = classifyRequest({
          toolName: req.toolName,
          args,
          baseDir: req.agent.session.header.cwd,
          trustedRoots,
          harmlessPatterns,
          dangerousPatterns,
          maxCommandChars: config.maxCommandChars,
          caseSensitive: CASE_SENSITIVE
        });
        if (outcome.decision !== "allow") return next();
        if (config.logDecisions) {
          ctx.logger.info(`auto-approval: granted ${req.toolName} call ${req.callId ?? "(no call id)"} (${outcome.rule})`);
        }
        return "allowed-once";
      } catch (error) {
        ctx.logger.warn(`auto-approval: decision failed for ${req.toolName} call ${req.callId ?? "(no call id)"}; delegating (${errorMessage(error)})`);
        return next();
      }
    },
    { prepend: true }
  );

  // Model-facing narration: tells the agent the tier is active and which
  // areas are auto-approved, so it can target them instead of asking.
  ctx.inject(["systemPrompt"], (scope) => {
    scope.systemPrompt.context({
      name: "auto-approval:policy",
      order: 116,
      text: (context) => {
        const agent = context.agent;
        if (agent === void 0 || !isActiveFor(agent.session)) return "";
        const areas = config.trustedAreas.length === 0
          ? ""
          : ` Trusted areas: ${config.trustedAreas.join(", ")}.`;
        return "Trusted auto-approval is active: harmless commands and operations whose target lies inside a configured trusted area (including areas outside the current workspace) are approved automatically. You may retry a sandbox-denied operation once with sandbox_permissions (the narrowest wider mode) and a one-sentence justification when it matches these criteria; other escalation requests still ask the user." + areas;
      }
    });
  });
}
