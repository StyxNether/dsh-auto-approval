// Offline composition check: apply every bundle layer of the `web` profile
// plus dsh-auto-approval's patch, and print the rows the plugin touches.
// Read-only: never writes profile files.
import { composeEntries, loadOverlayPatches, loadProfile } from "@deepseek-ai/dsh-app-boot";
import { fileURLToPath } from "node:url";

const ANCHOR = fileURLToPath(new URL("../package.json", import.meta.url));

const profile = loadProfile("dsh", "web", ANCHOR, void 0, { userLayer: true });
const layers = [
  ...profile.layers.map((layer) => layer.patches),
  profile.patches
];
const pluginPatch = loadOverlayPatches("dsh", "E:\\test\\dsh-auto-approval\\cordis.patch.yml");
const data = composeEntries([...layers, pluginPatch], (message) => console.error("warn:", message));

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
