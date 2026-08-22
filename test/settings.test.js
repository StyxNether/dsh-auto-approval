import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertValidEffectiveConfig,
  defaultsOf,
  hasLegacyShape,
  modeFromLegacy,
  normalizeConfig,
  schema
} from "../lib/settings.js";

test("settings schema resolves defaults for an empty section", () => {
  const resolved = schema["~standard"].validate({});
  assert.equal(resolved.value.mode, "gated");
  assert.deepEqual(resolved.value.trustedAreas, []);
  assert.ok(resolved.value.harmlessPatterns.length > 0);
  assert.ok(resolved.value.dangerousPatterns.length > 0);
  assert.equal(resolved.value.maxCommandChars, 4000);
  assert.equal(resolved.value.logDecisions, true);
});

test("settings schema accepts a partial overlay", () => {
  const resolved = schema["~standard"].validate({ trustedAreas: ["D:\\data"] });
  assert.deepEqual(resolved.value.trustedAreas, ["D:\\data"]);
  assert.equal(resolved.value.mode, "gated");
});

test("settings schema rejects unknown modes", () => {
  const resolved = schema["~standard"].validate({ mode: "sometimes" });
  assert.equal(resolved.value, undefined);
});

test("defaultsOf mirrors the composition config fields", () => {
  const config = {
    mode: "global",
    trustedAreas: ["E:\\x"],
    harmlessPatterns: ["a"],
    dangerousPatterns: ["b"],
    maxCommandChars: 100,
    logDecisions: false,
    trustedHosts: ["example.com"]
  };
  const defaults = defaultsOf(config);
  assert.equal(defaults.mode, "global");
  assert.deepEqual(defaults.trustedAreas, ["E:\\x"]);
  assert.deepEqual(defaults.harmlessPatterns, ["a"]);
  // trustedHosts is not part of the settings overlay
  assert.equal("trustedHosts" in defaults, false);
  // legacy boolean fields are not part of the overlay either
  assert.equal("enabled" in defaults, false);
  assert.equal("requireTrustedPreset" in defaults, false);
});

// ── legacy (≤ 2.0.0) boolean migration ───────────────────────────────────

test("modeFromLegacy maps the legacy boolean pair", () => {
  assert.equal(modeFromLegacy(false, true), "off");
  assert.equal(modeFromLegacy(false, false), "off");
  assert.equal(modeFromLegacy(true, false), "global");
  assert.equal(modeFromLegacy(true, true), "gated");
  assert.equal(modeFromLegacy(undefined, undefined), "gated");
});

test("hasLegacyShape detects legacy fields", () => {
  assert.equal(hasLegacyShape({ enabled: true }), true);
  assert.equal(hasLegacyShape({ requireTrustedPreset: false }), true);
  assert.equal(hasLegacyShape({ mode: "gated" }), false);
  assert.equal(hasLegacyShape(null), false);
});

test("normalizeConfig folds legacy booleans into mode and drops them", () => {
  const globalized = normalizeConfig({ enabled: true, requireTrustedPreset: false, trustedAreas: ["D:\\x"] });
  assert.deepEqual(globalized, { mode: "global", trustedAreas: ["D:\\x"] });
  const off = normalizeConfig({ enabled: false, requireTrustedPreset: true });
  assert.deepEqual(off, { mode: "off" });
  // canonical shape passes through unchanged
  const canonical = normalizeConfig({ mode: "gated", trustedAreas: [] });
  assert.deepEqual(canonical, { mode: "gated", trustedAreas: [] });
  // a mixed object (new mode + stale legacy keys) resolves from legacy
  const mixed = normalizeConfig({ mode: "gated", enabled: false, requireTrustedPreset: true });
  assert.deepEqual(mixed, { mode: "off" });
});

test("assertValidEffectiveConfig rejects relative trusted areas", () => {
  assert.throws(() => assertValidEffectiveConfig({ trustedAreas: ["relative/path"] }), /absolute paths/);
  assert.doesNotThrow(() => assertValidEffectiveConfig({ trustedAreas: ["D:\\data", "/srv/data"] }));
});

test("assertValidEffectiveConfig rejects invalid regex patterns", () => {
  assert.throws(() => assertValidEffectiveConfig({ harmlessPatterns: ["("] }), /invalid regex in harmlessPatterns/);
  assert.throws(() => assertValidEffectiveConfig({ dangerousPatterns: ["["] }), /invalid regex in dangerousPatterns/);
  assert.doesNotThrow(() => assertValidEffectiveConfig({ harmlessPatterns: ["^ls(\\s|$)"], dangerousPatterns: [] }));
});