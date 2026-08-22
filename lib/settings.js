/**
 * dsh-auto-approval-plugin — settings namespace.
 *
 * The user-editable configuration lives in the `auto-approval` settings
 * namespace (`settings.yaml`), resolved against the composition defaults as
 * the `base` layer. Every read goes through the settings service so changes
 * made in the web settings card apply immediately, without a restart.
 *
 * ### The `mode` switch
 *
 * The card exposes one master control with three states:
 *
 * - `off`    — the automated answerer is completely disabled; picking the
 *              `auto-approval` preset then behaves exactly like
 *              `workspace-write`.
 * - `global` — auto-approval applies regardless of the session's preset.
 * - `gated`  — auto-approval applies only while the session's effective
 *              preset is `auto-approval` (the default after install).
 *
 * Versions ≤ 2.0.0 stored two booleans (`enabled`, `requireTrustedPreset`).
 * The helpers below translate that legacy shape into `mode` on read and
 * strip the legacy keys on write, so existing `settings.yaml` sections and
 * composition configs keep working with no manual migration.
 */

import { isAbsolute } from "node:path";
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { DEFAULT_DANGEROUS_PATTERNS, DEFAULT_HARMLESS_PATTERNS } from "./decide.js";

/** The `mode` vocabulary: off | global | gated. */
export const MODES = ["off", "global", "gated"];

/** The settings namespace key for this plugin's user-editable section. */
export const NS = settingsNamespace("auto-approval");

/** The namespace schema; mirrors the composition Config with the same defaults. */
export const schema = z.object({
  mode: z.union(["off", "global", "gated"]).default("gated"),
  trustedAreas: z.array(z.string()).default([]),
  harmlessPatterns: z.array(z.string()).default(DEFAULT_HARMLESS_PATTERNS),
  dangerousPatterns: z.array(z.string()).default(DEFAULT_DANGEROUS_PATTERNS),
  maxCommandChars: z.number().default(4000),
  logDecisions: z.boolean().default(true)
});

/**
 * Whether a resolved value still carries the legacy boolean shape
 * (`enabled` / `requireTrustedPreset`), i.e. comes from a settings.yaml
 * section or composition config written before the `mode` switch existed.
 */
export function hasLegacyShape(value) {
  return value !== null && typeof value === "object"
    && ("enabled" in value || "requireTrustedPreset" in value);
}

/**
 * Derive the `mode` value from legacy booleans.
 * `enabled=false` → off; `enabled=true` without a preset gate → global;
 * everything else (including a missing legacy pair) → gated.
 */
export function modeFromLegacy(enabled, requireTrustedPreset) {
  if (enabled === false) return "off";
  if (requireTrustedPreset === false) return "global";
  return "gated";
}

/**
 * Normalize one config object to the canonical `mode` shape: resolves
 * legacy boolean fields into `mode` and removes the legacy keys. Used at
 * every consumption boundary (decisions, prompt narration, config API) so
 * stale user documents cannot leak legacy keys into the card or the model.
 */
export function normalizeConfig(value) {
  const out = { ...value };
  if (hasLegacyShape(out)) {
    out.mode = modeFromLegacy(out.enabled, out.requireTrustedPreset);
    delete out.enabled;
    delete out.requireTrustedPreset;
  }
  return out;
}

/** Extract the composition-config fields the settings namespace overlays. */
export function defaultsOf(config) {
  return {
    mode: config.mode,
    trustedAreas: config.trustedAreas,
    harmlessPatterns: config.harmlessPatterns,
    dangerousPatterns: config.dangerousPatterns,
    maxCommandChars: config.maxCommandChars,
    logDecisions: config.logDecisions
  };
}

/**
 * Extra validation the settings schema cannot express; runs on every resolve
 * (including each write). Throws on invalid input, which rejects the write
 * before anything is persisted.
 * @param value - the resolved effective config.
 * @returns the same value when valid.
 */
export function assertValidEffectiveConfig(value) {
  for (const area of value.trustedAreas ?? []) {
    if (typeof area !== "string" || !isAbsolute(area)) {
      throw new Error(`trustedAreas entries must be absolute paths, got ${JSON.stringify(area)}`);
    }
  }
  for (const key of ["harmlessPatterns", "dangerousPatterns"]) {
    for (const source of value[key] ?? []) {
      if (typeof source !== "string") throw new Error(`${key} entries must be strings`);
      try {
        new RegExp(source, "i");
      } catch (error) {
        throw new Error(`invalid regex in ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return value;
}