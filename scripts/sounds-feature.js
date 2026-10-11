import { FEATURE_API_VERSION } from "./constants.js";
import { configureLogger, debug, error } from "./debug.js";
import {
  getPositionalEasing,
  getPositionalElevation,
  getPositionalRadius,
  getPositionalVolume,
  getPositionalWalls,
  getSoundboardState,
  setSoundboardState,
} from "./settings.js";
import { initializeSoundsFeature } from "./initialization.js";
import { attachDropzoneListeners, attachSearchListener } from "./sounds-listeners.js";
import { buildSoundboardCallbacks } from "./ui/gm-panel-app-callbacks.js";
import { handleGroupMapDrop, handleItemMapDrop } from "./ui/gm-panel-app-map-drop.js";
import { GmPanelAudioController } from "./ui/gm-panel-audio-controller.js";
import { attachSoundboardActionListeners } from "./ui/gm-panel-soundboard-actions.js";
import { attachDragRowListeners, attachRowExpandListeners } from "./ui/gm-panel-soundboard-drag.js";
import { GmPanelGroupAudioController } from "./ui/gm-panel-group-audio-controller.js";
import { attachCanvasDropListener } from "./ui/gm-panel-map-drop.js";
import { GmPanelSoundboardStore } from "./ui/gm-panel-soundboard-store.js";

class SoundsFeature {
  #hostServices = null;
  #audioController = null;
  #groupController = null;
  #store = null;
  #canvasDropCleanup = null;
  #restoreTimer = null;
  #activated = false;
  #searchQuery = "";
  #restoreSearchFocus = false;
  #expandedGroupIds = new Set();
  #selectedItemIds = new Set();

  descriptor() {
    return {
      apiVersion: FEATURE_API_VERSION,
      id: "soundboards",
      labelKey: "SIMONE_GM_PANEL.Tabs.Soundboard",
      icon: "fa-solid fa-volume-high",
      order: 20,
      template: "modules/simone-gm-panel-sounds/templates/soundboards-tab.hbs",
      prepareContext: (hostContext) => this.prepareContext(hostContext),
      activate: (hostServices) => this.activate(hostServices),
      deactivate: () => this.deactivate(),
      bind: (element, hostServices) => this.bind(element, hostServices),
    };
  }

  get rendered() {
    return this.#hostServices !== null;
  }

  get selectedTokens() {
    return this.#hostServices?.selectedTokens ?? [];
  }

  async panToToken(uuid) {
    await this.#hostServices?.panToToken(uuid);
  }

  async activate(hostServices) {
    this.#hostServices = hostServices;
    configureLogger(hostServices.logger);
    if (this.#activated) return;

    await initializeSoundsFeature();

    this.#audioController = new GmPanelAudioController(this);
    this.#groupController = new GmPanelGroupAudioController(this, {
      getPositionalDefaults: () => this.getPositionalDefaults(),
    });
    this.#store = new GmPanelSoundboardStore(this);
    this.#audioController.activate();
    this.#activated = true;

    const restoreDelay = game.ready ? 400 : 1200;
    this.#restoreTimer = setTimeout(() => {
      this.#restoreTimer = null;
      void this.#audioController?.restoreAfterLoad();
    }, restoreDelay);
    debug("Sounds feature activated", { restoreDelay });
  }

  async deactivate() {
    if (!this.#activated) {
      this.#hostServices = null;
      return;
    }

    if (this.#restoreTimer !== null) {
      clearTimeout(this.#restoreTimer);
      this.#restoreTimer = null;
    }
    this.#canvasDropCleanup?.destroy?.();
    this.#canvasDropCleanup = null;

    this.#audioController?.deactivate();
    await this.#store?.flushAutosave?.();
    await this.#groupController?.stopAllGroupsAndWait?.();
    await this.#audioController?.stopAllAudio?.();

    this.#activated = false;
    this.#audioController = null;
    this.#groupController = null;
    this.#store = null;
    this.#hostServices = null;
    debug("Sounds feature deactivated");
  }

  async prepareContext() {
    const context = {};
    if (!this.#activated) return context;

    try {
      const state = getSoundboardState();
      const activeCounts = new Map();
      const sessionsByGroup = new Map();
      for (const group of state.groups ?? []) {
        const count = this.#groupController.getGroupInstanceCount(group.id);
        if (count <= 0) continue;
        activeCounts.set(group.id, count);
        sessionsByGroup.set(group.id, await this.#groupController.getGroupSessionViewModels(group.id));
      }
      context.soundboardRows = await this.#audioController.getSoundboardRows(
        this.#searchQuery,
        (value) => this.#normalizeSearchText(value),
        this.#expandedGroupIds,
        this.#selectedItemIds,
        activeCounts,
        sessionsByGroup,
      );
      context.soundboardEntries = context.soundboardRows.filter(
        (row) => row.type === "item" || row.type === "group-member",
      );
    } catch (cause) {
      error("Failed to prepare soundboard context", cause);
      context.soundboardRows = [];
      context.soundboardEntries = [];
    }

    context.soundboardSearchQuery = this.#searchQuery;
    context.isRestoring = this.#audioController?.isRestoring === true;
    if (this.#store?.currentPlaylistKey === null) this.#store.restoreCurrentPlaylist();
    context.currentPlaylistName = this.#store?.currentPlaylistName ?? null;
    context.recentPlaylists = this.#store?.getRecentPlaylistEntries(4) ?? [];
    context.selectedItemCount = this.#selectedItemIds.size;
    return context;
  }

  bind(element, hostServices) {
    this.#hostServices = hostServices;
    if (!(element instanceof HTMLElement) || !this.#activated) return () => {};

    const cleanups = [];
    const addCleanup = (cleanup) => {
      if (typeof cleanup === "function") cleanups.push(cleanup);
    };
    const callbacks = buildSoundboardCallbacks({
      app: this,
      store: this.#store,
      audioController: this.#audioController,
      groupController: this.#groupController,
      toggleGroupExpand: (id) => this.#toggleGroupExpand(id),
      toggleItemSelection: (id) => this.#toggleItemSelection(id),
      createGroupFromSelection: () => this.#createGroupFromSelection(),
      getPositionalDefaults: () => this.getPositionalDefaults(),
    });

    attachSoundboardActionListeners(element, callbacks, addCleanup);
    attachRowExpandListeners(element, {
      toggleRowExpand: (uuid) => this.#audioController.toggleRowExpand(uuid),
      toggleGroupExpand: (groupId) => {
        this.#toggleGroupExpand(groupId);
        void this.render({ force: true });
      },
    }, addCleanup);
    attachDropzoneListeners(element, {
      handleSoundboardDrop: (event) => this.#store.handleSoundboardDrop(event),
    }, addCleanup);
    attachSearchListener(element, {
      setSearchQuery: (query) => {
        this.#searchQuery = query;
        const search = element.querySelector('[data-testid="sgmp-soundboard-search"]');
        this.#restoreSearchFocus = search instanceof HTMLInputElement && document.activeElement === search;
      },
      render: () => this.render({ force: true }),
    }, addCleanup);
    attachDragRowListeners(element, {
      reorderLayout: (sourceId, targetId, after) => void this.#store.reorderLayout(sourceId, targetId, after),
      addItemToGroup: (groupId, itemId) => this.#store.addItemToGroup(groupId, itemId),
      reorderGroupItems: (groupId, sourceId, targetId, after) =>
        void this.#store.reorderGroupItems(groupId, sourceId, targetId, after),
    }, addCleanup);
    this.#canvasDropCleanup?.destroy?.();
    const canvasDropCleanup = attachCanvasDropListener(element, {
      onItemMapDrop: (data) => handleItemMapDrop(this, data),
      onGroupMapDrop: (data) => handleGroupMapDrop(this, this.#groupController, data),
    });
    this.#canvasDropCleanup = canvasDropCleanup;

    this.#restoreSearchInput(element);
    this.#resizeSoundboardCard(element);
    return () => {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup?.();
      canvasDropCleanup?.destroy?.();
      if (this.#canvasDropCleanup === canvasDropCleanup) this.#canvasDropCleanup = null;
    };
  }

  render(_options = {}) {
    return this.#hostServices?.requestRender?.();
  }

  async resolvePlaylistSoundByUuid(uuid) {
    return this.#store?.resolvePlaylistSoundByUuid(uuid) ?? null;
  }

  async toggleSoundboardSound(uuid) {
    const normalized = typeof uuid === "string" ? uuid.trim() : "";
    if (!normalized) return;
    await this.#audioController.playSound(normalized);
    await this.render({ force: true });
  }

  async playSoundboardSound(uuid, overrides) {
    await this.#audioController.playSound(uuid, overrides);
  }

  async stopSoundboardSound() {
    await this.#audioController.stopAllSounds();
  }

  async stopAllGroups() {
    await this.#groupController.stopAllGroups?.();
  }

  async removeSoundboardSound(uuid) {
    const normalized = typeof uuid === "string" ? uuid.trim() : "";
    if (!normalized) return;
    await this.#audioController.removeSoundByUuid(normalized);
    const state = getSoundboardState();
    const nextItems = state.items.filter((item) => item.uuid !== normalized);
    if (nextItems.length === state.items.length) return;
    await setSoundboardState({ ...state, items: nextItems });
    this.#store.scheduleAutosave();
    await this.render({ force: true });
  }

  async cleanAllSoundboardSounds() {
    const state = getSoundboardState();
    if (!state.items.length && !state.groups.length) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      title: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.Title"),
      content: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.CleanAllConfirm"),
      yes: { label: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.CleanAllOk"), default: true },
      no: { label: game.i18n.localize("Cancel") },
      modal: true,
    });
    if (!confirmed) return;
    await this.stopSoundboardSound();
    await this.#groupController.stopAllGroups?.();
    await this.#store.clearCurrentPlaylist();
    await setSoundboardState({ items: [], groups: [], layout: [] });
    await this.render({ force: true });
  }

  getPositionalDefaults(item = null) {
    const overrides = item?.positional && typeof item.positional === "object" ? item.positional : {};
    return {
      radius: typeof overrides.radius === "number" ? overrides.radius : getPositionalRadius(),
      volume: typeof overrides.volume === "number" ? overrides.volume : getPositionalVolume(),
      walls: typeof overrides.walls === "boolean" ? overrides.walls : getPositionalWalls(),
      easing: typeof overrides.easing === "boolean" ? overrides.easing : getPositionalEasing(),
      elevation: typeof overrides.elevation === "number" ? overrides.elevation : getPositionalElevation(),
    };
  }

  #toggleGroupExpand(groupId) {
    if (this.#expandedGroupIds.has(groupId)) this.#expandedGroupIds.delete(groupId);
    else this.#expandedGroupIds.add(groupId);
  }

  #toggleItemSelection(itemId) {
    if (this.#selectedItemIds.has(itemId)) this.#selectedItemIds.delete(itemId);
    else this.#selectedItemIds.add(itemId);
    void this.render({ force: true });
  }

  async #createGroupFromSelection() {
    if (this.#selectedItemIds.size < 1) return;
    await this.#store.createGroupFromSelection([...this.#selectedItemIds]);
    this.#selectedItemIds.clear();
    await this.render({ force: true });
  }

  #normalizeSearchText(value) {
    try {
      return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
    } catch {
      return String(value ?? "").toLowerCase().trim();
    }
  }

  #restoreSearchInput(element) {
    if (!this.#restoreSearchFocus) return;
    const input = element.querySelector('[data-testid="sgmp-soundboard-search"]');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    this.#restoreSearchFocus = false;
  }

  #resizeSoundboardCard(element) {
    const card = element.querySelector(".sgmp-soundboard-shell");
    const list = element.querySelector(".sgmp-soundboard-list");
    if (!(card instanceof HTMLElement)) return;
    const frame = element.closest(".application");
    if (!(frame instanceof HTMLElement)) return;
    const frameRect = frame.getBoundingClientRect();
    if (frameRect.height <= 0) return;
    const toolbarReserve = card.querySelector(".sgmp-soundboard-toolbar") ? 30 : 0;
    const cardHeight = Math.max(100, frameRect.height - 88);
    card.style.height = `${cardHeight}px`;
    if (list instanceof HTMLElement) {
      list.style.maxHeight = `${Math.max(60, cardHeight - toolbarReserve - 78)}px`;
    }
  }
}

export const soundsFeature = new SoundsFeature();
