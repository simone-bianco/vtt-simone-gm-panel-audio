import { debug, error } from "../debug.js";
import { normalizeSoundboardItems } from "./gm-panel-soundboard-normalize.js";
import { promptTextInput } from "./gm-panel-dialogs.js";

const renderTemplate = foundry.applications.handlebars.renderTemplate;

/**
 * Open the load-playlists modal dialog.
 *
 * Extracted from GmPanelSoundboardStore.openLoadModal.
 * All state access flows through explicit callbacks — no private fields.
 *
 * @param {object} callbacks
 * @param {() => Promise<void>} callbacks.stopSoundboardSound
 * @param {() => Promise<void>} callbacks.newPlaylistFromSoundboard
 * @param {() => Promise<void>} callbacks.render
 * @param {() => string|null} callbacks.getCurrentPlaylistKey
 * @param {(key: string|null, name: string|null) => void} callbacks.setCurrentPlaylist
 * @param {() => Promise<void>} callbacks.persistCurrentPlaylist
 * @param {() => object} callbacks.getSavedPlaylists
 * @param {(playlists: object) => Promise<void>} callbacks.setSavedPlaylists
 * @param {() => object} callbacks.getSoundboardState
 * @param {(state: object) => Promise<void>} callbacks.setSoundboardState
 * @param {(items: Array) => Promise<void>} callbacks.setSoundboardItems
 * @param {(key: string) => Promise<void>} callbacks.bumpPlaylistUsage
 * @param {(limit: number) => Array} callbacks.getRecentPlaylistEntries
 */
export async function openLoadModal({
  stopSoundboardSound,
  newPlaylistFromSoundboard,
  render,
  getCurrentPlaylistKey,
  setCurrentPlaylist,
  persistCurrentPlaylist,
  getSavedPlaylists,
  setSavedPlaylists,
  getSoundboardState,
  setSoundboardState,
  setSoundboardItems,
  bumpPlaylistUsage,
  getRecentPlaylistEntries,
}) {
  try {
    const buildEntries = () => {
      const playlists = getSavedPlaylists();
      return Object.entries(playlists)
        .sort(([, a], [, b]) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
        .map(([key, pl]) => ({
          key, name: pl.name, count: pl.items?.length ?? 0,
          isCurrent: key === getCurrentPlaylistKey(),
        }));
    };

    const entries = buildEntries();
    const templateHtml = await renderTemplate("modules/simone-gm-panel-sounds/templates/load-playlists-modal.hbs", { playlists: entries });
    const content = `<div class="sgmp-modal-body">${templateHtml}</div>`;

    const { DialogV2 } = foundry.applications.api;
    const dialog = new DialogV2({
      title: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.Load"),
      content,
      buttons: [{ action: "close", label: game.i18n.localize("Close") }],
      modal: true,
      rejectClose: false,
      window: { resizable: true },
      position: { width: 580, height: "auto" },
    });

    await dialog.render({ force: true });
    dialog.setPosition({ width: 580, height: "auto" });
    debug("Load playlist modal opened", { playlistCount: entries.length });

    const modalCleanups = [];

    const refreshLoadModal = async () => {
      const freshEntries = buildEntries();
      const freshHtml = await renderTemplate("modules/simone-gm-panel-sounds/templates/load-playlists-modal.hbs", { playlists: freshEntries });
      const bodyEl = dialog.element?.querySelector(".sgmp-modal-body");
      if (bodyEl instanceof HTMLElement) {
        bodyEl.innerHTML = freshHtml;
        debug("Load modal refreshed", { playlistCount: freshEntries.length });
      }
    };

    const el = dialog.element;
    if (!(el instanceof HTMLElement)) return;

    // New playlist
    const newH = delegateClick(el, '[data-action="new-playlist"]', async (event) => {
      event.preventDefault();
      await newPlaylistFromSoundboard();
      void refreshLoadModal();
    });

    // Load
    const loadH = delegateClick(el, '[data-action="load-playlist"]', async (event, matchedElement) => {
      event.preventDefault();
      const key = matchedElement instanceof HTMLElement ? matchedElement.dataset.playlistKey : "";
      if (!key) { debug("Load playlist: missing key"); return; }
      const playlists = getSavedPlaylists();
      const pl = playlists[key];
      if (!pl) { debug("Load playlist: playlist not found", { key }); return; }

      // Load the playlist — do NOT stop audio. Switch is view-only.
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

      setCurrentPlaylist(key, pl.name);
      void persistCurrentPlaylist();
      if (bumpPlaylistUsage) void bumpPlaylistUsage(key);
      debug("Playlist loaded", { key, name: pl.name, count: pl.items?.length ?? 0, hasGroups: !!(pl.groups?.length) });
      ui.notifications?.info(game.i18n.format("SIMONE_GM_PANEL.Soundboard.Loaded", { count: pl.items?.length ?? 0 }));
      await dialog.close();
      await render();
    });

    // Delete
    const deleteH = delegateClick(el, '[data-action="delete-playlist"]', async (event, matchedElement) => {
      event.preventDefault();
      const key = matchedElement instanceof HTMLElement ? matchedElement.dataset.playlistKey : "";
      if (!key) { debug("Delete playlist: missing key"); return; }
      const playlists = getSavedPlaylists();
      const pl = playlists[key];
      if (!pl) return;
      const confirmed = await DialogV2.confirm({
        title: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.LoadDeleteTitle"),
        content: game.i18n.format("SIMONE_GM_PANEL.Soundboard.LoadDeleteConfirm", { name: pl.name }),
        yes: { label: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.LoadDeleteOk"), default: true },
        no: { label: game.i18n.localize("Cancel") },
        modal: true,
      });
      if (!confirmed) return;
      const { [key]: _, ...rest } = getSavedPlaylists();
      await setSavedPlaylists(rest);
      if (getCurrentPlaylistKey() === key) {
        setCurrentPlaylist(null, null);
        void persistCurrentPlaylist();
        void render();
      }
      debug("Playlist deleted", { key, name: pl.name });
      void refreshLoadModal();
    });

    // Rename
    const renameH = delegateClick(el, '[data-action="rename-playlist"]', async (event, matchedElement) => {
      event.preventDefault();
      const key = matchedElement instanceof HTMLElement ? matchedElement.dataset.playlistKey : "";
      if (!key) { debug("Rename playlist: missing key"); return; }
      const playlistsBefore = getSavedPlaylists();
      const pl = playlistsBefore[key];
      if (!pl) { debug("Rename playlist: playlist not found", { key }); return; }
      const oldName = pl.name;
      debug("Rename playlist prompt opened", { key, oldName });
      const newName = await promptTextInput({
        title: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.LoadRenameTitle"),
        defaultValue: oldName,
        okLabel: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.LoadRenameOk"),
      });
      debug("Rename prompt result", { oldName, newName, isSame: newName === oldName, isEmpty: !newName });
      if (!newName || newName === oldName) return;
      const updated = getSavedPlaylists();
      if (updated[key]) {
        updated[key] = { ...updated[key], name: newName };
        await setSavedPlaylists(updated);
        debug("Playlist renamed", { key, oldName, newName });
      }
      void refreshLoadModal();
    });

    // Search
    let searchTimer = null;
    const onSearch = () => {
      const searchInput = dialog.element?.querySelector(".sgmp-playlists-search");
      if (!(searchInput instanceof HTMLInputElement)) return;
      const query = (searchInput.value ?? "").toLowerCase().trim();
      const rows = dialog.element?.querySelectorAll(".sgmp-playlist-row") ?? [];
      rows.forEach((row) => {
        const rowName = row instanceof HTMLElement ? (row.querySelector(".sgmp-playlist-row-name")?.textContent ?? "").toLowerCase() : "";
        row.classList.toggle("sgmp-hidden", query.length > 0 && !rowName.includes(query));
      });
    };
    el.addEventListener("input", (e) => {
      if (!e.target?.matches?.(".sgmp-playlists-search")) return;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(onSearch, 120);
    });

    // Drag-and-drop sort
    let dragSource = null;
    el.addEventListener("dragstart", (e) => {
      const row = e.target?.closest?.(".sgmp-playlist-row");
      if (!row) { e.preventDefault(); return; }
      dragSource = row;
      row.classList.add("sgmp-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.dataset.playlistKey ?? "");
    });
    el.addEventListener("dragend", () => {
      if (dragSource) dragSource.classList.remove("sgmp-dragging");
      dragSource = null;
    });
    el.addEventListener("dragover", (e) => e.preventDefault());
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (!dragSource) return;
      const targetRow = e.target?.closest?.(".sgmp-playlist-row");
      if (!targetRow || targetRow === dragSource) return;

      const playlists = getSavedPlaylists();
      const allKeys = buildEntries();
      const sourceKey = dragSource.dataset.playlistKey;
      const targetKey = targetRow.dataset.playlistKey;
      const orderedKeys = allKeys.map((entry) => entry.key);
      const srcIdx = orderedKeys.indexOf(sourceKey);
      const tgtIdx = orderedKeys.indexOf(targetKey);
      if (srcIdx === -1 || tgtIdx === -1) return;

      orderedKeys.splice(srcIdx, 1);
      orderedKeys.splice(tgtIdx, 0, sourceKey);

      let sortOrder = Date.now();
      const updated = {};
      for (const k of orderedKeys) {
        if (playlists[k]) updated[k] = { ...playlists[k], savedAt: sortOrder-- };
      }
      for (const k of Object.keys(playlists)) {
        if (!(k in updated)) updated[k] = playlists[k];
      }
      await setSavedPlaylists(updated);
      debug("Playlists reordered via drag-drop", { sourceKey, targetKey });
      void refreshLoadModal();
    });

    if (newH) modalCleanups.push(newH);
    if (loadH) modalCleanups.push(loadH);
    if (deleteH) modalCleanups.push(deleteH);
    if (renameH) modalCleanups.push(renameH);

    const origClose = dialog.close.bind(dialog);
    dialog.close = async (options) => {
      for (const fn of modalCleanups) fn();
      return origClose(options);
    };
  } catch (err) {
    error("Failed to open load modal", { error: err });
  }
}
