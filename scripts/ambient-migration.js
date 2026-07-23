import {
  KNOWN_AMBIENT_INSTANCE_TYPES,
  LEGACY_MODULE_ID,
  MIGRATION_VERSION,
  MODULE_ID,
  SETTINGS,
} from "./constants.js";
import { debug } from "./debug.js";

export async function adoptLegacyAmbientSoundFlags() {
  if (!game.user?.isGM) return;
  if (Number(game.settings.get(MODULE_ID, SETTINGS.AMBIENT_OWNERSHIP_MIGRATION)) >= MIGRATION_VERSION) return;

  const candidates = [];
  const ambiguous = [];
  for (const scene of game.scenes ?? []) {
    for (const document of scene.sounds ?? []) {
      if (document.flags?.[MODULE_ID] !== undefined) continue;
      const legacy = document.flags?.[LEGACY_MODULE_ID];
      const instanceType = legacy?.instanceType;
      if (!legacy || typeof legacy !== "object" || !KNOWN_AMBIENT_INSTANCE_TYPES.has(instanceType)) continue;
      if (!isUnambiguousLegacyOwnership(legacy)) {
        ambiguous.push(`${scene.id}:${document.id}:${String(instanceType)}`);
        continue;
      }
      candidates.push({ scene, document });
    }
  }

  if (ambiguous.length) {
    throw new Error(
      `Ambiguous legacy AmbientSound ownership; no adoption performed: ${ambiguous.join(", ")}`,
    );
  }

  for (const { scene, document } of candidates) {
    if (document.flags?.[MODULE_ID] !== undefined) continue;
    const currentLegacy = document.flags?.[LEGACY_MODULE_ID];
    if (!currentLegacy || typeof currentLegacy !== "object"
      || !KNOWN_AMBIENT_INSTANCE_TYPES.has(currentLegacy.instanceType)
      || !isUnambiguousLegacyOwnership(currentLegacy)) {
      throw new Error(
        `Legacy AmbientSound ownership changed before adoption: ${scene.id}:${document.id}`,
      );
    }
    await document.update({ [`flags.${MODULE_ID}`]: structuredClone(currentLegacy) });
    debug("Adopted legacy AmbientSound ownership flag", {
      sceneId: scene.id,
      ambientSoundId: document.id,
      instanceType: currentLegacy.instanceType,
    });
  }

  await game.settings.set(MODULE_ID, SETTINGS.AMBIENT_OWNERSHIP_MIGRATION, MIGRATION_VERSION);
}

function isUnambiguousLegacyOwnership(flag) {
  const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
  const identifier = (value) => nonEmpty(value)
    || (typeof value === "number" && Number.isFinite(value));
  switch (flag.instanceType) {
    case "soundboard-positional":
      return nonEmpty(flag.soundUuid) && nonEmpty(flag.tokenUuid);
    case "soundboard-group-positional":
      return nonEmpty(flag.groupId)
        && identifier(flag.groupSessionId)
        && nonEmpty(flag.tokenUuid)
        && nonEmpty(flag.soundUuid);
    case "soundboard-map-drop":
      if (flag.dropType === "item") return nonEmpty(flag.itemId) || nonEmpty(flag.soundUuid);
      if (flag.dropType === "group") return nonEmpty(flag.groupId);
      return false;
    default:
      return false;
  }
}
