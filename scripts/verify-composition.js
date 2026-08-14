// Offline composition check: apply every bundle layer of a profile plus
// dsh-auto-approval-plugin's patch, and validate the touched rows against the
// runtime schemas. Read-only: never writes profile files.
//
// Usage: npm install && node scripts/verify-composition.js [profile]
import { composeEntries, loadOverlayPatches, loadProfile } from "@deepseek-ai/dsh-app-boot";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ANCHOR = fileURLToPath(new URL("../package.json", import.meta.url));
const profileName = process.argv[2] ?? "web";

const profile = loadProfile("dsh", profileName, ANCHOR, void 0, { userLayer: true });
const layers = [
  ...profile.layers.map((layer) => layer.patches),
  profile.patches
];
// When the bundle is already installed in the profile, its patch is already a
// layer; only append it as an overlay when verifying a not-yet-installed copy.
const installed = profile.layers.some((layer) => layer.packageName === "dsh-auto-approval-plugin");
const patches = installed
  ? layers
  : [...layers, loadOverlayPatches("dsh", join(fileURLToPath(new URL("..", import.meta.url)), "cordis.patch.yml"))];
const data = composeEntries(patches, (message) => console.error("warn:", message));

const byId = new Map();
const index = (entries) => {
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry);
    if (entry.group && Array.isArray(entry.config)) index(entry.config);
  }
};
index(data);

// ── runtime schema validation (offline) ─────────────────────────────────
const { PermissionPresetService } = await import("@deepseek-ai/dsh-permission-presets");
const permissionSchema = PermissionPresetService.Config["~standard"].validate({ presets: byId.get("permission").config.presets });
console.log("permission config schema:", permissionSchema.value ? "VALID" : "INVALID", permissionSchema.value ? "" : JSON.stringify(permissionSchema));

const { Config: AutoApprovalConfig } = await import("../lib/index.js");
const autoResult = AutoApprovalConfig["~standard"].validate(byId.get("auto-approval").config);
console.log("auto-approval config schema:", autoResult.value ? "VALID" : "INVALID", autoResult.value ? "" : JSON.stringify(autoResult));

const permission = byId.get("permission");
console.log("=== permission row ===");
console.log(JSON.stringify(permission, null, 2));
const auto = byId.get("auto-approval");
console.log("=== auto-approval row ===");
console.log(JSON.stringify(auto, null, 2));
console.log("=== rows: total", data.length, "| ids:", data.map((e) => e.id).join(", "));
