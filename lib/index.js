/**
 * dsh-auto-approval-plugin — the "Trusted Auto" permission tier for DeepSeek Harness.
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
 *    permission preset is `auto-approval`.
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
import {
  assertValidEffectiveConfig,
  defaultsOf,
  hasLegacyShape,
  normalizeConfig,
  NS,
  schema as settingsSchema
} from "./settings.js";
import { CONFIG_PATH, HttpError, createHandlers, STATUS_PATH } from "./http.js";

export const name = "dsh-auto-approval-plugin";

/** No hard service dependency: everything the plugin reads is optional. */
export const inject = [];

export const Config = z.object({
  /** Master switch: off | global (any preset) | gated (auto-approval preset only). */
  mode: z.union(["off", "global", "gated"]).default("gated"),
  trustedAreas: z.array(z.string()).default([]),
  harmlessPatterns: z.array(z.string()).default(DEFAULT_HARMLESS_PATTERNS),
  dangerousPatterns: z.array(z.string()).default(DEFAULT_DANGEROUS_PATTERNS),
  maxCommandChars: z.number().default(4000),
  logDecisions: z.boolean().default(true),
  /** Non-loopback authorities allowed to reach the configuration HTTP API. */
  trustedHosts: z.array(z.string()).default([])
});

/** The preset name this plugin backs (must match the `permission` row patch). */
export const PRESET_NAME = "auto-approval";

const CASE_SENSITIVE = process.platform !== "win32";
const MAX_RECENT_DECISIONS = 50;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function apply(ctx, config) {
  // A composition row written by ≤ 2.0.0 may carry the legacy boolean shape;
  // fold it into `mode` here so every consumer (base layer, decisions) sees
  // the canonical config. The schema tolerates the extra keys, so an old
  // cordis.patch.yml overlay still boots.
  const normalized = normalizeConfig(config);
  for (const area of normalized.trustedAreas) {
    if (!isAbsolute(area)) {
      throw new Error(`dsh-auto-approval-plugin: trustedAreas entries must be absolute paths, got "${area}"`);
    }
  }
  assertValidEffectiveConfig(normalized);

  // ── live configuration ──────────────────────────────────────────────────
  // Composition config is the `base` layer; the settings namespace overlays
  // it. `effective()` is read at every decision boundary so web-card edits
  // apply immediately. The row itself has no hard service dependency, so it
  // may activate BEFORE long-lived providers are ready: everything that
  // needs a service waits via ctx.inject (service-availability driven). The
  // inject callback receives the CHILD CONTEXT; services are reached as
  // injected properties on it.
  /**
   * Rewrite a legacy user section to the canonical `mode` shape. `replace`
   * (not `update`) is required: a merge cannot remove the stored legacy keys.
   * A plain function declaration (hoisted) so the inject callback below may
   * invoke it even when the settings service is already available.
   */
  async function migrateLegacySection() {
    if (scope === void 0) return;
    const current = scope.get();
    if (!hasLegacyShape(current)) return;
    await scope.replace(normalizeConfig(current));
  }

  let scope;
  ctx.inject(["settings"], (settingsCtx) => {
    scope = settingsCtx.settings.register(NS, settingsSchema, {
      base: defaultsOf(normalized),
      validate: assertValidEffectiveConfig
    });
    // One-shot migration: a user document written by a plugin version that
    // stored `enabled` / `requireTrustedPreset` is rewritten to the canonical
    // `mode` shape, so the legacy keys stop circulating (and stop showing as
    // phantom card fields). Failures only log; the normalized read path keeps
    // behavior correct either way.
    migrateLegacySection().catch((error) => {
      ctx.logger.warn(`auto-approval: legacy settings migration failed; continuing (${errorMessage(error)})`);
    });
  });
  const effective = () => normalizeConfig(scope === void 0 ? normalized : scope.get());

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

  /** Whether auto-approval is active for one session (mode + preset gate). */
  const isActiveFor = (session, cfg) => {
    if (cfg.mode === "global") return true;
    if (cfg.mode !== "gated") return false;
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
        if (cfg.mode === "off") return next();
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
        return "Auto Approval is active: harmless commands and operations whose target lies inside a configured trusted area (including areas outside the current workspace) are approved automatically. You may retry a sandbox-denied operation once with sandbox_permissions (the narrowest wider mode) and a one-sentence justification when it matches these criteria; other escalation requests still ask the user." + areas;
      }
    });
  });

  // ── configuration HTTP surface (web settings card) ──────────────────────
  // Registered through ctx.inject so the routes appear once webServer is
  // provided, even when this row activated before it. The callback receives
  // the child context; the service is its injected `webServer` property.
  ctx.inject(["webServer"], (webCtx) => {
    const webServer = webCtx.webServer;
    const trustedHosts = [...normalized.trustedHosts];
    const readConfig = () => ({
      value: effective(),
      defaults: defaultsOf(normalized)
    });
    const writeConfig = async (body) => {
      if (scope === void 0) throw new Error("settings service is not composed; configuration cannot be persisted");
      try {
        if (body.$reset === true) {
          await scope.replace({});
          return readConfig();
        }
        // Normalize the patch to the canonical shape: legacy boolean fields
        // are folded into `mode` and dropped, unknown keys never reach the
        // user document (schemastery would otherwise persist them verbatim).
        const patch = normalizeConfig(body);
        delete patch.$reset;
        await scope.update(patch);
        // Clean a stored legacy section after a write from an older client.
        await migrateLegacySection();
        return readConfig();
      } catch (error) {
        // Validation failures surface as 400 with the real message; unknown
        // server faults stay a generic 500 via the handler's error path.
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, errorMessage(error));
      }
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
    webCtx.effect(() => webServer.register({ kind: "exact", path: CONFIG_PATH, handler: api }), "dsh-auto-approval-plugin: config route");
    webCtx.effect(() => webServer.register({ kind: "exact", path: STATUS_PATH, handler: api }), "dsh-auto-approval-plugin: status route");
  });
}
