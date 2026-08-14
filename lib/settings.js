/**
 * dsh-auto-approval-plugin — settings namespace.
 *
 * The user-editable configuration lives in the `auto-approval` settings
 * namespace (`settings.yaml`), resolved against the composition defaults as
 * the `base` layer. Every read goes through the settings service so changes
 * made in the web settings card apply immediately, without a restart.
 */

import { isAbsolute } from "node:path";
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { DEFAULT_DANGEROUS_PATTERNS, DEFAULT_HARMLESS_PATTERNS } from "./decide.js";

/** The settings namespace key for this plugin's user-editable section. */
export const NS = settingsNamespace("auto-approval");

/** The namespace schema; mirrors the composition Config with the same defaults. */
export const schema = z.object({
  enabled: z.boolean().default(true),
  requireTrustedPreset: z.boolean().default(true),
  trustedAreas: z.array(z.string()).default([]),
  harmlessPatterns: z.array(z.string()).default(DEFAULT_HARMLESS_PATTERNS),
  dangerousPatterns: z.array(z.string()).default(DEFAULT_DANGEROUS_PATTERNS),
  maxCommandChars: z.number().default(4000),
  logDecisions: z.boolean().default(true)
});

/** Extract the composition-config fields the settings namespace overlays. */
export function defaultsOf(config) {
  return {
    enabled: config.enabled,
    requireTrustedPreset: config.requireTrustedPreset,
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
