import { debug } from "../debug.js";

// -- Sound instance control -------------------------------------------

/**
 * Fully stop and remove a sound instance from tracking.
 * All state mutation flows through callbacks.
 */
export async function stopSoundInstance(instanceId, {
  activeInstances, removeTrackedInstance, persist,
}) {
  const instance = activeInstances.find((c) => c.id === instanceId);
  if (!instance) {
    debug("stopInstance: instance not found", { instanceId });
    return false;
  }

  if (instance._loopTimer) {
    clearTimeout(instance._loopTimer);
    instance._loopTimer = null;
  }

  removeTrackedInstance(instanceId);

  try {
    instance.soundObj?.sourceNode?.stop?.(0);
  } catch (stopNodeError) {
    debug("stopInstance: sourceNode.stop failed", {
      instanceId,
      soundUuid: instance.soundUuid,
      error: stopNodeError?.message ?? stopNodeError,
    });
  }

  if (typeof instance.soundObj?.stop === "function") {
    await instance.soundObj.stop();
  }

  void persist();
  return true;
}

/**
 * Pause or resume a sound instance (toggle).
 * All state mutation flows through callbacks.
 */
export async function pauseSoundInstance(instanceId, { activeInstances }) {
  const instance = activeInstances.find((c) => c.id === instanceId);
  if (!instance) {
    debug("pauseInstance: instance not found", { instanceId });
    return false;
  }

  if (instance.paused) {
    debug("pauseInstance: resuming", { instanceId });
    if (instance.soundObj && typeof instance.soundObj.play === "function") {
      await instance.soundObj.play();
    }
    instance.paused = false;
    return true;
  }

  debug("pauseInstance: pausing", { instanceId });
  if (instance.soundObj && typeof instance.soundObj.pause === "function") {
    await instance.soundObj.pause();
  }
  instance.paused = true;
  return true;
}

/**
 * Toggle pause for any instance type (sound, ambient, positional).
 * All state mutation flows through callbacks.
 */
export async function toggleInstancePause(instanceId, instanceType, {
  ambientInstances, resumeAmbientInstance, pauseAmbientInstance, pauseSoundInstance: pauseSound,
}) {
  if (instanceType === "ambient") {
    const inst = ambientInstances.find((candidate) => candidate.id === instanceId);
    if (!inst) return false;
    return inst.paused ? resumeAmbientInstance(instanceId) : pauseAmbientInstance(instanceId);
  }
  // "sound" or "positional" — both use the same pauseInstance toggle
  return pauseSound(instanceId);
}
