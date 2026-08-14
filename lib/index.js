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
 * Configuration is layered: the composition config (cordis.patch.yml) is the
 * default base, and the `auto-approval` settings namespace (settings.yaml,
 * editable from the web settings card) overlays it live — every decision
 * reads the merged value, so changes apply without a restart.
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
 *  - The configuration HTTP surface is same-origin gated (loopback or
 *    configured trusted hosts, cross-site requests rejected) and touches
 *    only this plugin's own settings namespace.
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
import { assertValidEffectiveConfig, defaultsOf, NS, schema as settingsSchema } from "./settings.js";
import { CONFIG_PATH, createHandlers, STATUS_PATH } from "./http.js";

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
  logDecisions: z.boolean().default(true),
  /** Non-loopback authorities allowed to reach the configuration HTTP API. */
  trustedHosts: z.array(z.string()).default([])
});

/** The preset name this plugin backs (must match the `permission` row patch). */
export const PRESET_NAME = "trusted-auto";

const CASE_SENSITIVE = process.platform !== "win32";
const MAX_RECENT_DECISIONS = 50;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function apply(ctx, config) {
  for (const area of config.trustedAreas) {
    if (!isAbsolute(area)) {
      throw new Error(`dsh-auto-approval: trustedAreas entries must be absolute paths, got "${area}"`);
    }
  }
  assertValidEffectiveConfig(config);

  // ── live configuration ──────────────────────────────────────────────────
  // Composition config is the `base` layer; the settings namespace overlays
  // it. `effective()` is read at every decision boundary so web-card edits
  // apply immediately. The row itself has no hard service dependency, so it
  // may activate BEFORE long-lived providers are ready: everything that
  // needs a service waits via ctx.inject (service-availability driven).
  let scope;
  ctx.inject(["settings"], (settingsService) => {
    scope = settingsService.register(NS, settingsSchema, {
      base: defaultsOf(config),
      validate: assertValidEffectiveConfig
    });
  });
  const effective = () => scope === void 0 ? config : scope.get();

  const compileFrom = (cfg) => ({
    trustedRoots: cfg.trustedAreas.map((area) => foldPath(resolveRealPath(area), CASE_SENSITIVE)),
    harmlessPatterns: compilePatterns(cfg.harmlessPatterns),
    dangerousPatterns: compilePatterns(cfg.dangerousPatterns)
  });

  // Recent auto-approval decisions, for the status surface (memory only).
  const recentDecisions = [];
  const remember = (toolName, callId, rule) => {
    recentDecisions.push({ time: Date.now(), toolName, callId, rule });
    if (recentDecisions.length > MAX_RECENT_DECISIONS) recentDecisions.shift();
  };

  /** Whether auto-approval is active for one session (preset gate). */
  const isActiveFor = (session, cfg) => {
    if (!cfg.requireTrustedPreset) return true;
    const presets = ctx.get("permissionPresets", false);
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
      try {
        const cfg = effective();
        if (!cfg.enabled) return next();
        if (!isActiveFor(req.agent.session, cfg)) return next();
        const call = findToolCall(req.agent.session.events, req.callId, req.toolName);
        if (call === void 0) return next();
        const args = parseArguments(call.arguments);
        if (args === null) return next();
        const compiled = compileFrom(cfg);
        const outcome = classifyRequest({
          toolName: req.toolName,
          args,
          baseDir: req.agent.session.header.cwd,
          trustedRoots: compiled.trustedRoots,
          harmlessPatterns: compiled.harmlessPatterns,
          dangerousPatterns: compiled.dangerousPatterns,
          maxCommandChars: cfg.maxCommandChars,
          caseSensitive: CASE_SENSITIVE
        });
        if (outcome.decision !== "allow") return next();
        remember(req.toolName, req.callId ?? null, outcome.rule);
        if (cfg.logDecisions) {
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
        if (agent === void 0) return "";
        const cfg = effective();
        if (!isActiveFor(agent.session, cfg)) return "";
        const areas = cfg.trustedAreas.length === 0
          ? ""
          : ` Trusted areas: ${cfg.trustedAreas.join(", ")}.`;
        return "Trusted auto-approval is active: harmless commands and operations whose target lies inside a configured trusted area (including areas outside the current workspace) are approved automatically. You may retry a sandbox-denied operation once with sandbox_permissions (the narrowest wider mode) and a one-sentence justification when it matches these criteria; other escalation requests still ask the user." + areas;
      }
    });
  });

  // ── configuration HTTP surface (web settings card) ──────────────────────
  // Registered through ctx.inject so the routes appear once webServer is
  // provided, even when this row activated before it.
  ctx.inject(["webServer"], (webServer) => {
    const trustedHosts = [...config.trustedHosts];
    const readConfig = () => ({
      value: effective(),
      defaults: defaultsOf(config)
    });
    const writeConfig = async (body) => {
      if (scope === void 0) throw new Error("settings service is not composed; configuration cannot be persisted");
      if (body.$reset === true) {
        await scope.replace({});
        return readConfig();
      }
      const patch = { ...body };
      delete patch.$reset;
      await scope.update(patch);
      return readConfig();
    };
    const readStatus = () => {
      const presets = ctx.get("permissionPresets", false);
      return {
        presetNames: presets === void 0 ? [] : presets.names,
        recent: [...recentDecisions]
      };
    };
    const { api } = createHandlers({
      trustedHosts,
      readConfig,
      writeConfig,
      readStatus,
      onError: (error) => ctx.logger.warn(`auto-approval: config API error: ${errorMessage(error)}`)
    });
    ctx.effect(() => webServer.register({ kind: "exact", path: CONFIG_PATH, handler: api }), "dsh-auto-approval: config route");
    ctx.effect(() => webServer.register({ kind: "exact", path: STATUS_PATH, handler: api }), "dsh-auto-approval: status route");
  });
}
