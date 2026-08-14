import { test } from "node:test";
import assert from "node:assert/strict";
import { assertValidEffectiveConfig, defaultsOf, schema } from "../lib/settings.js";

test("settings schema resolves defaults for an empty section", () => {
  const resolved = schema["~standard"].validate({});
  assert.equal(resolved.value.enabled, true);
  assert.equal(resolved.value.requireTrustedPreset, true);
  assert.deepEqual(resolved.value.trustedAreas, []);
  assert.ok(resolved.value.harmlessPatterns.length > 0);
  assert.ok(resolved.value.dangerousPatterns.length > 0);
  assert.equal(resolved.value.maxCommandChars, 4000);
  assert.equal(resolved.value.logDecisions, true);
});

test("settings schema accepts a partial overlay", () => {
  const resolved = schema["~standard"].validate({ trustedAreas: ["D:\\data"] });
  assert.deepEqual(resolved.value.trustedAreas, ["D:\\data"]);
  assert.equal(resolved.value.enabled, true);
});

test("defaultsOf mirrors the composition config fields", () => {
  const config = {
    enabled: false,
    requireTrustedPreset: false,
    trustedAreas: ["E:\\x"],
    harmlessPatterns: ["a"],
    dangerousPatterns: ["b"],
    maxCommandChars: 100,
    logDecisions: false,
    trustedHosts: ["example.com"]
  };
  const defaults = defaultsOf(config);
  assert.equal(defaults.enabled, false);
  assert.deepEqual(defaults.trustedAreas, ["E:\\x"]);
  assert.deepEqual(defaults.harmlessPatterns, ["a"]);
  // trustedHosts is not part of the settings overlay
  assert.equal("trustedHosts" in defaults, false);
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
