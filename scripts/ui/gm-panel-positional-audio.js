import { debug } from "../debug.js";
import { getTokenDocumentCenter } from "./gm-panel-audio-token-utils.js";

// -- Positional one-shot audio ----------------------------------------

/**
 * Create positional one-shot sound instances for one or more tokens.
 * Each token gets its own 3D-positioned sound that auto-cleans on end.
 * All state mutation flows through callbacks.
 */
export async function createPositionalOneShotSoundsForTokens({
  soundPath, soundUuid, tokenUuids, volume, positional, computeDelay,
  nextInstanceId, pushActiveInstance, removeTrackedInstance, persist, render,
}) {
  if (!soundPath || !canvas?.ready || !Array.isArray(tokenUuids) || !tokenUuids.length) return [];

  const createdInstances = [];

  for (const tokenUuid of tokenUuids) {
    const tokenDoc = await foundry.utils.fromUuid(tokenUuid);
    const origin = tokenDoc?.object?.center;
    if (!origin) continue;

    const delay = computeDelay();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    const soundObj = new foundry.audio.Sound(soundPath, { context: game.audio.environment });
    await soundObj.load();

    const instance = {
      id: nextInstanceId(),
      soundUuid,
      soundObj,
      loop: false,
      paused: false,
      tokenUuid,
      type: "positional",
      endListener: null,
      _loopTimer: null,
      _playOpts: { soundPath, volume, loop: false, computeDelay },
    };

    const handleEnd = () => {
      debug("Positional one-shot ended", { instanceId: instance.id, soundUuid, tokenUuid });
      removeTrackedInstance(instance.id);
      void persist();
      void render();
    };

    instance.endListener = handleEnd;
    soundObj.addEventListener?.("end", handleEnd);

    pushActiveInstance(instance);

    debug("Positional one-shot start", { instanceId: instance.id, soundUuid, tokenUuid });

    await soundObj.playAtPosition(
      { x: origin.x, y: origin.y, elevation: tokenDoc.elevation + positional.elevation },
      positional.radius,
      { volume, easing: positional.easing, walls: positional.walls, playbackOptions: { loop: false } },
    );

    createdInstances.push(instance);
  }

  return createdInstances;
}
