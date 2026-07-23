/**
 * Playback helpers extracted from GmPanelAudioController to keep the
 * controller under the 500-line threshold.
 *
 * All state flows through explicit deps parameters.
 */

import { debug, error } from "../debug.js";
import { getSoundboardItems, getPositionalRadius, getPositionalVolume, getPositionalWalls, getPositionalEasing, getPositionalElevation } from "../settings.js";
import { computeDelay } from "./gm-panel-audio-persistence.js";

/**
 * Wait for the Foundry audio system to be ready for playback.
 */
export async function awaitAudioReady() {
  if (game.audio?.locked && typeof game.audio.awaitFirstGesture === "function") {
    await game.audio.awaitFirstGesture();
    return;
  }
  if (game.audio?.unlock && typeof game.audio.unlock.then === "function") {
    await game.audio.unlock;
    return;
  }
  if (typeof foundry.audio?.AudioHelper?.awaitFirstGesture === "function") {
    await foundry.audio.AudioHelper.awaitFirstGesture();
  }
}

/**
 * Build positional audio settings for a soundboard item.
 * @param {object|null} item
 * @returns {{ radius: number, volume: number, walls: boolean, easing: boolean, elevation: number }}
 */
export function getPositionalSettings(item = null) {
  const overrides = item?.positional && typeof item.positional === "object" ? item.positional : {};
  return {
    radius: typeof overrides.radius === "number" ? overrides.radius : getPositionalRadius(),
    volume: typeof overrides.volume === "number" ? overrides.volume : getPositionalVolume(),
    walls: typeof overrides.walls === "boolean" ? overrides.walls : getPositionalWalls(),
    easing: typeof overrides.easing === "boolean" ? overrides.easing : getPositionalEasing(),
    elevation: typeof overrides.elevation === "number" ? overrides.elevation : getPositionalElevation(),
  };
}

/**
 * @typedef {object} PlaySoundDeps
 * @property {function(string): Promise<object|null>} resolvePlaylistSoundByUuid
 * @property {function(): Array} selectedTokens
 * @property {function(): Array} getSoundboardItems
 * @property {function(string,string,Array,boolean,object): Promise<void>} createAmbientSoundsForTokens
 * @property {function(object): Promise<void>} createPositionalOneShotSoundsForTokens
 * @property {function(object): Promise<void>} createSoundInstance
 * @property {function(): void} persistActiveInstances
 */

/**
 * Play a sound by its PlaylistSound UUID.
 * @param {PlaySoundDeps} deps
 * @param {string} uuid
 */
export async function playSound(deps, uuid) {
  const sound = await deps.resolvePlaylistSoundByUuid(uuid);
  if (!sound?.path) {
    debug("playSound: sound not found or no path", { uuid });
    ui.notifications?.warn(game.i18n.localize("SIMONE_GM_PANEL.Notifications.MissingSound"));
    return;
  }

  try {
    await awaitAudioReady();

    const selected = deps.selectedTokens() ?? [];
    const volume = Number.isFinite(sound.volume) ? sound.volume : 0.8;
    const items = deps.getSoundboardItems();
    const item = items.find((i) => i.uuid === uuid);
    const loop = item?.loop === true;
    debug("playSound resolved loop", { uuid, itemLoop: item?.loop, resolved: loop, hasTokens: selected.length > 0 });
    const offsetMin = typeof item?.offsetMin === "number" ? item.offsetMin : 0;
    const offsetMax = typeof item?.offsetMax === "number" ? item.offsetMax : 1000;

    const boundDelay = () => computeDelay(offsetMin, offsetMax);

    if (selected.length > 0 && canvas?.ready) {
      const positional = getPositionalSettings(item);
      const selectedTokenUuids = selected.map((s) => s.uuid);

      if (loop) {
        const ambientDelay = boundDelay();
        if (ambientDelay > 0) await new Promise((resolve) => setTimeout(resolve, ambientDelay));
        await deps.createAmbientSoundsForTokens(sound.path, sound.uuid, selectedTokenUuids, loop, positional);
      } else {
        await deps.createPositionalOneShotSoundsForTokens({
          soundPath: sound.path,
          soundUuid: sound.uuid,
          tokenUuids: selectedTokenUuids,
          volume,
          positional,
          computeDelay: boundDelay,
        });
      }

      debug("Soundboard sound played (positional)", { uuid: sound.uuid, name: sound.name, tokenCount: selected.length, loop });
    } else {
      await deps.createSoundInstance({ soundPath: sound.path, soundUuid: sound.uuid, volume, loop, computeDelay: boundDelay });
      debug("Soundboard sound played", { uuid: sound.uuid, name: sound.name, path: sound.path });
    }

    void deps.persistActiveInstances();
  } catch (playError) {
    error("Failed to play soundboard sound.", { uuid, error: playError });
    ui.notifications?.warn(game.i18n.localize("SIMONE_GM_PANEL.Notifications.MissingSound"));
  }
}

/**
 * @typedef {object} RemoveSoundDeps
 * @property {Array} activeInstances
 * @property {Array} ambientSoundInstances
 * @property {Set<string>} rowStoppedAmbientUuids
 * @property {function(number): Promise<void>} stopInstance
 * @property {function(number): Promise<void>} stopAmbientInstance
 */

/**
 * Remove all instances for a given sound UUID (sound + ambient, with confirm dialog).
 * @param {RemoveSoundDeps} deps
 * @param {string} uuid
 */
export async function removeSoundByUuid(deps, uuid) {
  const normalizedUuid = typeof uuid === "string" ? uuid.trim() : "";
  if (!normalizedUuid) return;

  const matchingInstances = deps.activeInstances.filter((i) => i.soundUuid === normalizedUuid);
  const matchingAmbient = deps.ambientSoundInstances.filter((i) => i.soundUuid === normalizedUuid);
  const totalMatching = matchingInstances.length + matchingAmbient.length;

  if (totalMatching > 0) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      title: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.Title"),
      content: game.i18n.format("SIMONE_GM_PANEL.Soundboard.RemoveConfirm", { count: totalMatching }),
      yes: { label: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.Remove"), default: true },
      no: { label: game.i18n.localize("Cancel") },
      modal: true,
    });
    if (!confirmed) return;
  }

  for (const inst of matchingInstances) {
    await deps.stopInstance(inst.id);
  }
  for (const inst of matchingAmbient) {
    await deps.stopAmbientInstance(inst.id);
  }
  deps.rowStoppedAmbientUuids.delete(normalizedUuid);
}
