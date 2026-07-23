import { debug, warn } from "../debug.js";
import { MODULE_ID } from "../constants.js";
import { getSoundboardState } from "../settings.js";
import { getTokenDocumentCenter } from "./gm-panel-audio-token-utils.js";
import { chooseNextGroupItem, computeGroupDelay } from "./gm-panel-group-scheduler.js";

/**
 * @class GmPanelGroupAudioController
 *
 * Runtime-only group playback sequencer.
 * Owns: group instance state, tempo/scheduling, token-bound / global playback.
 *
 * Creates and owns temporary AmbientSound documents for token-bound sessions.
 * Does NOT persist active instances.
 * Owns cleanup for local sounds, timers, and group AmbientSound documents.
 */
export class GmPanelGroupAudioController {
  /** @type {import("./gm-panel-app.js").SimoneGmPanelApp} */
  #app;

  /** @type {Array<GroupInstance>} */
  #groupInstances = [];

  #groupInstanceIdCounter = 0;

  /** @type {() => { radius: number, volume: number, walls: boolean, easing: boolean, elevation: number }} */
  #getPositionalDefaults;

  /**
   * @param {import("./gm-panel-app.js").SimoneGmPanelApp} app
   * @param {{ getPositionalDefaults?: () => object }} [opts]
   */
  constructor(app, { getPositionalDefaults } = {}) {
    this.#app = app;
    this.#getPositionalDefaults = typeof getPositionalDefaults === "function"
      ? getPositionalDefaults
      : () => ({ radius: 60, volume: 0.8, walls: true, easing: true, elevation: 0 });
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Start group playback.
   * If tokens are selected, creates one sequencer per selected token.
   * If no tokens are selected, creates one global sequencer.
   * Idempotent: stops existing instances for the same group first.
   * @param {string} groupId
   */
  async playGroup(groupId) {
    if (typeof groupId !== "string" || !groupId) return;

    const state = getSoundboardState();
    const group = state.groups.find((g) => g?.id === groupId);
    if (!group || !Array.isArray(group.itemIds) || group.itemIds.length === 0) {
      debug("playGroup: group not found or empty", { groupId });
      return;
    }

    // Resolve PlaylistSound docs for all items in the group
    // group.itemIds are item IDs; items have .uuid which is the PlaylistSound UUID
    const resolvedItems = [];
    for (const itemId of group.itemIds) {
      const item = state.items.find((i) => i?.id === itemId);
      if (!item?.uuid) {
        debug("playGroup: item not found or missing uuid", { itemId });
        continue;
      }
      const sound = await this.#app.resolvePlaylistSoundByUuid(item.uuid);
      if (!sound?.path) {
        debug("playGroup: sound not found, skipping", { itemId, soundUuid: item.uuid });
        continue;
      }
      resolvedItems.push({ itemId, uuid: item.uuid, sound, item });
    }

    if (resolvedItems.length === 0) {
      debug("playGroup: no playable sounds in group", { groupId });
      return;
    }

    // Idempotent: fully stop existing instances for this group before replacement.
    await this.stopGroup(groupId);

    // Determine playback targets
    const selected = this.#app.selectedTokens ?? [];
    const tokenDocs = [];
    if (selected.length > 0) {
      for (const sel of selected) {
        if (sel?.uuid) {
          // Resolve to document if needed
          const tokenDoc = sel.document ? sel : await foundry.utils.fromUuid(sel.uuid);
          if (tokenDoc && tokenDoc.uuid) tokenDocs.push(tokenDoc);
        }
      }
    }

    if (tokenDocs.length > 0) {
      // Token-bound: one instance per selected token
      for (const tokenDoc of tokenDocs) {
        await this.#createGroupInstance(group, resolvedItems, tokenDoc);
      }
    } else {
      // Global playback
      await this.#createGroupInstance(group, resolvedItems, null);
    }

    void this.#app.render({ force: true });
  }

  /**
   * Start group playback anchored to a fixed map position.
   * Does NOT read selected tokens. Does NOT read token under point.
   * Idempotent: stops existing instances for the same group first.
   *
   * @param {string} groupId
   * @param {{ x: number, y: number }} point  Scene coordinates
   */
  async playGroupAtPosition(groupId, point) {
    if (typeof groupId !== "string" || !groupId) return;
    if (!point || typeof point.x !== "number" || typeof point.y !== "number") return;

    const state = getSoundboardState();
    const group = state.groups.find((g) => g?.id === groupId);
    if (!group || !Array.isArray(group.itemIds) || group.itemIds.length === 0) {
      debug("playGroupAtPosition: group not found or empty", { groupId });
      return;
    }

    // Resolve items (same logic as playGroup)
    const resolvedItems = [];
    for (const itemId of group.itemIds) {
      const item = state.items.find((i) => i?.id === itemId);
      if (!item?.uuid) continue;
      const sound = await this.#app.resolvePlaylistSoundByUuid(item.uuid);
      if (!sound?.path) continue;
      resolvedItems.push({ itemId, uuid: item.uuid, sound, item });
    }

    if (resolvedItems.length === 0) {
      debug("playGroupAtPosition: no playable sounds in group", { groupId });
      return;
    }

    // Idempotent: fully stop existing instances for this group before replacement.
    await this.stopGroup(groupId);

    // Create a single map-anchored instance
    const instance = {
      id: ++this.#groupInstanceIdCounter,
      groupId: group.id,
      tokenUuid: null,
      type: "map",
      mapX: point.x,
      mapY: point.y,
      group: {
        mode: group.mode || "sequential",
        avoidImmediateRepeat: group.avoidImmediateRepeat === true,
        repeat: group.repeat !== false,
        offsetMin: typeof group.offsetMin === "number" ? group.offsetMin : 1000,
        offsetMax: typeof group.offsetMax === "number" ? group.offsetMax : 4000,
        perTokenDesync: group.perTokenDesync === true,
        positional: group.positional && typeof group.positional === "object" ? { ...group.positional } : {},
        volumeMode: group.volumeMode === "group" ? "group" : "item",
      },
      resolvedItems,
      currentIndex: 0,
      lastItemId: null,
      timer: null,
      timerResolve: null,
      soundObjs: new Set(),
      stopped: false,
      stopping: false,
      stopPromise: null,
      paused: false,
      ambientCreationPromise: null,
      ambientCleanupPromise: null,
      currentAmbientSoundId: null,
      currentSoundUuid: null,
      currentSoundName: null,
      currentDurationMs: null,
    };

    this.#groupInstances.push(instance);

    // Initial delay: random only if perTokenDesync is true, else immediate
    const initialDelay = instance.group.perTokenDesync ? computeGroupDelay(group) : 0;
    if (initialDelay > 0) {
      instance.timer = setTimeout(() => {
        this.#runGroupInstanceSafely(instance);
      }, initialDelay);
    } else {
      this.#runGroupInstanceSafely(instance);
    }

    void this.#app.render({ force: true });
  }

  /**
   * Stop all running instances for a group.
   * @param {string} groupId
   */
  async stopGroup(groupId) {
    if (typeof groupId !== "string" || !groupId) return;
    const instances = this.#groupInstances.filter((inst) => inst.groupId === groupId);
    const errors = [];
    for (const inst of instances) {
      try {
        await this.stopGroupInstance(inst.id);
      } catch (cause) {
        errors.push(cause);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, `Failed to stop group audio sessions: ${groupId}`);
    }
  }

  /**
   * Stop a specific group instance by its ID.
   * @param {number} instanceId
   */
  async stopGroupInstance(instanceId) {
    const inst = this.#groupInstances.find((candidate) => candidate.id === instanceId);
    if (!inst) return;
    await this.#stopGroupInstanceInternal(inst);
    const currentIndex = this.#groupInstances.indexOf(inst);
    if (currentIndex !== -1) this.#groupInstances.splice(currentIndex, 1);
  }

  /**
   * Pause a specific group session. Clears timer and stops current sound, preserves state.
   * @param {number} instanceId
   */
  async pauseGroupSession(instanceId) {
    const inst = this.#groupInstances.find((i) => i.id === instanceId);
    if (!inst || inst.stopped || inst.stopping || inst.paused) return;
    inst.paused = true;
    if (inst.timer) {
      clearTimeout(inst.timer);
      inst.timer = null;
    }
    const timerResolve = inst.timerResolve;
    inst.timerResolve = null;
    timerResolve?.({ completed: false });
    if (inst.ambientCreationPromise) {
      try {
        await inst.ambientCreationPromise;
      } catch (cause) {
        debug("AmbientSound creation failed while pausing group session", {
          instanceId: inst.id,
          groupId: inst.groupId,
          error: cause?.message ?? cause,
        });
      }
    }
    for (const soundObj of inst.soundObjs) {
      try { soundObj.stop?.(); } catch (_) { /* ignore */ }
    }
    inst.soundObjs.clear();
    await this.#clearCurrentAmbientEmission(inst);
  }

  /**
   * Resume a paused group session.
   * @param {number} instanceId
   */
  resumeGroupSession(instanceId) {
    const inst = this.#groupInstances.find((i) => i.id === instanceId);
    if (!inst || inst.stopped || inst.stopping || !inst.paused) return;
    inst.paused = false;
    this.#runGroupInstanceSafely(inst);
  }

  /**
   * Toggle pause/resume for a group session.
   * @param {number} instanceId
   */
  async toggleGroupSessionPause(instanceId) {
    const inst = this.#groupInstances.find((i) => i.id === instanceId);
    if (!inst || inst.stopping) return;
    if (inst.paused) this.resumeGroupSession(instanceId);
    else await this.pauseGroupSession(instanceId);
  }

  /**
   * Remove a single group session (stop + cleanup).
   * @param {number} instanceId
   */
  async removeGroupSession(instanceId) {
    await this.stopGroupInstance(instanceId);
  }

  /**
   * Pause all sessions for a group.
   * @param {string} groupId
   */
  async pauseAllGroupSessions(groupId) {
    const instances = this.#groupInstances.filter((inst) => inst.groupId === groupId);
    for (const inst of instances) {
      await this.pauseGroupSession(inst.id);
    }
  }

  /**
   * Remove all sessions for a group.
   * @param {string} groupId
   */
  async removeAllGroupSessions(groupId) {
    await this.stopGroup(groupId);
  }

  /**
   * Stop all running group instances.
   */
  async stopAllGroups() {
    await this.stopAllGroupsAndWait();
  }

  async stopAllGroupsAndWait() {
    const errors = [];
    for (const instance of [...this.#groupInstances]) {
      try {
        await this.stopGroupInstance(instance.id);
      } catch (cause) {
        errors.push(cause);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, "Failed to stop one or more group audio sessions");
    }
  }

  /**
   * Get group instances for a specific group.
   * @param {string} groupId
   * @returns {Array<GroupInstance>}
   */
  getGroupInstancesForGroup(groupId) {
    return this.#groupInstances.filter((inst) => inst.groupId === groupId);
  }

  /**
   * Get the count of running (non-stopped) instances for a group.
   * @param {string} groupId
   * @returns {number}
   */
  getGroupInstanceCount(groupId) {
    return this.#groupInstances.filter((inst) => inst.groupId === groupId && !inst.stopped).length;
  }

  /**
   * Get session view models for a group (used by chip UI).
   * Resolves token names from tokenUuid.
   * @param {string} groupId
   * @returns {Promise<Array<{ id: number, groupId: string, tokenUuid: string|null, tokenName: string, isGlobal: boolean, status: string, currentSoundName: string|null, canPan: boolean, paused: boolean }>>}
   */
  async getGroupSessionViewModels(groupId) {
    const sessions = [];
    for (const inst of this.#groupInstances) {
      if (inst.groupId !== groupId || inst.stopped) continue;
      const hasPlaying = [...inst.soundObjs].some((s) => s.playing);
      const status = inst.paused ? "paused" : (hasPlaying ? "playing" : "waiting");
      let tokenName = inst.type === "global" ? game.i18n.localize("SIMONE_GM_PANEL.Soundboard.SessionGlobal") : null;
      if (inst.type === "token" && inst.tokenUuid) {
        try {
          const tokenDoc = await foundry.utils.fromUuid(inst.tokenUuid);
          tokenName = tokenDoc?.name ?? game.i18n.localize("SIMONE_GM_PANEL.Soundboard.SessionToken");
        } catch (_) {
          tokenName = game.i18n.localize("SIMONE_GM_PANEL.Soundboard.SessionToken");
        }
      }
      sessions.push({
        id: inst.id,
        groupId: inst.groupId,
        tokenUuid: inst.tokenUuid ?? null,
        tokenName: tokenName ?? inst.groupId,
        isGlobal: inst.type === "global",
        status,
        currentSoundName: inst.currentSoundName ?? null,
        canPan: inst.type === "token" && inst.tokenUuid !== null,
        paused: inst.paused === true,
      });
    }
    return sessions;
  }

  /**
   * Get active counts per group for all groups.
   * @returns {Map<string, number>}
   */
  getGroupActiveCounts() {
    const counts = new Map();
    for (const inst of this.#groupInstances) {
      if (inst.stopped) continue;
      const current = counts.get(inst.groupId) || 0;
      counts.set(inst.groupId, current + 1);
    }
    return counts;
  }

  /**
   * Handle token deletion: stops only group instances bound to the deleted token.
   * @param {foundry.documents.TokenDocument} tokenDoc
   */
  async handleDeleteToken(tokenDoc) {
    if (!tokenDoc?.uuid) return;
    const matching = this.#groupInstances.filter((inst) => inst.tokenUuid === tokenDoc.uuid);
    for (const inst of matching) {
      await this.stopGroupInstance(inst.id);
    }
    if (matching.length > 0) {
      void this.#app.render({ force: true });
    }
  }

  // ── Private: Instance lifecycle ─────────────────────────────────

  /**
   * Create and start a new group playback instance.
   * @param {object} group
   * @param {Array<{ uuid: string, sound: object, item: object }>} resolvedItems
   * @param {foundry.documents.TokenDocument|null} tokenDoc
   */
  async #createGroupInstance(group, resolvedItems, tokenDoc) {
    const instance = {
      id: ++this.#groupInstanceIdCounter,
      groupId: group.id,
      tokenUuid: tokenDoc?.uuid ?? null,
      type: tokenDoc ? "token" : "global",
      group: {
        mode: group.mode || "sequential",
        avoidImmediateRepeat: group.avoidImmediateRepeat === true,
        repeat: group.repeat !== false,
        offsetMin: typeof group.offsetMin === "number" ? group.offsetMin : 1000,
        offsetMax: typeof group.offsetMax === "number" ? group.offsetMax : 4000,
        perTokenDesync: group.perTokenDesync === true,
        positional: group.positional && typeof group.positional === "object" ? { ...group.positional } : {},
        volumeMode: group.volumeMode === "group" ? "group" : "item",
      },
      resolvedItems,
      currentIndex: 0,
      lastItemId: null,
      timer: null,
      timerResolve: null,
      soundObjs: new Set(),
      stopped: false,
      stopping: false,
      stopPromise: null,
      paused: false,
      ambientCreationPromise: null,
      ambientCleanupPromise: null,
      currentAmbientSoundId: null,
      currentSoundUuid: null,
      currentSoundName: null,
      currentDurationMs: null,
    };

    this.#groupInstances.push(instance);

    // Initial delay: random only if perTokenDesync is true, else immediate
    const initialDelay = instance.group.perTokenDesync ? computeGroupDelay(group) : 0;
    if (initialDelay > 0) {
      instance.timer = setTimeout(() => {
        this.#runGroupInstanceSafely(instance);
      }, initialDelay);
    } else {
      this.#runGroupInstanceSafely(instance);
    }
  }

  #runGroupInstanceSafely(instance) {
    void this.#runGroupInstance(instance).catch((cause) => {
      warn("Group session lifecycle failed", {
        instanceId: instance.id,
        groupId: instance.groupId,
        error: cause?.message ?? cause,
      });
    });
  }

  /**
   * Execute one step of group playback: pick next item, play it,
   * schedule the next step if repeat is enabled.
   * @param {GroupInstance} instance
   */
  async #runGroupInstance(instance) {
    if (instance.stopped || instance.stopping || instance.paused) return;

    // Prune finished sound objects
    this.#pruneGroupSoundObjects(instance);

    // Check if token still exists for token-bound instances
    if (instance.type === "token" && instance.tokenUuid) {
      const tokenDoc = await foundry.utils.fromUuid(instance.tokenUuid);
      if (!tokenDoc) {
        debug("runGroupInstance: token no longer exists, stopping", {
          instanceId: instance.id,
          tokenUuid: instance.tokenUuid,
        });
        await this.stopGroupInstance(instance.id);
        void this.#app.render({ force: true });
        return;
      }
    }

    // Choose next item
    const nextItem = chooseNextGroupItem(instance);
    if (!nextItem) {
      debug("runGroupInstance: no next item, stopping", { instanceId: instance.id });
      await this.stopGroupInstance(instance.id);
      void this.#app.render({ force: true });
      return;
    }

    // Play the item and wait for it to finish
    const result = await this.#playGroupItem(instance, nextItem);

    // If playback was aborted (stopped/paused), don't schedule next
    if (!result?.completed || instance.stopped || instance.stopping || instance.paused) return;

    // Schedule next step after group delay
    if (instance.group.repeat) {
      const delay = computeGroupDelay(instance.group);
      instance.timer = setTimeout(() => {
        this.#runGroupInstanceSafely(instance);
      }, delay);
    } else {
      // Non-repeating: instance completed its single item
      await this.stopGroupInstance(instance.id);
      void this.#app.render({ force: true });
    }
  }

  // chooseNextGroupItem & computeGroupDelay imported from gm-panel-group-scheduler.js

  /**
   * Clear the current AmbientSound emission for a group instance.
   * Deletes the document from the scene and resets tracking fields.
   * @param {GroupInstance} instance
   */
  async #clearCurrentAmbientEmission(instance) {
    if (instance.ambientCleanupPromise) return instance.ambientCleanupPromise;
    const ambientSoundId = instance.currentAmbientSoundId;
    const cleanupPromise = (async () => {
      if (ambientSoundId && canvas?.scene) {
        const doc = canvas.scene.sounds.get(ambientSoundId);
        if (this.#isOwnedGroupAmbient(doc, instance)) {
          try {
            await doc.delete();
          } catch (cause) {
            warn("Failed to delete owned group AmbientSound", {
              instanceId: instance.id,
              groupId: instance.groupId,
              ambientSoundId,
              error: cause?.message ?? cause,
            });
            throw cause;
          }
        }
      }
      if (instance.currentAmbientSoundId === ambientSoundId) {
        instance.currentAmbientSoundId = null;
        instance.currentSoundUuid = null;
        instance.currentSoundName = null;
        instance.currentDurationMs = null;
      }
    })();
    instance.ambientCleanupPromise = cleanupPromise;
    try {
      await cleanupPromise;
    } finally {
      if (instance.ambientCleanupPromise === cleanupPromise) instance.ambientCleanupPromise = null;
    }
  }

  #isOwnedGroupAmbient(doc, instance) {
    return doc?.getFlag?.(MODULE_ID, "instanceType") === "soundboard-group-positional"
      && doc.getFlag(MODULE_ID, "groupSessionId") === instance.id;
  }

  /**
   * Estimate the duration of a sound file in milliseconds.
   * Loads the file into a temporary Sound object to read its duration.
   * Returns a safe fallback if estimation fails.
   * @param {string} soundPath
   * @returns {Promise<number>} Duration in ms
   */
  async #estimateSoundDuration(soundPath) {
    try {
      const tempSound = new foundry.audio.Sound(soundPath, { context: game.audio.environment });
      await tempSound.load();
      const dur = tempSound.duration;
      try { tempSound.destroy?.(); } catch (_) { /* cleanup */ }
      if (typeof dur === "number" && dur > 0 && dur < 300) return Math.ceil(dur * 1000);
    } catch (_) { /* fall through */ }
    return 5000; // fallback
  }

  /**
   * Play a single group item as a one-shot sound.
   * For token-bound sessions, creates a temporary AmbientSound document.
   * Returns a Promise that resolves when the sound has finished playing.
   * @param {GroupInstance} instance
   * @param {{ uuid: string, sound: object, item: object }} resolvedItem
   * @returns {Promise<{ completed: boolean }>}
   */
  async #playGroupItem(instance, resolvedItem) {
    if (instance.stopped || instance.stopping || instance.paused) return { completed: false };

    const { sound, item } = resolvedItem;
    const positional = this.#getGroupPositionalSettings(item, instance);

    try {
      if (instance.type === "token" && instance.tokenUuid && canvas?.ready) {
        const tokenDoc = await foundry.utils.fromUuid(instance.tokenUuid);
        if (instance.stopped || instance.stopping || instance.paused) return { completed: false };
        if (!tokenDoc) {
          debug("playGroupItem: token gone, stopping instance", { instanceId: instance.id });
          await this.stopGroupInstance(instance.id);
          void this.#app.render({ force: true });
          return { completed: false };
        }

        // Clean up any previous emission for this session
        await this.#clearCurrentAmbientEmission(instance);
        if (instance.stopped || instance.stopping || instance.paused) return { completed: false };

        const center = getTokenDocumentCenter(tokenDoc);

        const ambientData = {
          x: center.x,
          y: center.y,
          elevation: (tokenDoc.elevation ?? 0) + positional.elevation,
          radius: positional.radius,
          volume: positional.volume,
          walls: positional.walls,
          easing: positional.easing,
          darkness: { min: 0, max: 1 },
          hidden: false,
          repeat: false,
          path: sound.path,
          flags: {
            [MODULE_ID]: {
              instanceType: "soundboard-group-positional",
              groupId: instance.groupId,
              groupSessionId: instance.id,
              tokenUuid: instance.tokenUuid,
              soundUuid: resolvedItem.uuid,
            },
          },
        };

        const creationPromise = canvas.scene.createEmbeddedDocuments("AmbientSound", [ambientData])
          .then(([createdDoc]) => {
            if (!createdDoc) throw new Error("AmbientSound creation returned no document");
            instance.currentAmbientSoundId = createdDoc.id;
            instance.currentSoundUuid = resolvedItem.uuid;
            instance.currentSoundName = sound.name ?? item?.name ?? null;
            return createdDoc;
          });
        instance.ambientCreationPromise = creationPromise;
        try {
          await creationPromise;
        } finally {
          if (instance.ambientCreationPromise === creationPromise) instance.ambientCreationPromise = null;
        }
        if (instance.stopped || instance.stopping || instance.paused) return { completed: false };

        // Estimate duration and return a Promise that resolves on end
        const durMs = await this.#estimateSoundDuration(sound.path);
        if (instance.stopped || instance.stopping || instance.paused) return { completed: false };
        instance.currentDurationMs = durMs;

        return new Promise((resolve) => {
          instance.timerResolve = resolve;
          instance.timer = setTimeout(() => {
            instance.timer = null;
            instance.timerResolve = null;
            if (instance.stopped || instance.stopping || instance.paused) {
              resolve({ completed: false });
              return;
            }
            void this.#clearCurrentAmbientEmission(instance)
              .then(() => resolve({ completed: true }))
              .catch(() => resolve({ completed: false }));
          }, durMs + 250);
        });
      } else if (instance.type === "map" && canvas?.ready) {
        // Map-anchored playback — use fixed coordinates
        const elevation = typeof instance.mapElevation === "number" ? instance.mapElevation : 0;
        const volume = positional.volume;

        const soundObj = new foundry.audio.Sound(sound.path, { context: game.audio.environment });
        await soundObj.load();
        if (instance.stopped || instance.stopping || instance.paused) {
          try { soundObj.destroy?.(); } catch (_) { /* cleanup */ }
          return { completed: false };
        }
        instance.soundObjs.add(soundObj);

        await soundObj.playAtPosition(
          { x: instance.mapX, y: instance.mapY, elevation },
          positional.radius,
          {
            volume,
            easing: positional.easing,
            walls: positional.walls,
            playbackOptions: { loop: false },
          },
        );
        if (instance.stopped || instance.stopping || instance.paused) {
          try { soundObj.stop?.(); } catch (_) { /* cleanup */ }
          instance.soundObjs.delete(soundObj);
          return { completed: false };
        }

        // Wait for estimated duration
        const durMs = await this.#estimateSoundDuration(sound.path);
        if (instance.stopped || instance.stopping || instance.paused) {
          try { soundObj.stop?.(); } catch (_) { /* cleanup */ }
          instance.soundObjs.delete(soundObj);
          return { completed: false };
        }
        return new Promise((resolve) => {
          instance.timerResolve = resolve;
          instance.timer = setTimeout(() => {
            instance.soundObjs.delete(soundObj);
            instance.timer = null;
            instance.timerResolve = null;
            resolve({ completed: true });
          }, durMs + 250);
        });
      } else {
        // Global playback
        const volume = positional.volume;

        const soundObj = await foundry.audio.AudioHelper.play({
          src: sound.path,
          volume,
          loop: false,
          autoplay: true,
          channel: "interface",
        }, true);

        if (instance.stopped || instance.stopping || instance.paused) {
          try { soundObj?.stop?.(); } catch (_) { /* cleanup */ }
          return { completed: false };
        }
        if (soundObj) {
          soundObj.loop = false;
          instance.soundObjs.add(soundObj);
          instance.currentSoundUuid = resolvedItem.uuid;
          instance.currentSoundName = sound.name ?? item?.name ?? null;
        }

        // Wait for estimated duration
        const durMs = await this.#estimateSoundDuration(sound.path);
        if (instance.stopped || instance.stopping || instance.paused) {
          try { soundObj?.stop?.(); } catch (_) { /* cleanup */ }
          if (soundObj) instance.soundObjs.delete(soundObj);
          return { completed: false };
        }
        return new Promise((resolve) => {
          instance.timerResolve = resolve;
          instance.timer = setTimeout(() => {
            if (soundObj) instance.soundObjs.delete(soundObj);
            instance.timer = null;
            instance.timerResolve = null;
            resolve({ completed: true });
          }, durMs + 250);
        });
      }
    } catch (e) {
      debug("playGroupItem: failed to play", {
        instanceId: instance.id,
        soundUuid: resolvedItem.uuid,
        error: e?.message ?? e,
      });
    }
    return { completed: false };
  }

  // computeGroupDelay imported from gm-panel-group-scheduler.js

  /**
   * Stop a group instance and retain tracking until owned AmbientSound cleanup finishes.
   * @param {GroupInstance} instance
   */
  async #stopGroupInstanceInternal(instance) {
    if (instance.stopPromise) return instance.stopPromise;
    const stopPromise = (async () => {
      instance.stopping = true;
      if (instance.timer) {
        clearTimeout(instance.timer);
        instance.timer = null;
      }
      const timerResolve = instance.timerResolve;
      instance.timerResolve = null;
      timerResolve?.({ completed: false });
      if (instance.ambientCreationPromise) {
        try {
          await instance.ambientCreationPromise;
        } catch (cause) {
          debug("AmbientSound creation failed while stopping group session", {
            instanceId: instance.id,
            groupId: instance.groupId,
            error: cause?.message ?? cause,
          });
        }
      }
      for (const soundObj of instance.soundObjs) {
        try { soundObj.stop?.(); } catch (_) { /* ignore */ }
      }
      instance.soundObjs.clear();
      await this.#clearCurrentAmbientEmission(instance);
      instance.stopped = true;
      instance.stopping = false;
    })();
    instance.stopPromise = stopPromise;
    try {
      await stopPromise;
    } finally {
      if (!instance.stopped) instance.stopping = false;
      if (instance.stopPromise === stopPromise) instance.stopPromise = null;
    }
  }

  /**
   * Remove finished sound objects from the instance's tracking Set.
   * @param {GroupInstance} instance
   */
  #pruneGroupSoundObjects(instance) {
    for (const soundObj of instance.soundObjs) {
      if (!soundObj.playing) {
        instance.soundObjs.delete(soundObj);
      }
    }
  }

  /**
   * Get positional settings for a group item, respecting volumeMode.
   * @param {object|null} item
   * @param {GroupInstance} instance
   * @returns {{ radius: number, volume: number, walls: boolean, easing: boolean, elevation: number }}
   */
  #getGroupPositionalSettings(item = null, instance) {
    const defaults = this.#getPositionalDefaults();
    const itemPos = item?.positional && typeof item.positional === "object" ? item.positional : {};
    const groupPos = (instance?.group?.positional && typeof instance.group.positional === "object")
      ? instance.group.positional
      : {};

    // If volumeMode === "group", group positional overrides item
    const source = (instance?.group?.volumeMode === "group") ? { ...itemPos, ...groupPos } : itemPos;

    return {
      radius: typeof source.radius === "number" ? source.radius : defaults.radius,
      volume: typeof source.volume === "number" ? source.volume : defaults.volume,
      walls: typeof source.walls === "boolean" ? source.walls : defaults.walls,
      easing: typeof source.easing === "boolean" ? source.easing : defaults.easing,
      elevation: typeof source.elevation === "number" ? source.elevation : defaults.elevation,
    };
  }

  // getTokenDocumentCenter imported from gm-panel-audio-token-utils.js
}

/**
 * @typedef {object} GroupInstance
 * @property {number} id
 * @property {string} groupId
 * @property {string|null} tokenUuid
 * @property {"global"|"token"|"map"} type
 * @property {number} [mapX]         Scene X coordinate (map type only)
 * @property {number} [mapY]         Scene Y coordinate (map type only)
 * @property {number} [mapElevation] Scene elevation (map type only)
 * @property {{ mode: string, avoidImmediateRepeat: boolean, repeat: boolean, offsetMin: number, offsetMax: number }} group
 * @property {Array<{ uuid: string, sound: object, item: object }>} resolvedItems
 * @property {number} currentIndex
 * @property {string|null} lastItemId
 * @property {number|null} timer
 * @property {((result: {completed: boolean}) => void)|null} timerResolve
 * @property {Set} soundObjs
 * @property {boolean} stopped
 * @property {boolean} stopping
 * @property {Promise<void>|null} stopPromise
 * @property {boolean} paused
 * @property {Promise<object|null>|null} ambientCreationPromise
 * @property {Promise<void>|null} ambientCleanupPromise
 * @property {string|null} currentAmbientSoundId
 * @property {string|null} currentSoundUuid
 * @property {string|null} currentSoundName
 * @property {number|null} currentDurationMs
 */
