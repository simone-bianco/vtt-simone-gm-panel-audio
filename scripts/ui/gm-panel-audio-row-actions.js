import { debug } from "../debug.js";

// -- Row-level mass actions -------------------------------------------

/**
 * Pause all active instances for a given sound UUID.
 * Sound instances are paused (kept in array). Ambient instances are
 * stopped from canvas but their token data is saved for resume.
 *
 * All state access flows through callbacks.
 */
export async function pauseAllForUuid(uuid, {
  activeInstances,
  ambientInstances,
  rowStoppedInstanceIds,
  pauseInstance,
  pauseAmbientInstance,
  persist,
}) {
  const instances = activeInstances.filter((i) => i.soundUuid === uuid && !i.paused);
  const ambient = ambientInstances.filter((i) => i.soundUuid === uuid);

  if (!instances.length && !ambient.length) return;

  const existing = rowStoppedInstanceIds.get(uuid);
  const ids = existing instanceof Set ? new Set(existing) : new Set();
  for (const inst of instances) {
    await pauseInstance(inst.id);
    ids.add(inst.id);
  }
  for (const inst of ambient) {
    await pauseAmbientInstance(inst.id);
    ids.add(`ambient:${inst.id}`);
  }

  rowStoppedInstanceIds.set(uuid, ids);
  debug("Row pause-all", { uuid, count: ids.size });
  void persist();
}

/**
 * Resume all paused instances for a given sound UUID.
 * Sound instances are unpaused. Ambient instances are re-created from saved data.
 */
export async function resumeAllForUuid(uuid, {
  activeInstances,
  rowStoppedInstanceIds,
  pauseInstance,
  resumeAmbientInstance,
  persist,
}) {
  const ids = rowStoppedInstanceIds.get(uuid);
  if (!ids || ids.size === 0) return;

  const idsSnapshot = [...ids];
  let resumedCount = 0;
  for (const id of idsSnapshot) {
    if (typeof id === "string" && id.startsWith("ambient:")) {
      const ambientId = Number(id.slice("ambient:".length));
      if (Number.isFinite(ambientId)) {
        await resumeAmbientInstance(ambientId);
        resumedCount++;
      }
      ids.delete(id);
      continue;
    }
    const inst = activeInstances.find((i) => i.id === id);
    if (inst && inst.paused) {
      await pauseInstance(id); // toggle back to unpaused
      resumedCount++;
    }
    ids.delete(id);
  }

  if (ids.size === 0) rowStoppedInstanceIds.delete(uuid);
  if (resumedCount > 0) {
    debug("Row resume-all", { uuid, count: resumedCount });
    void persist();
  }
}

/**
 * Permanently remove ALL instances (sound + ambient) for a given sound UUID.
 * Requires explicit user confirmation via DialogV2.
 */
export async function removeAllForUuid(uuid, {
  activeInstances,
  ambientInstances,
  rowStoppedInstanceIds,
  rowStoppedAmbientUuids,
  stopInstance,
  stopAmbientInstance,
}) {
  const instances = activeInstances.filter((i) => i.soundUuid === uuid);
  const ambient = ambientInstances.filter((i) => i.soundUuid === uuid);
  const totalCount = instances.length + ambient.length;

  const trackedIds = rowStoppedInstanceIds.get(uuid);
  const extraPaused = trackedIds?.size ?? 0;
  const totalWithPaused = totalCount + extraPaused;

  if (!totalWithPaused) return;

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    title: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.Title"),
    content: game.i18n.format("SIMONE_GM_PANEL.Soundboard.RemoveAllModalConfirm", { count: totalWithPaused }),
    yes: { label: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.RemoveAllModal"), default: true },
    no: { label: game.i18n.localize("Cancel") },
    modal: true,
  });
  if (!confirmed) return;

  let count = 0;
  for (const inst of [...instances]) {
    await stopInstance(inst.id);
    count++;
  }
  for (const inst of [...ambient]) {
    await stopAmbientInstance(inst.id);
    count++;
  }
  rowStoppedInstanceIds.delete(uuid);
  rowStoppedAmbientUuids.delete(uuid);

  debug("Row remove-all", { uuid, count });
}
