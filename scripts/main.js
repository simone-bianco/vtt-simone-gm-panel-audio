import { CORE_MODULE_ID, FEATURE_API_VERSION } from "./constants.js";
import { error } from "./debug.js";
import { initializeSoundsFeature } from "./initialization.js";
import { registerSettings } from "./settings.js";
import { soundsFeature } from "./sounds-feature.js";

Hooks.once("init", () => {
  registerSettings();
  const coreApi = game.modules.get(CORE_MODULE_ID)?.api ?? game.simoneGmPanel?.api;
  if (!coreApi || coreApi.apiVersion !== FEATURE_API_VERSION) {
    throw new Error("simone-gm-panel-sounds requires Simone GM Panel core API v1");
  }
  coreApi.registerFeature(soundsFeature.descriptor());
});

Hooks.once("ready", async () => {
  try {
    await initializeSoundsFeature();
  } catch (cause) {
    error("Sounds feature migration failed", cause);
  }
});
