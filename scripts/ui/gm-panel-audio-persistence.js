/**
 * Pure helper functions extracted from GmPanelAudioController.
 *
 * - computeDelay: shared delay calculation used by playSound, restoreAfterLoad,
 *   and #createSoundInstance
 * - serializeActiveInstances: pure serialization of active/ambient instances
 *   for persistence to user flags
 */

/**
 * Compute a random delay in ms between offsetMin and offsetMax.
 * Returns 0 if both bounds are 0.
 *
 * @param {number} [offsetMin=0]
 * @param {number} [offsetMax=1000]
 * @returns {number} Delay in milliseconds
 */
export function computeDelay(offsetMin = 0, offsetMax = 1000) {
  const min = Math.min(offsetMin, offsetMax);
  const max = Math.max(offsetMin, offsetMax);
  if (min === 0 && max === 0) return 0;
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Serialize active instances for persistence in user flags.
 * Does not mutate state — returns a new array.
 *
 * @param {Array} activeInstances - Active sound instances
 * @param {Array} ambientSoundInstances - Active ambient sound instances
 * @returns {Array<{ soundUuid: string, type: string, tokenUuid?: string, loop?: boolean }>}
 */
export function serializeActiveInstances(activeInstances, ambientSoundInstances) {
  return [
    ...activeInstances.filter((inst) => inst.paused !== true).map((inst) => ({
      soundUuid: inst.soundUuid,
      type: "sound",
    })),
    ...ambientSoundInstances.map((inst) => ({
      soundUuid: inst.soundUuid,
      type: "ambient",
      tokenUuid: inst.tokenUuid,
      loop: inst.loop === true,
    })),
  ];
}
