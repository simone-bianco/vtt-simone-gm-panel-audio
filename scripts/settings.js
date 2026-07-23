import {
  ACTIVE_INSTANCES_FLAG,
  CURRENT_PLAYLIST_FLAG,
  LEGACY_MODULE_ID,
  LEGACY_PANEL_STATE_FLAG,
  MIGRATION_VERSION,
  MODULE_ID,
  SETTINGS,
  SOUNDBOARD_STATE_FLAG,
  USER_MIGRATION_FLAG,
} from "./constants.js";
import {
  buildDefaultLayout,
  normalizeSoundboardItemV2,
  normalizeSoundboardState,
  toLegacyItems,
} from "./ui/gm-panel-soundboard-state.js";

const SETTING_DEFINITIONS = {
  [SETTINGS.SAVED_PLAYLISTS]: { scope: "world", config: false, type: Object, default: {} },
  [SETTINGS.POSITIONAL_RADIUS]: {
    name: "SIMONE_GM_PANEL.Settings.PositionalRadius.Name",
    hint: "SIMONE_GM_PANEL.Settings.PositionalRadius.Hint",
    scope: "world", config: true, type: Number, default: 60,
  },
  [SETTINGS.POSITIONAL_VOLUME]: {
    name: "SIMONE_GM_PANEL.Settings.PositionalVolume.Name",
    hint: "SIMONE_GM_PANEL.Settings.PositionalVolume.Hint",
    scope: "world", config: true, type: Number, default: 0.5,
    range: { min: 0, max: 1, step: 0.05 },
  },
  [SETTINGS.POSITIONAL_WALLS]: {
    name: "SIMONE_GM_PANEL.Settings.PositionalWalls.Name",
    hint: "SIMONE_GM_PANEL.Settings.PositionalWalls.Hint",
    scope: "world", config: true, type: Boolean, default: true,
  },
  [SETTINGS.POSITIONAL_EASING]: {
    name: "SIMONE_GM_PANEL.Settings.PositionalEasing.Name",
    hint: "SIMONE_GM_PANEL.Settings.PositionalEasing.Hint",
    scope: "world", config: true, type: Boolean, default: true,
  },
  [SETTINGS.POSITIONAL_ELEVATION]: {
    name: "SIMONE_GM_PANEL.Settings.PositionalElevation.Name",
    hint: "SIMONE_GM_PANEL.Settings.PositionalElevation.Hint",
    scope: "world", config: true, type: Number, default: 0,
  },
  [SETTINGS.WORLD_MIGRATION]: { scope: "world", config: false, type: Number, default: 0 },
  [SETTINGS.AMBIENT_OWNERSHIP_MIGRATION]: { scope: "world", config: false, type: Number, default: 0 },
};

export function registerSettings() {
  for (const [key, definition] of Object.entries(SETTING_DEFINITIONS)) {
    game.settings.register(MODULE_ID, key, definition);
  }
}

export async function migrateSoundsData() {
  await migrateUserData();
  if (game.user?.isGM) await migrateWorldSettings();
}

async function migrateUserData() {
  const user = game.user;
  if (!user) return;
  if (Number(user.getFlag(MODULE_ID, USER_MIGRATION_FLAG)) >= MIGRATION_VERSION) return;

  const legacyState = user.getFlag(LEGACY_MODULE_ID, LEGACY_PANEL_STATE_FLAG);
  if (user.getFlag(MODULE_ID, SOUNDBOARD_STATE_FLAG) === undefined) {
    const normalized = normalizeSoundboardState(
      legacyState && typeof legacyState === "object" ? legacyState : {},
    );
    await user.setFlag(MODULE_ID, SOUNDBOARD_STATE_FLAG, normalized);
  }

  if (user.getFlag(MODULE_ID, CURRENT_PLAYLIST_FLAG) === undefined) {
    const legacyPlaylist = user.getFlag(LEGACY_MODULE_ID, CURRENT_PLAYLIST_FLAG);
    await user.setFlag(MODULE_ID, CURRENT_PLAYLIST_FLAG,
      legacyPlaylist && typeof legacyPlaylist === "object" ? structuredClone(legacyPlaylist) : null);
  }

  if (user.getFlag(MODULE_ID, ACTIVE_INSTANCES_FLAG) === undefined) {
    const legacyInstances = user.getFlag(LEGACY_MODULE_ID, ACTIVE_INSTANCES_FLAG);
    await user.setFlag(MODULE_ID, ACTIVE_INSTANCES_FLAG,
      Array.isArray(legacyInstances) ? structuredClone(legacyInstances) : []);
  }

  await user.setFlag(MODULE_ID, USER_MIGRATION_FLAG, MIGRATION_VERSION);
}

async function migrateWorldSettings() {
  if (Number(game.settings.get(MODULE_ID, SETTINGS.WORLD_MIGRATION)) >= MIGRATION_VERSION) return;

  const ownedKeys = [
    SETTINGS.SAVED_PLAYLISTS,
    SETTINGS.POSITIONAL_RADIUS,
    SETTINGS.POSITIONAL_VOLUME,
    SETTINGS.POSITIONAL_WALLS,
    SETTINGS.POSITIONAL_EASING,
    SETTINGS.POSITIONAL_ELEVATION,
  ];

  for (const key of ownedKeys) {
    if (hasPersistedSetting("world", MODULE_ID, key)) continue;
    const legacy = readPersistedSetting("world", LEGACY_MODULE_ID, key);
    const fallback = SETTING_DEFINITIONS[key].default;
    await game.settings.set(MODULE_ID, key, normalizeWorldSetting(key, legacy.exists ? legacy.value : fallback));
  }

  await game.settings.set(MODULE_ID, SETTINGS.WORLD_MIGRATION, MIGRATION_VERSION);
}

export function getPositionalRadius() {
  return clampNumber(game.settings.get(MODULE_ID, SETTINGS.POSITIONAL_RADIUS), 60, 0, 999999);
}
export async function setPositionalRadius(value) {
  return game.settings.set(MODULE_ID, SETTINGS.POSITIONAL_RADIUS, clampNumber(value, 60, 0, 999999));
}
export function getPositionalVolume() {
  return clampNumber(game.settings.get(MODULE_ID, SETTINGS.POSITIONAL_VOLUME), 0.5, 0, 1);
}
export async function setPositionalVolume(value) {
  return game.settings.set(MODULE_ID, SETTINGS.POSITIONAL_VOLUME, clampNumber(value, 0.5, 0, 1));
}
export function getPositionalWalls() {
  return game.settings.get(MODULE_ID, SETTINGS.POSITIONAL_WALLS) !== false;
}
export async function setPositionalWalls(value) {
  return game.settings.set(MODULE_ID, SETTINGS.POSITIONAL_WALLS, value !== false);
}
export function getPositionalEasing() {
  return game.settings.get(MODULE_ID, SETTINGS.POSITIONAL_EASING) !== false;
}
export async function setPositionalEasing(value) {
  return game.settings.set(MODULE_ID, SETTINGS.POSITIONAL_EASING, value !== false);
}
export function getPositionalElevation() {
  return clampNumber(game.settings.get(MODULE_ID, SETTINGS.POSITIONAL_ELEVATION), 0, -999999, 999999);
}
export async function setPositionalElevation(value) {
  return game.settings.set(MODULE_ID, SETTINGS.POSITIONAL_ELEVATION, clampNumber(value, 0, -999999, 999999));
}

export function getSavedPlaylists() {
  const value = game.settings.get(MODULE_ID, SETTINGS.SAVED_PLAYLISTS);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
export async function setSavedPlaylists(playlists) {
  const value = playlists && typeof playlists === "object" && !Array.isArray(playlists) ? playlists : {};
  return game.settings.set(MODULE_ID, SETTINGS.SAVED_PLAYLISTS, value);
}

export function getSoundboardState() {
  return normalizeSoundboardState(game.user?.getFlag(MODULE_ID, SOUNDBOARD_STATE_FLAG));
}

export async function setSoundboardState(nextState) {
  const merged = {
    ...getSoundboardState(),
    ...(nextState && typeof nextState === "object" ? nextState : {}),
  };
  return game.user?.setFlag(MODULE_ID, SOUNDBOARD_STATE_FLAG, normalizeSoundboardState(merged));
}

export function getSoundboardItems() {
  return toLegacyItems(getSoundboardState());
}

export async function setSoundboardItems(items) {
  const current = getSoundboardState();
  const normalized = (Array.isArray(items) ? items : []).map(normalizeSoundboardItemV2);
  const deduped = [];
  const seen = new Set();
  for (const item of normalized) {
    if (!item.uuid || seen.has(item.uuid)) continue;
    seen.add(item.uuid);
    deduped.push(item);
  }
  return setSoundboardState({
    ...current,
    items: deduped,
    layout: buildDefaultLayout(deduped, current.groups),
  });
}

function normalizeWorldSetting(key, value) {
  switch (key) {
    case SETTINGS.SAVED_PLAYLISTS:
      return value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value) : {};
    case SETTINGS.POSITIONAL_RADIUS:
      return clampNumber(value, 60, 0, 999999);
    case SETTINGS.POSITIONAL_VOLUME:
      return clampNumber(value, 0.5, 0, 1);
    case SETTINGS.POSITIONAL_WALLS:
    case SETTINGS.POSITIONAL_EASING:
      return value !== false;
    case SETTINGS.POSITIONAL_ELEVATION:
      return clampNumber(value, 0, -999999, 999999);
    default:
      return value;
  }
}

function hasPersistedSetting(scope, moduleId, key) {
  return readPersistedSetting(scope, moduleId, key).exists;
}

function readPersistedSetting(scope, moduleId, key) {
  const storage = game.settings.storage.get(scope);
  const fullKey = `${moduleId}.${key}`;
  if (!storage) return { exists: false, value: undefined };
  if (scope === "client" && typeof storage.getItem === "function") {
    const entry = storage.getItem(fullKey);
    return entry === null
      ? { exists: false, value: undefined }
      : { exists: true, value: decodeStoredValue(entry) };
  }
  if (typeof storage.getSetting === "function") {
    const entry = storage.getSetting(fullKey);
    return entry === undefined
      ? { exists: false, value: undefined }
      : { exists: true, value: decodeStoredValue(entry?.value) };
  }
  return { exists: false, value: undefined };
}

function decodeStoredValue(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}
