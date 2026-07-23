import { MODULE_ID } from "../constants.js";
import { debug, warn } from "../debug.js";
import { getTokenDocumentCenter } from "./gm-panel-audio-token-utils.js";

// -- Pure helpers -----------------------------------------------------

export function forceAmbientRefresh(doc) {
  if (!doc?.object?.renderFlags) return;
  doc.object.renderFlags.set({
    refreshPosition: true,
    refreshField: true,
    refreshElevation: true,
  });
}

// -- AmbientSound document helpers (flag-based) -----------------------

/**
 * Find all module-owned AmbientSound documents on the scene for a
 * given soundUuid+tokenUuid pair, matching by module flags.
 */
export function findFlaggedAmbientDocs(soundUuid, tokenUuid) {
  if (!canvas.scene?.sounds) return [];
  return canvas.scene.sounds.filter((doc) => isOwnedPositionalAmbient(doc, soundUuid, tokenUuid));
}

function isOwnedPositionalAmbient(doc, soundUuid, tokenUuid) {
  return doc?.getFlag?.(MODULE_ID, "instanceType") === "soundboard-positional"
    && doc.getFlag(MODULE_ID, "soundUuid") === soundUuid
    && doc.getFlag(MODULE_ID, "tokenUuid") === tokenUuid;
}

/**
 * Adopt an existing AmbientSound document into in-memory tracking.
 * All state mutation flows through callbacks.
 */
export function adoptAmbientDoc({
  doc, soundUuid, tokenUuid, soundPath, loop,
  ambientInstances, findAmbientInstance, nextInstanceId, pushAmbientInstance,
}) {
  const existing = findAmbientInstance(doc.id);
  if (existing) return existing;
  const inst = {
    id: nextInstanceId(),
    ambientSoundId: doc.id,
    soundUuid,
    soundPath,
    tokenUuid,
    loop: loop === true,
    paused: false,
  };
  pushAmbientInstance(inst);
  return inst;
}

/**
 * Delete duplicate module-owned AmbientSound documents for the same
 * soundUuid+tokenUuid pair, keeping only the first one found.
 * Returns the kept document (or null if none exist).
 */
export async function dedupeFlaggedDocs({
  soundUuid, tokenUuid,
  ambientInstances, findAmbientInstance, removeAmbientInstanceByDocId,
}) {
  const docs = findFlaggedAmbientDocs(soundUuid, tokenUuid);
  if (docs.length <= 1) return docs[0] ?? null;
  warn("GM Panel: deduplicating AmbientSound docs", { soundUuid, tokenUuid, count: docs.length });
  let kept = docs.find((d) => ambientInstances.some((inst) => inst.ambientSoundId === d.id))
    ?? docs[0];
  for (const doc of docs) {
    if (doc.id === kept.id || !isOwnedPositionalAmbient(doc, soundUuid, tokenUuid)) continue;
    await doc.delete();
    removeAmbientInstanceByDocId(doc.id);
  }
  return kept;
}

/**
 * Create or update AmbientSound documents for one or more tokens.
 * All state mutation flows through callbacks.
 */
export async function createAmbientSoundsForTokens({
  soundPath, soundUuid, tokenUuids, loop, positional,
  getPositionalSettings,
  dedupeFlagged, adoptAmbient, forceRefresh,
}) {
  if (!soundPath || !canvas?.ready || !canvas.scene || !Array.isArray(tokenUuids) || !tokenUuids.length) return [];
  const createdInstances = [];
  for (const tokenUuid of tokenUuids) {
    const tokenDoc = await foundry.utils.fromUuid(tokenUuid);
    if (!tokenDoc) continue;

    let existingDoc = await dedupeFlagged(soundUuid, tokenUuid);

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
      repeat: loop,
      path: soundPath,
      flags: { [MODULE_ID]: { soundUuid, tokenUuid, instanceType: "soundboard-positional" } },
    };

    if (existingDoc && isOwnedPositionalAmbient(existingDoc, soundUuid, tokenUuid)) {
      await existingDoc.update(ambientData);
      forceRefresh(existingDoc);
      adoptAmbient(existingDoc, soundUuid, tokenUuid, soundPath, loop);
      createdInstances.push(existingDoc);
    } else {
      const [createdDoc] = await canvas.scene.createEmbeddedDocuments("AmbientSound", [ambientData]);
      adoptAmbient(createdDoc, soundUuid, tokenUuid, soundPath, loop);
      createdInstances.push(createdDoc);
    }
  }
  return createdInstances;
}

// -- Ambient instance controls (runtime) -------------------------------

/**
 * Fully stop and remove an ambient sound instance.
 * Deletes the AmbientSound document from canvas and removes tracking.
 */
export async function stopAmbientInstance(instanceId, {
  ambientInstances, removeAmbientInstance, persist,
}) {
  const index = ambientInstances.findIndex((inst) => inst.id === instanceId);
  if (index === -1) return false;
  const inst = ambientInstances[index];
  const doc = canvas.scene?.sounds?.get(inst.ambientSoundId);
  if (isOwnedPositionalAmbient(doc, inst.soundUuid, inst.tokenUuid)) await doc.delete();
  removeAmbientInstance(instanceId);
  void persist();
  return true;
}

/**
 * Pause an ambient sound instance by hiding its document.
 */
export async function pauseAmbientInstance(instanceId, {
  ambientInstances, persist,
}) {
  const inst = ambientInstances.find((candidate) => candidate.id === instanceId);
  if (!inst) {
    debug("pauseAmbientInstance not found", { instanceId });
    return false;
  }
  const doc = canvas.scene?.sounds?.get(inst.ambientSoundId);
  if (!isOwnedPositionalAmbient(doc, inst.soundUuid, inst.tokenUuid)) {
    debug("pauseAmbientInstance missing owned AmbientSound document", { instanceId, ambientSoundId: inst.ambientSoundId });
    return false;
  }
  await doc.update({ hidden: true });
  inst.paused = true;
  debug("pauseAmbientInstance paused", { instanceId, ambientSoundId: inst.ambientSoundId });
  void persist();
  return true;
}

/**
 * Resume an ambient sound instance by un-hiding its document.
 */
export async function resumeAmbientInstance(instanceId, {
  ambientInstances, persist,
}) {
  const inst = ambientInstances.find((candidate) => candidate.id === instanceId);
  if (!inst) return false;
  const doc = canvas.scene?.sounds?.get(inst.ambientSoundId);
  if (!isOwnedPositionalAmbient(doc, inst.soundUuid, inst.tokenUuid)) return false;
  await doc.update({ hidden: false });
  inst.paused = false;
  debug("resumeAmbientInstance resumed", { instanceId, ambientSoundId: inst.ambientSoundId });
  void persist();
  return true;
}
