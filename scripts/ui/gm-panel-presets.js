/**
 * Pre-configured positional audio presets for soundboard sounds.
 * Clicking a preset chip in the sound settings modal auto-fills the form fields.
 */
export const POSITIONAL_PRESETS = Object.freeze([
  { id: "squirrel",  radius: 10,  volume: 0.15, walls: true,  easing: true,  elevation: 0 },
  { id: "zombie",    radius: 80,  volume: 0.85, walls: true,  easing: true,  elevation: 0 },
  { id: "tavern",    radius: 150, volume: 0.75, walls: true,  easing: true,  elevation: 0 },
  { id: "dragon",    radius: 400, volume: 0.95, walls: false, easing: false, elevation: 0 },
  { id: "alarm",     radius: 600, volume: 0.90, walls: false, easing: false, elevation: 30 },
]);

/**
 * Full group behavior presets for the group settings modal.
 * Each preset covers mode, repeat, delay, volumeMode, and positional.
 */
export const GROUP_PRESETS = Object.freeze([
  {
    id: "sequential-ambient",
    mode: "sequential",
    avoidImmediateRepeat: true,
    repeat: true,
    offsetMin: 3000,
    offsetMax: 8000,
    volumeMode: "item",
    positional: { radius: 80, volume: 0.5, walls: true, easing: true, elevation: 0 },
  },
  {
    id: "random-sfx",
    mode: "random",
    avoidImmediateRepeat: true,
    repeat: true,
    offsetMin: 500,
    offsetMax: 3000,
    volumeMode: "item",
    positional: {},
  },
  {
    id: "combat-loop",
    mode: "sequential",
    avoidImmediateRepeat: false,
    repeat: true,
    offsetMin: 200,
    offsetMax: 1000,
    volumeMode: "group",
    positional: { radius: 60, volume: 0.8, walls: true, easing: true, elevation: 0 },
  },
  {
    id: "sparse-atmosphere",
    mode: "random",
    avoidImmediateRepeat: true,
    repeat: true,
    offsetMin: 8000,
    offsetMax: 20000,
    volumeMode: "item",
    positional: { radius: 200, volume: 0.3, walls: false, easing: true, elevation: 0 },
  },
  {
    id: "zombie",
    mode: "random",
    avoidImmediateRepeat: true,
    repeat: true,
    offsetMin: 6000,
    offsetMax: 16000,
    volumeMode: "group",
    positional: { radius: 60, volume: 0.3, walls: true, easing: true, elevation: 0 },
  },
  {
    id: "goblin",
    mode: "random",
    avoidImmediateRepeat: true,
    repeat: true,
    offsetMin: 1200,
    offsetMax: 4500,
    volumeMode: "item",
    positional: { radius: 60, volume: 0.55, walls: true, easing: true, elevation: 0 },
  },
]);
