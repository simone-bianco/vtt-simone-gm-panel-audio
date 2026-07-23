import { debug, error } from "../debug.js";

/**
 * Soundboard drop & resolution helpers extracted from GmPanelSoundboardStore.
 *
 * @typedef {object} DropDeps
 * @property {function(): object[]} getStateItems  — current soundboard items
 * @property {function(): object}  getState        — full soundboard state
 * @property {function(object[]): Promise<void>} setItems
 * @property {function(object): Promise<void>} setState
 * @property {function(): void} scheduleAutosave
 * @property {function(): Promise<void>} render
 */

/**
 * Handle a soundboard drop event (PlaylistSound or entire Playlist).
 * @param {DropDeps} deps
 * @param {boolean} dropping  mutable ref (deps tracks this via closure)
 * @param {Event} event
 */
export async function handleSoundboardDrop(deps, dropping, event) {
  if (dropping.value) return;
  dropping.value = true;

  try {
    const dragData = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (dragData?.type === "SGMPSoundboardRow") return;

    if (dragData?.type === "Playlist") {
      await _handlePlaylistDrop(deps, dragData);
      return;
    }

    if (dragData?.type !== "PlaylistSound") {
      ui.notifications?.warn(game.i18n.localize("SIMONE_GM_PANEL.Notifications.InvalidSoundDrop"));
      return;
    }

    const sound = await _resolvePlaylistSoundFromDropData(dragData);
    if (!sound?.uuid) {
      ui.notifications?.warn(game.i18n.localize("SIMONE_GM_PANEL.Notifications.InvalidSoundDrop"));
      return;
    }

    const currentItems = deps.getStateItems();
    if (currentItems.some((item) => item.uuid === sound.uuid)) {
      debug("Duplicate soundboard drop ignored", { uuid: sound.uuid, name: sound.name });
      return;
    }

    await deps.setItems([...currentItems, { uuid: sound.uuid }]);
    debug("Soundboard sound added", { uuid: sound.uuid, name: sound.name, path: sound.path });
    deps.scheduleAutosave();
    await deps.render();
  } catch (dropError) {
    error("Failed to process soundboard drop.", { error: dropError });
    ui.notifications?.warn(game.i18n.localize("SIMONE_GM_PANEL.Notifications.InvalidSoundDrop"));
  } finally {
    dropping.value = false;
  }
}

/**
 * Reorder soundboard items.
 * @param {DropDeps} deps
 */
export async function reorderSoundboardItems(deps, sourceUuid, targetUuid, placeAfter) {
  const normalizedSource = typeof sourceUuid === "string" ? sourceUuid.trim() : "";
  const normalizedTarget = typeof targetUuid === "string" ? targetUuid.trim() : "";
  if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) return;

  const currentItems = [...deps.getStateItems()];
  const sourceIndex = currentItems.findIndex((item) => item.uuid === normalizedSource);
  const targetIndex = currentItems.findIndex((item) => item.uuid === normalizedTarget);
  if (sourceIndex === -1 || targetIndex === -1) return;

  const [moved] = currentItems.splice(sourceIndex, 1);
  const nextTargetIndex = currentItems.findIndex((item) => item.uuid === normalizedTarget);
  currentItems.splice(placeAfter ? nextTargetIndex + 1 : nextTargetIndex, 0, moved);
  await deps.setItems(currentItems);
  debug("Soundboard items reordered", { sourceUuid: normalizedSource, targetUuid: normalizedTarget, placeAfter });
  deps.scheduleAutosave();
  await deps.render();
}

/**
 * Resolve a PlaylistSound from a UUID string.
 */
export async function resolvePlaylistSoundByUuid(uuid) {
  const normalizedUuid = typeof uuid === "string" ? uuid.trim() : "";
  if (!normalizedUuid || typeof foundry.utils.fromUuid !== "function") return null;

  try {
    const document = await foundry.utils.fromUuid(normalizedUuid);
    return document?.documentName === "PlaylistSound" ? document : null;
  } catch (resolveError) {
    debug("Unable to resolve playlist sound UUID", { uuid: normalizedUuid, error: resolveError?.message ?? resolveError });
    return null;
  }
}

// ── private ──

async function _resolvePlaylistSoundFromDropData(data) {
  if (data?.type !== "PlaylistSound") return null;
  if (typeof globalThis.PlaylistSound?.implementation?.fromDropData === "function") {
    const document = await globalThis.PlaylistSound.implementation.fromDropData(data);
    return document?.documentName === "PlaylistSound" ? document : null;
  }
  if (typeof data?.uuid === "string" && typeof foundry.utils.fromUuid === "function") {
    const document = await foundry.utils.fromUuid(data.uuid);
    return document?.documentName === "PlaylistSound" ? document : null;
  }
  return null;
}

async function _resolvePlaylistFromDropData(data) {
  if (data?.type !== "Playlist") return null;
  if (typeof data?.uuid === "string" && typeof foundry.utils.fromUuid === "function") {
    const doc = await foundry.utils.fromUuid(data.uuid);
    if (doc?.documentName === "Playlist") return doc;
  }
  return null;
}

async function _handlePlaylistDrop(deps, dragData) {
  const playlist = await _resolvePlaylistFromDropData(dragData);
  if (!playlist) {
    ui.notifications?.warn(game.i18n.localize("SIMONE_GM_PANEL.Notifications.InvalidSoundDrop"));
    return;
  }

  const sounds = playlist.sounds?.contents ?? playlist.sounds ?? [];
  const currentItems = deps.getStateItems();
  const newItems = [];

  for (const sound of sounds) {
    const uuid = sound?.uuid?.trim();
    if (!uuid) continue;
    if (currentItems.some((item) => item.uuid === uuid) || newItems.some((item) => item.uuid === uuid)) continue;
    newItems.push({ uuid });
  }

  if (!newItems.length) {
    debug("Playlist drop ignored — all duplicates", { playlistName: playlist.name });
    return;
  }

  await deps.setItems([...currentItems, ...newItems]);
  debug("Playlist sounds added", { playlistName: playlist.name, count: newItems.length });
  deps.scheduleAutosave();
  await deps.render();
}
