import {
  MODULE_ID,
  ACTIVE_INSTANCES_FLAG,
} from "../constants.js";
import { debug, warn, error } from "../debug.js";
import {
  getSoundboardItems,
  getSoundboardState,
} from "../settings.js";
import { pauseAllForUuid, resumeAllForUuid, removeAllForUuid } from "./gm-panel-audio-row-actions.js";
import { stopSoundInstance, pauseSoundInstance, toggleInstancePause } from "./gm-panel-audio-instance-control.js";
import { handleAudioTokenUpdate, handleAudioTokenDelete } from "./gm-panel-audio-token-hooks.js";
import { restoreAudioInstances } from "./gm-panel-audio-restore.js";
import { getEntries as getEntriesImpl, getSoundboardRows as getSoundboardRowsImpl } from "./gm-panel-audio-view-model.js";
import { computeDelay, serializeActiveInstances } from "./gm-panel-audio-persistence.js";
import {
  createSoundInstance,
  detachInstanceEndListener,
} from "./gm-panel-audio-sound-instances.js";
import { createPositionalOneShotSoundsForTokens } from "./gm-panel-positional-audio.js";
import {
  createAmbientSoundsForTokens,
  findFlaggedAmbientDocs,
  adoptAmbientDoc,
  dedupeFlaggedDocs,
  forceAmbientRefresh,
  stopAmbientInstance as stopAmbientInstanceImpl,
  pauseAmbientInstance as pauseAmbientInstanceImpl,
  resumeAmbientInstance as resumeAmbientInstanceImpl,
} from "./gm-panel-ambient-audio.js";
import {
  awaitAudioReady,
  getPositionalSettings,
  playSound as playSoundImpl,
  removeSoundByUuid as removeSoundByUuidImpl,
} from "./gm-panel-audio-playback.js";

/**
 * @class GmPanelAudioController
 *
 * Encapsulates ALL audio playback state and logic for the GM Panel.
 * Owns: active sound instances, ambient sound instances, row pause/stop tracking,
 * expand state, token hook bindings, and persistence.
 *
 * The controller receives a reference to the parent SimoneGmPanelApp so it can
 * call {@link ApplicationV2#render} and access shared helpers
 * ({@link #resolvePlaylistSoundByUuid}, {@link selectedTokens}).
 */
export class GmPanelAudioController {
  /** @type {import("./gm-panel-app.js").SimoneGmPanelApp} */
  #app;

  /** @type {Array} */
  #activeInstances = [];

  /** @type {Array} */
  #ambientSoundInstances = [];

  #instanceIdCounter = 0;

  #rowStoppedInstanceIds = new Map();

  #rowStoppedAmbientUuids = new Map();

  #isRestoring = false;

  /** @type {Set<string>} Set of row UUIDs that are currently expanded */
  #expandedRows = new Set();

  // Token hook arrow-wrapped references -- set in constructor to avoid V8 field-initializer issues
  #boundUpdateToken;
  #boundDeleteToken;

  /**
   * @param {import("./gm-panel-app.js").SimoneGmPanelApp} app
   */
  constructor(app) {
    this.#app = app;
    this.#boundUpdateToken = this._onUpdateToken.bind(this);
    this.#boundDeleteToken = this._onDeleteToken.bind(this);
  }

  // -- Public getters ----------------------------------------------

  get activeInstances() { return this.#activeInstances; }
  get ambientInstances() { return this.#ambientSoundInstances; }
  get isRestoring() { return this.#isRestoring; }
  get expandedRows() { return this.#expandedRows; }

  // -- Lifecycle --------------------------------------------------

  /** Register token hooks. Call in _onFirstRender. */
  activate() {
    Hooks.on("updateToken", this.#boundUpdateToken);
    Hooks.on("deleteToken", this.#boundDeleteToken);
  }

  /** Unregister token hooks. Call in _onClose. */
  deactivate() {
    Hooks.off("updateToken", this.#boundUpdateToken);
    Hooks.off("deleteToken", this.#boundDeleteToken);
  }

  // -- Public API -------------------------------------------------

  /**
   * Stop ALL audio (sound + ambient) and clear all tracking state.
   * Also cleans up any orphan module-owned AmbientSound docs still
   * flagged on the scene (defense against split-state leaks).
   * Called when the panel closes.
   */
  async stopAllAudio() {
    const soundInstances = [...this.#activeInstances];
    this.#activeInstances = [];
    const ambientInstances = [...this.#ambientSoundInstances];
    this.#ambientSoundInstances = [];
    this.#rowStoppedInstanceIds.clear();
    this.#rowStoppedAmbientUuids.clear();

    for (const instance of soundInstances) {
      detachInstanceEndListener(instance);
      if (instance._loopTimer) {
        clearTimeout(instance._loopTimer);
        instance._loopTimer = null;
      }
      instance.soundObj?.stop?.();
    }

    // Delete tracked AmbientSound docs (deduped by doc.id)
    const deletedIds = new Set();
    for (const instance of ambientInstances) {
      const doc = canvas.scene?.sounds?.get(instance.ambientSoundId);
      const isOwned = doc?.getFlag?.(MODULE_ID, "instanceType") === "soundboard-positional"
        && doc.getFlag(MODULE_ID, "soundUuid") === instance.soundUuid
        && doc.getFlag(MODULE_ID, "tokenUuid") === instance.tokenUuid;
      if (isOwned && !deletedIds.has(doc.id)) {
        await doc.delete();
        deletedIds.add(doc.id);
      }
    }

    // Also clean up any flagged orphan AmbientSound docs not covered by tracking
    const flaggedOrphans = canvas.scene?.sounds?.filter((doc) =>
      doc.getFlag?.(MODULE_ID, "instanceType") === "soundboard-positional"
      && !deletedIds.has(doc.id)) ?? [];
    for (const doc of flaggedOrphans) {
      if (doc.getFlag?.(MODULE_ID, "instanceType") !== "soundboard-positional") continue;
      await doc.delete();
      deletedIds.add(doc.id);
    }

    void this._persistActiveInstances();
  }

  /**
   * Restore previously active instances from user flags.
   * Called after a short delay in _onFirstRender.
   */
  async restoreAfterLoad() {
    return restoreAudioInstances({
      isRestoring: this.#isRestoring,
      setIsRestoring: (v) => { this.#isRestoring = v; },
      resolveSound: (uuid) => this.#app.resolvePlaylistSoundByUuid(uuid),
      render: (opts) => this.#app.render(opts),
      awaitAudioReady,
      getPositionalSettings,
      createAmbientSounds: (sp, su, tus, lp, pos) => this._createAmbientSoundsForTokens(sp, su, tus, lp, pos),
      createSoundInstance: (opts) => this._createSoundInstance(opts),
      persist: () => this._persistActiveInstances(),
    });
  }

  /**
   * Play a soundboard sound  --  positional if tokens selected, direct otherwise.
   * @param {string} uuid - PlaylistSound UUID
   * @param {object} [overrides] - Unused currently
   */
  async playSound(uuid, _overrides) {
    return playSoundImpl({
      resolvePlaylistSoundByUuid: (u) => this.#app.resolvePlaylistSoundByUuid(u),
      selectedTokens: () => this.#app.selectedTokens,
      getSoundboardItems,
      createAmbientSoundsForTokens: (...a) => this._createAmbientSoundsForTokens(...a),
      createPositionalOneShotSoundsForTokens: (o) => this._createPositionalOneShotSoundsForTokens(o),
      createSoundInstance: (o) => this._createSoundInstance(o),
      persistActiveInstances: () => this._persistActiveInstances(),
    }, uuid);
  }

  /**
   * Stop ALL currently playing soundboard instances (sound + ambient).
   */
  async stopAllSounds() {
    const instanceIds = this.#activeInstances.map((i) => i.id);
    for (const id of instanceIds) {
      await this.stopInstance(id);
    }
    const ambientIds = this.#ambientSoundInstances.map((i) => i.id);
    for (const id of ambientIds) {
      await this.stopAmbientInstance(id);
    }
  }

  /**
   * Remove all instances for a given sound UUID (sound + ambient, with confirm dialog).
   */
  async removeSoundByUuid(uuid) {
    return removeSoundByUuidImpl({
      activeInstances: this.#activeInstances,
      ambientSoundInstances: this.#ambientSoundInstances,
      rowStoppedAmbientUuids: this.#rowStoppedAmbientUuids,
      stopInstance: (id) => this.stopInstance(id),
      stopAmbientInstance: (id) => this.stopAmbientInstance(id),
    }, uuid);
  }

  // -- Expand / collapse -------------------------------------------

  toggleRowExpand(uuid) {
    const normalizedUuid = typeof uuid === "string" ? uuid.trim() : "";
    if (!normalizedUuid) return;
    if (this.#expandedRows.has(normalizedUuid)) {
      this.#expandedRows.delete(normalizedUuid);
    } else {
      this.#expandedRows.add(normalizedUuid);
    }
    void this.#app.render({ force: true });
  }

  // -- Instance control --------------------------------------------

  /**
   * Fully stop and remove a sound instance from tracking.
   */
  async stopInstance(instanceId) {
    return stopSoundInstance(instanceId, {
      activeInstances: this.#activeInstances,
      removeTrackedInstance: (id) => this._removeTrackedInstance(id),
      persist: () => this._persistActiveInstances(),
    });
  }

  /**
   * Pause or resume a sound instance.
   */
  async pauseInstance(instanceId) {
    return pauseSoundInstance(instanceId, {
      activeInstances: this.#activeInstances,
    });
  }

  async togglePauseForInstance(instanceId, instanceType) {
    return toggleInstancePause(instanceId, instanceType, {
      ambientInstances: this.#ambientSoundInstances,
      resumeAmbientInstance: (id) => this.resumeAmbientInstance(id),
      pauseAmbientInstance: (id) => this.pauseAmbientInstance(id),
      pauseSoundInstance: (id) => this.pauseInstance(id),
    });
  }

  /**
   * Fully stop and remove an ambient sound instance.
   */
  async stopAmbientInstance(instanceId) {
    return stopAmbientInstanceImpl(instanceId, {
      ambientInstances: this.#ambientSoundInstances,
      removeAmbientInstance: (id) => this._removeAmbientInstance(id),
      persist: () => this._persistActiveInstances(),
    });
  }

  async pauseAmbientInstance(instanceId) {
    return pauseAmbientInstanceImpl(instanceId, {
      ambientInstances: this.#ambientSoundInstances,
      persist: () => this._persistActiveInstances(),
    });
  }

  async resumeAmbientInstance(instanceId) {
    return resumeAmbientInstanceImpl(instanceId, {
      ambientInstances: this.#ambientSoundInstances,
      persist: () => this._persistActiveInstances(),
    });
  }

  // -- Row-level mass actions --------------------------------------

  /**
   * Pause all active instances for a given sound UUID.
   * Sound instances are paused (kept in array). Ambient instances are stopped
   * from canvas but their token data is saved for resume.
   */
  async pauseAllForUuid(uuid) {
    return pauseAllForUuid(uuid, {
      activeInstances: this.#activeInstances,
      ambientInstances: this.#ambientSoundInstances,
      rowStoppedInstanceIds: this.#rowStoppedInstanceIds,
      pauseInstance: (id) => this.pauseInstance(id),
      pauseAmbientInstance: (id) => this.pauseAmbientInstance(id),
      persist: () => this._persistActiveInstances(),
    });
  }

  /**
   * Resume all paused instances for a given sound UUID.
   * Sound instances are unpaused. Ambient instances are re-created from saved data.
   */
  async resumeAllForUuid(uuid) {
    return resumeAllForUuid(uuid, {
      activeInstances: this.#activeInstances,
      rowStoppedInstanceIds: this.#rowStoppedInstanceIds,
      pauseInstance: (id) => this.pauseInstance(id),
      resumeAmbientInstance: (id) => this.resumeAmbientInstance(id),
      persist: () => this._persistActiveInstances(),
    });
  }

  /**
   * PERMANENTLY remove ALL instances (sound + ambient) for a given sound UUID.
   * Requires explicit user confirmation.
   */
  async removeAllForUuid(uuid) {
    return removeAllForUuid(uuid, {
      activeInstances: this.#activeInstances,
      ambientInstances: this.#ambientSoundInstances,
      rowStoppedInstanceIds: this.#rowStoppedInstanceIds,
      rowStoppedAmbientUuids: this.#rowStoppedAmbientUuids,
      stopInstance: (id) => this.stopInstance(id),
      stopAmbientInstance: (id) => this.stopAmbientInstance(id),
    });
  }

  // -- Entries / view model ----------------------------------------

  async getEntries(items, searchQuery, normalizeSearchText) {
    return getEntriesImpl({ items, searchQuery, normalizeSearchText, resolvePlaylistSoundByUuid: (u) => this.#app.resolvePlaylistSoundByUuid(u), expandedRows: this.#expandedRows, activeInstances: this.#activeInstances, ambientSoundInstances: this.#ambientSoundInstances, rowStoppedInstanceIds: this.#rowStoppedInstanceIds, rowStoppedAmbientUuids: this.#rowStoppedAmbientUuids });
  }

  async getSoundboardRows(searchQuery, normalizeSearchText, expandedGroupIds, selectedItemIds, groupActiveCounts, groupSessionsByGroupId) {
    return getSoundboardRowsImpl({ state: getSoundboardState(), searchQuery, normalizeSearchText, resolvePlaylistSoundByUuid: (u) => this.#app.resolvePlaylistSoundByUuid(u), expandedRows: this.#expandedRows, activeInstances: this.#activeInstances, ambientSoundInstances: this.#ambientSoundInstances, rowStoppedInstanceIds: this.#rowStoppedInstanceIds, rowStoppedAmbientUuids: this.#rowStoppedAmbientUuids, expandedGroupIds, groupActiveCounts, selectedItemIds, groupSessionsByGroupId });
  }

  // -- Private: audio helpers --------------------------------------

  async _createSoundInstance({ soundPath, soundUuid, volume, loop, computeDelay }) {
    return createSoundInstance({
      soundPath, soundUuid, volume, loop, computeDelay,
      nextInstanceId: () => ++this.#instanceIdCounter,
      pushActiveInstance: (inst) => this.#activeInstances.push(inst),
      findActiveInstance: (id) => this.#activeInstances.some((i) => i.id === id),
      removeTrackedInstance: (id) => this._removeTrackedInstance(id),
      persist: () => void this._persistActiveInstances(),
      render: () => void this.#app.render({ force: true }),
    });
  }

  // -- Private: AmbientSound document helpers (flag-based) ----------

  /**
   * Find all module-owned AmbientSound documents on the scene for a
   * given soundUuid+tokenUuid pair, matching by module flags.
   * @param {string} soundUuid
   * @param {string} tokenUuid
   * @returns {Array<foundry.documents.AmbientSoundDocument>}
   */
  _findFlaggedAmbientDocs(soundUuid, tokenUuid) {
    return findFlaggedAmbientDocs(soundUuid, tokenUuid);
  }

  _adoptAmbientDoc(doc, soundUuid, tokenUuid, soundPath, loop) {
    return adoptAmbientDoc({
      doc, soundUuid, tokenUuid, soundPath, loop,
      ambientInstances: this.#ambientSoundInstances,
      findAmbientInstance: (ambientId) => this.#ambientSoundInstances.find((inst) => inst.ambientSoundId === ambientId),
      nextInstanceId: () => ++this.#instanceIdCounter,
      pushAmbientInstance: (inst) => this.#ambientSoundInstances.push(inst),
    });
  }

  async _dedupeFlaggedDocs(soundUuid, tokenUuid) {
    return dedupeFlaggedDocs({
      soundUuid, tokenUuid,
      ambientInstances: this.#ambientSoundInstances,
      findAmbientInstance: (ambientId) => this.#ambientSoundInstances.find((inst) => inst.ambientSoundId === ambientId),
      removeAmbientInstanceByDocId: (ambientId) => {
        const idx = this.#ambientSoundInstances.findIndex((inst) => inst.ambientSoundId === ambientId);
        if (idx !== -1) this.#ambientSoundInstances.splice(idx, 1);
      },
    });
  }

  _forceAmbientRefresh(doc) {
    forceAmbientRefresh(doc);
  }

  async _createPositionalOneShotSoundsForTokens({ soundPath, soundUuid, tokenUuids, volume, positional, computeDelay }) {
    return createPositionalOneShotSoundsForTokens({
      soundPath, soundUuid, tokenUuids, volume, positional, computeDelay,
      nextInstanceId: () => ++this.#instanceIdCounter,
      pushActiveInstance: (inst) => this.#activeInstances.push(inst),
      removeTrackedInstance: (id) => this._removeTrackedInstance(id),
      persist: () => void this._persistActiveInstances(),
      render: () => void this.#app.render({ force: true }),
    });
  }

  async _createAmbientSoundsForTokens(soundPath, soundUuid, tokenUuids, loop, positional) {
    return createAmbientSoundsForTokens({
      soundPath, soundUuid, tokenUuids, loop, positional,
      getPositionalSettings,
      dedupeFlagged: (su, tu) => this._dedupeFlaggedDocs(su, tu),
      adoptAmbient: (doc, su, tu, sp, lp) => this._adoptAmbientDoc(doc, su, tu, sp, lp),
      forceRefresh: (doc) => this._forceAmbientRefresh(doc),
    });
  }

  // -- Private: tracking / cleanup ---------------------------------

  _removeAmbientInstance(instanceId) {
    const index = this.#ambientSoundInstances.findIndex((inst) => inst.id === instanceId);
    if (index === -1) return;
    this.#ambientSoundInstances.splice(index, 1);
    for (const [uuid, ids] of this.#rowStoppedInstanceIds) {
      ids.delete(`ambient:${instanceId}`);
      if (ids.size === 0) this.#rowStoppedInstanceIds.delete(uuid);
    }
  }

  _removeTrackedInstance(instanceId) {
    const index = this.#activeInstances.findIndex((instance) => instance.id === instanceId);
    if (index === -1) return null;

    const [instance] = this.#activeInstances.splice(index, 1);
    detachInstanceEndListener(instance);

    for (const [uuid, ids] of this.#rowStoppedInstanceIds) {
      ids.delete(instanceId);
      if (ids.size === 0) this.#rowStoppedInstanceIds.delete(uuid);
    }

    return instance;
  }

  // detachInstanceEndListener imported from gm-panel-audio-sound-instances.js

  // -- Private: persistence ----------------------------------------

  // serializeActiveInstances imported from gm-panel-audio-persistence.js

  async _persistActiveInstances() {
    const data = serializeActiveInstances(this.#activeInstances, this.#ambientSoundInstances);
    debug("Persisting active instances", { count: data.length, uuids: data.map((d) => d.soundUuid) });
    await game.user.setFlag(MODULE_ID, ACTIVE_INSTANCES_FLAG, data).catch((err) => {
      error("Failed to persist active instances", err);
    });
  }

  // -- Private: token hooks ----------------------------------------

  async _onUpdateToken(tokenDoc, change, options, userId) {
    return handleAudioTokenUpdate(tokenDoc, change, options, userId, {
      ambientInstances: this.#ambientSoundInstances,
      getPositionalSettings,
      forceAmbientRefresh: (doc) => this._forceAmbientRefresh(doc),
      adoptAmbientDoc: (doc, su, tu, sp, lp) => this._adoptAmbientDoc(doc, su, tu, sp, lp),
    });
  }

  async _onDeleteToken(tokenDoc, options, userId) {
    return handleAudioTokenDelete(tokenDoc, options, userId, {
      ambientInstances: this.#ambientSoundInstances,
      removeAmbientInstance: (id) => this._removeAmbientInstance(id),
      persist: () => this._persistActiveInstances(),
    });
  }
}
