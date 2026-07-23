import { MODULE_ID, ACTIVE_INSTANCES_FLAG } from "../constants.js";
import { debug, error } from "../debug.js";
import { getSoundboardItems } from "../settings.js";
import { computeDelay } from "./gm-panel-audio-persistence.js";

// -- Restore orchestration --------------------------------------------

/**
 * Restore previously active audio instances from user flags.
 * Called after refresh/page-load. All state mutation flows through callbacks.
 */
export async function restoreAudioInstances({
  isRestoring, setIsRestoring,
  resolveSound, render,
  awaitAudioReady, getPositionalSettings,
  createAmbientSounds, createSoundInstance,
  persist,
}) {
  try {
    debug("Attempting to restore active instances...");
    const saved = game.user.getFlag(MODULE_ID, ACTIVE_INSTANCES_FLAG);
    debug("Restore check", { saved, isArray: Array.isArray(saved), length: saved?.length });
    if (!Array.isArray(saved) || saved.length === 0) return;

    setIsRestoring(true);
    void render({ force: true });

    debug("Restoring active instances after refresh", { count: saved.length });
    await game.user.setFlag(MODULE_ID, ACTIVE_INSTANCES_FLAG, []);

    for (const entry of saved) {
      if (!entry.soundUuid) continue;
      const sound = await resolveSound(entry.soundUuid);
      if (!sound) {
        debug("Skipping restore -- sound no longer exists", { soundUuid: entry.soundUuid });
        continue;
      }

      try {
        await awaitAudioReady();

        const volume = Number.isFinite(sound.volume) ? sound.volume : 0.8;
        const items = getSoundboardItems();
        const item = items.find((i) => i.uuid === entry.soundUuid);
        const loop = item?.loop === true;
        const offsetMin = typeof item?.offsetMin === "number" ? item.offsetMin : 0;
        const offsetMax = typeof item?.offsetMax === "number" ? item.offsetMax : 1000;

        const boundDelay = () => computeDelay(offsetMin, offsetMax);

        if (entry.type === "ambient") {
          const positional = getPositionalSettings(item);
          const ambientDelay = computeDelay(offsetMin, offsetMax);
          if (ambientDelay > 0) await new Promise((resolve) => setTimeout(resolve, ambientDelay));
          await createAmbientSounds(sound.path, sound.uuid, [entry.tokenUuid], loop, positional);
        } else {
          await createSoundInstance({
            soundPath: sound.path,
            soundUuid: sound.uuid,
            volume,
            loop,
            computeDelay: boundDelay,
          });
        }
      } catch (restoreErr) {
        error("Failed to restore instance", { soundUuid: entry.soundUuid, error: restoreErr });
      }
    }

    void persist();
    setIsRestoring(false);
    void render({ force: true });
  } catch (restoreError) {
    setIsRestoring(false);
    error("Failed to restore active instances", restoreError);
  }
}
