import { debug } from "../debug.js";

// -- Pure helpers -----------------------------------------------------

export function detachInstanceEndListener(instance) {
  if (!instance) return;
  if (typeof instance.endListener === "function") {
    instance.soundObj?.removeEventListener?.("end", instance.endListener);
  }
  instance.endListener = null;
}

// -- Sound instance lifecycle -----------------------------------------

/**
 * Create a tracked sound instance with manual loop support.
 * All state mutation flows through callbacks.
 */
export async function createSoundInstance({
  soundPath,
  soundUuid,
  volume,
  loop,
  computeDelay,
  nextInstanceId,
  pushActiveInstance,
  findActiveInstance,
  removeTrackedInstance,
  persist,
  render,
}) {
  debug("#createSoundInstance", { soundPath, soundUuid, volume, loop });

  const initialDelay = computeDelay();

  const soundObj = await new Promise((resolve, reject) => {
    setTimeout(() => {
      foundry.audio.AudioHelper.play({
        src: soundPath,
        volume,
        loop: false,
        autoplay: true,
        channel: "interface",
      }, true).then(resolve).catch(reject);
    }, initialDelay);
  });

  if (soundObj) {
    soundObj.loop = false;
    debug("soundObj created", {
      soundUuid,
      requestedLoop: loop,
      nativeLoop: soundObj.loop,
      playing: soundObj.playing,
      hasSourceNode: Boolean(soundObj.sourceNode),
      hasElement: Boolean(soundObj.element),
    });
  }

  const instance = {
    id: nextInstanceId(),
    soundUuid,
    soundObj,
    loop,
    paused: false,
    endListener: null,
    _loopTimer: null,
    _playOpts: { soundPath, volume, loop, computeDelay },
  };

  const handleEnd = () => {
    if (!findActiveInstance(instance.id)) {
      debug("handleEnd: instance already removed, ignoring");
      return;
    }

    debug("handleEnd fired", {
      instanceId: instance.id,
      soundUuid: instance.soundUuid,
      loop: instance.loop,
      paused: instance.paused,
      nativeLoop: instance.soundObj?.loop,
      playing: instance.soundObj?.playing,
    });

    if (instance.loop && !instance.paused) {
      debug("handleEnd: re-triggering loop", { instanceId: instance.id });
      const nextDelay = instance._playOpts.computeDelay();
      instance.soundObj = null;
      instance._loopTimer = setTimeout(async () => {
        if (!findActiveInstance(instance.id)) return;
        try {
          const opts = instance._playOpts;
          instance.soundObj = await foundry.audio.AudioHelper.play({
            src: opts.soundPath,
            volume: opts.volume,
            loop: false,
            autoplay: true,
            channel: "interface",
          }, true);
          if (instance.soundObj) {
            instance.soundObj.loop = false;
            debug("loop re-trigger created soundObj", {
              instanceId: instance.id,
              soundUuid: instance.soundUuid,
              requestedLoop: instance.loop,
              nativeLoop: instance.soundObj.loop,
              playing: instance.soundObj.playing,
            });
          }
          instance.soundObj?.addEventListener?.("end", handleEnd);
          instance.endListener = handleEnd;
          void persist();
          void render();
        } catch (_e) {
          debug("Loop re-trigger failed, removing instance", { instanceId: instance.id });
          removeTrackedInstance(instance.id);
          void persist();
          void render();
        }
      }, nextDelay);
    } else {
      debug("handleEnd removing non-loop/paused instance", {
        instanceId: instance.id,
        soundUuid: instance.soundUuid,
        loop: instance.loop,
        paused: instance.paused,
        nativeLoop: instance.soundObj?.loop,
        playing: instance.soundObj?.playing,
      });
      removeTrackedInstance(instance.id);
      void persist();
      void render();
    }
  };

  instance.endListener = handleEnd;
  soundObj?.addEventListener?.("end", handleEnd);
  pushActiveInstance(instance);
  return instance;
}
