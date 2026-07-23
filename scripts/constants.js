export const MODULE_ID = "simone-gm-panel-sounds";
export const CORE_MODULE_ID = "simone-gm-panel";
export const LEGACY_MODULE_ID = "simone-gm-panel";
export const FEATURE_API_VERSION = 1;
export const MIGRATION_VERSION = 1;

export const SOUNDBOARD_STATE_FLAG = "soundboardState";
export const ACTIVE_INSTANCES_FLAG = "activeInstances";
export const CURRENT_PLAYLIST_FLAG = "currentPlaylist";
export const USER_MIGRATION_FLAG = "migrationUserVersion";
export const LEGACY_PANEL_STATE_FLAG = "panelState";

export const SETTINGS = {
  SAVED_PLAYLISTS: "savedPlaylists",
  POSITIONAL_RADIUS: "positionalRadius",
  POSITIONAL_VOLUME: "positionalVolume",
  POSITIONAL_WALLS: "positionalWalls",
  POSITIONAL_EASING: "positionalEasing",
  POSITIONAL_ELEVATION: "positionalElevation",
  WORLD_MIGRATION: "migrationWorldVersion",
  AMBIENT_OWNERSHIP_MIGRATION: "ambientOwnershipMigrationVersion",
};

export const KNOWN_AMBIENT_INSTANCE_TYPES = new Set([
  "soundboard-positional",
  "soundboard-group-positional",
  "soundboard-map-drop",
]);
