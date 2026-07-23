import { adoptLegacyAmbientSoundFlags } from "./ambient-migration.js";
import { migrateSoundsData } from "./settings.js";

let initializationPromise = null;

export function initializeSoundsFeature() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    await migrateSoundsData();
    await adoptLegacyAmbientSoundFlags();
  })();
  return initializationPromise;
}
