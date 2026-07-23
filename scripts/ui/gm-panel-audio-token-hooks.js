import { MODULE_ID } from "../constants.js";
import { getSoundboardItems } from "../settings.js";
import { getTokenUpdateCenter } from "./gm-panel-audio-token-utils.js";

// -- Token hook logic -------------------------------------------------

/**
 * Handle token position update: move AmbientSound documents that are
 * flagged for this token (both tracked in-memory and orphaned on canvas).
 */
export async function handleAudioTokenUpdate(tokenDoc, change, options, userId, {
  ambientInstances, getPositionalSettings, forceAmbientRefresh, adoptAmbientDoc,
}) {
  if (userId !== game.userId) return;
  if (change.x === undefined && change.y === undefined && change.elevation === undefined) return;

  const center = getTokenUpdateCenter(tokenDoc, change);

  const updatedIds = new Set();
  const items = getSoundboardItems();

  // Tracked in-memory
  for (const inst of ambientInstances) {
    if (inst.tokenUuid !== tokenDoc.uuid) continue;
    const doc = canvas.scene?.sounds?.get(inst.ambientSoundId);
    const isOwned = doc?.getFlag?.(MODULE_ID, "instanceType") === "soundboard-positional"
      && doc.getFlag(MODULE_ID, "soundUuid") === inst.soundUuid
      && doc.getFlag(MODULE_ID, "tokenUuid") === inst.tokenUuid;
    if (!isOwned || updatedIds.has(doc.id)) continue;
    const item = items.find((i) => i.uuid === inst.soundUuid);
    const positional = getPositionalSettings(item);
    await doc.update({
      x: center.x,
      y: center.y,
      elevation: center.elevation + positional.elevation,
    });
    forceAmbientRefresh(doc);
    updatedIds.add(doc.id);
  }

  // Flagged orphans on scene
  const flagged = canvas.scene?.sounds?.filter((doc) =>
    doc.getFlag?.(MODULE_ID, "instanceType") === "soundboard-positional"
    && doc.getFlag?.(MODULE_ID, "tokenUuid") === tokenDoc.uuid) ?? [];
  for (const doc of flagged) {
    if (updatedIds.has(doc.id)) continue;
    const soundUuid = doc.getFlag(MODULE_ID, "soundUuid");
    if (!soundUuid) continue;
    const item = items.find((i) => i.uuid === soundUuid);
    const positional = getPositionalSettings(item);
    await doc.update({
      x: center.x,
      y: center.y,
      elevation: center.elevation + positional.elevation,
    });
    forceAmbientRefresh(doc);
    adoptAmbientDoc(doc, soundUuid, tokenDoc.uuid, doc.path, doc.repeat === true);
    updatedIds.add(doc.id);
  }
}

/**
 * Handle token deletion: delete flagged AmbientSound documents and
 * remove tracked instances.
 */
export async function handleAudioTokenDelete(tokenDoc, options, userId, {
  ambientInstances, removeAmbientInstance, persist,
}) {
  const tracked = ambientInstances.filter((inst) => inst.tokenUuid === tokenDoc.uuid);
  const flagged = canvas.scene?.sounds?.filter((doc) =>
    doc.getFlag?.(MODULE_ID, "instanceType") === "soundboard-positional"
    && doc.getFlag(MODULE_ID, "tokenUuid") === tokenDoc.uuid) ?? [];

  const deletedIds = new Set();
  for (const doc of flagged) {
    if (!deletedIds.has(doc.id)
      && doc.getFlag?.(MODULE_ID, "instanceType") === "soundboard-positional"
      && doc.getFlag(MODULE_ID, "tokenUuid") === tokenDoc.uuid) {
      await doc.delete();
      deletedIds.add(doc.id);
    }
  }
  for (const inst of tracked) {
    removeAmbientInstance(inst.id);
  }

  if (tracked.length || flagged.length) {
    void persist();
  }
}
