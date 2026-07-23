import { MODULE_ID } from "../constants.js";
import { debug, error } from "../debug.js";
import {
  getSavedPlaylists,
  getSoundboardItems,
  getSoundboardState,
  setSavedPlaylists,
  setSoundboardItems,
  setSoundboardState,
} from "../settings.js";
import { promptTextInput } from "./gm-panel-dialogs.js";
import { normalizeSoundboardItems } from "./gm-panel-soundboard-normalize.js";
import { openLoadModal as openLoadModalImpl } from "./gm-panel-playlist-modal.js";
import { openSoundSettings as openSoundSettingsImpl } from "./gm-panel-sound-settings.js";
import { createAutosaveScheduler } from "./gm-panel-playlist-autosave.js";
import {
  handleSoundboardDrop as _handleSoundboardDrop,
  reorderSoundboardItems as _reorderSoundboardItems,
  resolvePlaylistSoundByUuid as _resolvePlaylistSoundByUuid,
} from "./gm-panel-store-drops.js";
import {
  createGroupFromSelection as _createGroupFromSelection,
  createEmptyGroup as _createEmptyGroup,
  updateGroup as _updateGroup,
  deleteGroup as _deleteGroup,
  addItemToGroup as _addItemToGroup,
  removeItemFromGroup as _removeItemFromGroup,
  reorderGroupItems as _reorderGroupItems,
  reorderLayout as _reorderLayout,
  getGroupById as _getGroupById,
  getItemsForGroup as _getItemsForGroup,
} from "./gm-panel-store-groups.js";

/**
 * @class GmPanelSoundboardStore
 *
 * Manages all CRUD operations for soundboard items and playlists:
 * save, load, new, rename, delete, reorder, sound settings, loop toggle,
 * drag-drop handlers, and playlist sound resolution.
 *
 * The controller receives a reference to the parent SimoneGmPanelApp so it can
 * call {@link ApplicationV2#render} and access shared helpers.
 */
export class GmPanelSoundboardStore {
  /** @type {import("./gm-panel-app.js").SimoneGmPanelApp} */
  #app;

  #currentPlaylistKey = null;
  #currentPlaylistName = null;
  #currentPlaylistRestored = false;
  #droppingSoundboard = false;
  #autosave;

  /**
   * @param {import("./gm-panel-app.js").SimoneGmPanelApp} app
   */
  constructor(app) {
    this.#app = app;
    this.#autosave = createAutosaveScheduler({
      getState: () => getSoundboardState(),
      getCurrentPlaylistKey: () => this.#currentPlaylistKey,
      getSavedPlaylists,
      setSavedPlaylists,
      setCurrentPlaylistKey: (key, name) => {
        this.#currentPlaylistKey = key;
        this.#currentPlaylistName = name;
        void this.persistCurrentPlaylist();
      },
    });
  }

  /** Schedule a silent autosave of the current playlist. Call after any mutation. */
  #scheduleAutosave() {
    this.#autosave.scheduleAutosave();
  }

  /** Public API: trigger autosave (for use by app.js mutations like removeSound/cleanAll). */
  scheduleAutosave() {
    this.#autosave.scheduleAutosave();
  }

  /** Public API: flush any pending autosave immediately. Called on panel close. */
  async flushAutosave() {
    await this.#autosave.flushAutosave();
  }

  // ── Public getters ──────────────────────────────────────────────

  get currentPlaylistKey() { return this.#currentPlaylistKey; }
  get currentPlaylistName() { return this.#currentPlaylistName; }

  // ── Recent playlist metadata ──────────────────────────────────────

  /** @returns {Array<{ key: string, name: string, count: number, isCurrent: boolean }>} */
  getRecentPlaylistEntries(limit = 4) {
    const playlists = getSavedPlaylists();
    const currentKey = this.#currentPlaylistKey;
    return Object.entries(playlists)
      .map(([key, pl]) => ({
        key,
        name: pl.name ?? "?",
        count: pl.items?.length ?? 0,
        usageCount: typeof pl.usageCount === "number" ? pl.usageCount : 0,
        lastUsedAt: typeof pl.lastUsedAt === "number" ? pl.lastUsedAt : 0,
        savedAt: typeof pl.savedAt === "number" ? pl.savedAt : 0,
        isCurrent: key === currentKey,
      }))
      .sort((a, b) => {
        // Current playlist always first
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
        // Then by last used time (most recent first)
        if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
        // Then by saved time (newest first)
        if (b.savedAt !== a.savedAt) return b.savedAt - a.savedAt;
        // Then by usage count (most used first)
        if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
        // Alphabetical tiebreaker
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  }

  async quickLoadPlaylist(key) {
    if (typeof key !== "string" || !key) return;
    try {
      const playlists = getSavedPlaylists();
      const pl = playlists[key];
      if (!pl) { debug("Quick-load: playlist not found", { key }); return; }

      // Load the playlist state — do NOT stop audio. Switch is view-only.
      if (Array.isArray(pl.groups) || Array.isArray(pl.layout)) {
        await setSoundboardState({
          items: pl.items ?? [],
          groups: pl.groups ?? [],
          layout: pl.layout ?? [],
        });
      } else {
        const items = pl.items ?? [];
        const normalizedItems = normalizeSoundboardItems(items);
        await setSoundboardItems(normalizedItems);
      }

      this.#currentPlaylistKey = key;
      this.#currentPlaylistName = pl.name;
      void this.persistCurrentPlaylist();
      await this.bumpPlaylistUsage(key);
      debug("Playlist quick-loaded", { key, name: pl.name });
      this.#scheduleAutosave();
      await this.#app.render({ force: true });
    } catch (err) {
      error("Failed to quick-load playlist", { key, error: err });
    }
  }

  async bumpPlaylistUsage(key) {
    if (typeof key !== "string" || !key) return;
    try {
      const playlists = getSavedPlaylists();
      if (!playlists[key]) return;
      playlists[key] = {
        ...playlists[key],
        usageCount: (playlists[key].usageCount ?? 0) + 1,
        lastUsedAt: Date.now(),
      };
      await setSavedPlaylists(playlists);
      debug("Playlist usage bumped", { key, usageCount: playlists[key].usageCount });
    } catch (err) {
      error("Failed to bump playlist usage", { key, error: err });
    }
  }

  // ── Group CRUD (delegated to gm-panel-store-groups.js) ──────

  #groupDeps() { return { getState: () => getSoundboardState(), setState: (s) => setSoundboardState(s), scheduleAutosave: () => this.#scheduleAutosave(), render: () => this.#app.render({ force: true }) }; }

  async createGroupFromSelection(itemIds, options = {}) {
    return _createGroupFromSelection(this.#groupDeps(), itemIds, options);
  }

  async createEmptyGroup(name = null) {
    return _createEmptyGroup(this.#groupDeps(), name);
  }

  async updateGroup(groupId, patch) {
    return _updateGroup(this.#groupDeps(), groupId, patch);
  }

  async deleteGroup(groupId) {
    return _deleteGroup(this.#groupDeps(), groupId);
  }

  async addItemToGroup(groupId, itemId) {
    return _addItemToGroup(this.#groupDeps(), groupId, itemId);
  }

  async removeItemFromGroup(groupId, itemId) {
    return _removeItemFromGroup(this.#groupDeps(), groupId, itemId);
  }

  async reorderGroupItems(groupId, sourceItemId, targetItemId, placeAfter) {
    return _reorderGroupItems(this.#groupDeps(), groupId, sourceItemId, targetItemId, placeAfter);
  }

  async reorderLayout(sourceId, targetId, placeAfter) {
    return _reorderLayout(this.#groupDeps(), sourceId, targetId, placeAfter);
  }

  getGroupById(groupId) {
    return _getGroupById(getSoundboardState(), groupId);
  }

  getItemsForGroup(groupId) {
    return _getItemsForGroup(getSoundboardState(), groupId);
  }

  // ── Loop toggle ─────────────────────────────────────────────────

  async toggleLoop(uuid) {
    const normalizedUuid = typeof uuid === "string" ? uuid.trim() : "";
    if (!normalizedUuid) return;

    // Use V2 state to preserve groups and layout on toggle
    const state = getSoundboardState();
    const nextItems = state.items.map((item) =>
      item.uuid === normalizedUuid ? { ...item, loop: !item.loop } : item,
    );
    await setSoundboardState({ ...state, items: nextItems });
    const newLoop = nextItems.find((i) => i.uuid === normalizedUuid)?.loop;
    debug("Soundboard loop toggled", { uuid: normalizedUuid, loop: newLoop });
    this.#scheduleAutosave();
    await this.#app.render({ force: true });
  }

  // ── Save / new playlist ─────────────────────────────────────────

  async saveSoundboard() {
    const state = getSoundboardState();
    if (!state.items.length) {
      ui.notifications?.info(game.i18n.localize("SIMONE_GM_PANEL.Soundboard.SaveEmpty"));
      return;
    }

    try {
      const today = new Date().toISOString().slice(0, 10);
      const now = Date.now();
      const playlists = getSavedPlaylists();

      const existingKey = Object.keys(playlists).find(
        (k) => k.endsWith(`_${today}`) || (playlists[k].savedAt && new Date(playlists[k].savedAt).toISOString().slice(0, 10) === today)
      );

      const key = existingKey ?? `${foundry.utils.randomID()}_${today}`;
      const prevName = existingKey ? playlists[existingKey].name : today;
      const existingMeta = existingKey ? playlists[existingKey] : {};
      playlists[key] = {
        name: prevName,
        items: state.items,
        groups: state.groups,
        layout: state.layout,
        savedAt: now,
        usageCount: existingMeta.usageCount ?? 0,
        lastUsedAt: existingMeta.lastUsedAt ?? null,
      };
      await setSavedPlaylists(playlists);

      const displayName = playlists[key].name;
      this.#currentPlaylistKey = key;
      this.#currentPlaylistName = displayName;
      void this.persistCurrentPlaylist();
      debug("Soundboard saved", { key, name: displayName, count: state.items.length });
      ui.notifications?.info(game.i18n.format("SIMONE_GM_PANEL.Soundboard.Saved", { name: displayName, count: state.items.length }));
    } catch (err) {
      error("Failed to save soundboard", { error: err });
      ui.notifications?.error(game.i18n.localize("SIMONE_GM_PANEL.Soundboard.SaveError"));
    }
  }

  async newPlaylistFromSoundboard() {
    try {
      const name = await promptTextInput({
        title: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.NewPlaylistTitle"),
        placeholder: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.NewPlaylistPlaceholder"),
        okLabel: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.NewPlaylistOk"),
      });
      if (!name) return;

      const playlists = getSavedPlaylists();
      const key = `${foundry.utils.randomID()}_${new Date().toISOString().slice(0, 10)}`;
      playlists[key] = {
        name,
        items: [],
        groups: [],
        layout: [],
        savedAt: Date.now(),
        usageCount: 0,
        lastUsedAt: null,
      };
      await setSavedPlaylists(playlists);

      await this.#app.stopSoundboardSound();
      await setSoundboardItems([]);
      this.#currentPlaylistKey = key;
      this.#currentPlaylistName = name;
      void this.persistCurrentPlaylist();

      debug("New empty playlist created", { key, name });
      this.#scheduleAutosave();
      ui.notifications?.info(game.i18n.format("SIMONE_GM_PANEL.Soundboard.Saved", { name, count: 0 }));
      await this.#app.render({ force: true });
    } catch (err) {
      error("Failed to create new playlist", { error: err });
      ui.notifications?.error(game.i18n.localize("SIMONE_GM_PANEL.Soundboard.SaveError"));
    }
  }

  // ── Load playlist modal ─────────────────────────────────────────

  async openLoadModal() {
    // Extracted to gm-panel-playlist-modal.js for separation of concerns
    await openLoadModalImpl({
      stopSoundboardSound: () => this.#app.stopSoundboardSound(),
      newPlaylistFromSoundboard: () => this.newPlaylistFromSoundboard(),
      render: () => this.#app.render({ force: true }),
      getCurrentPlaylistKey: () => this.#currentPlaylistKey,
      setCurrentPlaylist: (key, name) => {
        this.#currentPlaylistKey = key;
        this.#currentPlaylistName = name;
      },
      persistCurrentPlaylist: () => this.persistCurrentPlaylist(),
      getSavedPlaylists,
      setSavedPlaylists,
      getSoundboardState,
      setSoundboardState,
      setSoundboardItems,
      bumpPlaylistUsage: (key) => this.bumpPlaylistUsage(key),
      getRecentPlaylistEntries: (limit) => this.getRecentPlaylistEntries(limit),
    });
  }

  // ── Sound settings modal ────────────────────────────────────────

  async openSoundSettings(uuid) {
    // Extracted to gm-panel-sound-settings.js for separation of concerns
    await openSoundSettingsImpl(uuid, {
      resolvePlaylistSound: (u) => this.resolvePlaylistSoundByUuid(u),
      getPositionalDefaults: () => this.#app.getPositionalDefaults(),
      getSoundboardState,
      setSoundboardState,
      scheduleAutosave: () => this.#scheduleAutosave(),
      render: () => this.#app.render({ force: true }),
    });
  }

  // ── Drag-drop: soundboard (delegated to gm-panel-store-drops.js) ──

  async handleSoundboardDrop(event) {
    const deps = { getStateItems: () => getSoundboardItems(), getState: () => getSoundboardState(), setItems: (i) => setSoundboardItems(i), setState: (s) => setSoundboardState(s), scheduleAutosave: () => this.#scheduleAutosave(), render: () => this.#app.render({ force: true }) };
    return _handleSoundboardDrop(deps, { value: this.#droppingSoundboard }, event);
  }

  async reorderSoundboardItems(sourceUuid, targetUuid, placeAfter) {
    const deps = { getStateItems: () => getSoundboardItems(), getState: () => getSoundboardState(), setItems: (i) => setSoundboardItems(i), setState: (s) => setSoundboardState(s), scheduleAutosave: () => this.#scheduleAutosave(), render: () => this.#app.render({ force: true }) };
    return _reorderSoundboardItems(deps, sourceUuid, targetUuid, placeAfter);
  }

  // ── Playlist sound resolution (delegated) ────────────────────────

  async resolvePlaylistSoundByUuid(uuid) {
    return _resolvePlaylistSoundByUuid(uuid);
  }

  // ── Current playlist persistence ────────────────────────────────

  async persistCurrentPlaylist() {
    await game.user.setFlag(MODULE_ID, "currentPlaylist", {
      key: this.#currentPlaylistKey,
      name: this.#currentPlaylistName,
    }).catch((err) => error("Failed to persist current playlist", err));
  }

  restoreCurrentPlaylist() {
    if (this.#currentPlaylistRestored) return;
    this.#currentPlaylistRestored = true;

    try {
      const current = game.user.getFlag(MODULE_ID, "currentPlaylist");

      if (!current || typeof current !== "object") {
        this.#currentPlaylistKey = null;
        this.#currentPlaylistName = null;
        return;
      }

      const key = typeof current.key === "string" && current.key ? current.key : null;
      const name = typeof current.name === "string" && current.name ? current.name : null;

      if (!key) {
        this.#currentPlaylistKey = null;
        this.#currentPlaylistName = null;
        return;
      }

      const playlists = getSavedPlaylists();
      const playlist = playlists[key];

      if (!playlist) {
        this.#currentPlaylistKey = null;
        this.#currentPlaylistName = null;
        return;
      }

      this.#currentPlaylistKey = key;
      this.#currentPlaylistName = name ?? playlist.name ?? null;
    } catch (err) {
      error("Failed to restore current playlist", err);
      this.#currentPlaylistKey = null;
      this.#currentPlaylistName = null;
    }
  }

  async clearCurrentPlaylist() {
    this.#currentPlaylistRestored = true;
    this.#currentPlaylistKey = null;
    this.#currentPlaylistName = null;
    await this.persistCurrentPlaylist();
  }

  /** Delete the current playlist and load a nearby one or create a new playlist. */
  async deleteCurrentPlaylist() {
    const currentKey = this.#currentPlaylistKey;
    if (!currentKey) return;

    const playlists = getSavedPlaylists();
    const name = playlists[currentKey]?.name ?? "?";

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      title: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.DeletePlaylistConfirm"),
      content: game.i18n.format("SIMONE_GM_PANEL.Soundboard.DeletePlaylistConfirmContent", { name }),
      yes: { label: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.DeletePlaylistOk"), default: true },
      no: { label: game.i18n.localize("Cancel") },
      modal: true,
    });
    if (!confirmed) return;

    try {
      // Stop all audio before changing state
      await this.#app.stopSoundboardSound();
      this.#app.stopAllGroups?.();

      // Delete from saved playlists
      delete playlists[currentKey];
      await setSavedPlaylists(playlists);

      // Find fallback playlist
      const ordered = Object.entries(playlists)
        .map(([k, p]) => ({ key: k, ...p }))
        .sort((a, b) => {
          if ((b.lastUsedAt ?? 0) !== (a.lastUsedAt ?? 0)) return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
          if ((b.savedAt ?? 0) !== (a.savedAt ?? 0)) return (b.savedAt ?? 0) - (a.savedAt ?? 0);
          return (a.name ?? "").localeCompare(b.name ?? "");
        });

      if (ordered.length) {
        // Load nearest playlist
        const fb = ordered[0];
        const pl = playlists[fb.key];
        if (Array.isArray(pl.groups) || Array.isArray(pl.layout)) {
          await setSoundboardState({ items: pl.items ?? [], groups: pl.groups ?? [], layout: pl.layout ?? [] });
        } else {
          await setSoundboardItems(normalizeSoundboardItems(pl.items ?? []));
        }
        this.#currentPlaylistKey = fb.key;
        this.#currentPlaylistName = fb.name ?? pl.name ?? "?";
        this.#scheduleAutosave();
        void this.persistCurrentPlaylist();
      } else {
        // No playlists left: create empty new playlist
        await this.newPlaylistFromSoundboard();
        return;
      }

      debug("Playlist deleted, loaded fallback", { deleted: name, fallback: this.#currentPlaylistName });
      await this.#app.render({ force: true });
    } catch (err) {
      error("Failed to delete playlist", { key: currentKey, error: err });
    }
  }
}
