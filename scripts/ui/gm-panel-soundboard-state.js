/**
 * Soundboard State V2 — normalize / build / migrate.
 *
 * Replaces the legacy settings.js shim with a real items/groups/layout data model.
 * All normalization is pure (no side effects). Persistence stays in settings.js.
 */

/**
 * Generate a stable id for a soundboard item.
 * Legacy items without an id get one derived from their uuid.
 * @param {object} item
 * @returns {string}
 */
function ensureItemId(item) {
  if (typeof item?.id === "string" && item.id.length > 0) return item.id;
  const uuid = typeof item?.uuid === "string" ? item.uuid.trim() : "";
  if (uuid) return uuid.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `item_${foundry.utils.randomID()}`;
}

/**
 * Normalize a single V2 soundboard item.
 * Preserves backward compatibility with legacy uuid-only items.
 *
 * @param {object} item
 * @returns {{ id: string, uuid: string, loop: boolean, offsetMin: number, offsetMax: number, positional: object }}
 */
export function normalizeSoundboardItemV2(item) {
  if (!item || typeof item !== "object") {
    return { id: `item_${foundry.utils.randomID()}`, uuid: "", loop: false, offsetMin: 0, offsetMax: 1000, positional: {} };
  }

  const uuid = typeof item.uuid === "string" ? item.uuid.trim() : "";
  const positional = item.positional && typeof item.positional === "object"
    ? {
        radius: typeof item.positional.radius === "number" && item.positional.radius >= 0 ? item.positional.radius : undefined,
        volume: typeof item.positional.volume === "number" ? Math.max(0, Math.min(1, item.positional.volume)) : undefined,
        walls: item.positional.walls === true ? true : item.positional.walls === false ? false : undefined,
        easing: item.positional.easing === true ? true : item.positional.easing === false ? false : undefined,
        elevation: typeof item.positional.elevation === "number" ? item.positional.elevation : undefined,
      }
    : {};

  return {
    id: ensureItemId(item),
    uuid,
    loop: item.loop === true,
    offsetMin: typeof item.offsetMin === "number" && item.offsetMin >= 0 ? Math.round(item.offsetMin) : 0,
    offsetMax: typeof item.offsetMax === "number" && item.offsetMax >= 0 ? Math.round(item.offsetMax) : 1000,
    positional: Object.fromEntries(Object.entries(positional).filter(([, value]) => value !== undefined)),
  };
}

/**
 * Normalize a single group with safe defaults.
 *
 * @param {object} group
 * @returns {{ id: string, name: string, itemIds: string[], mode: string, avoidImmediateRepeat: boolean, repeat: boolean, offsetMin: number, offsetMax: number, perTokenDesync: boolean, volumeMode: string, positional: object, expanded: boolean }}
 */
export function normalizeSoundboardGroup(group) {
  if (!group || typeof group !== "object") {
    return {
      id: `group_${foundry.utils.randomID()}`,
      name: "Group",
      itemIds: [],
      mode: "sequential",
      avoidImmediateRepeat: true,
      repeat: true,
      offsetMin: 1000,
      offsetMax: 4000,
      perTokenDesync: false,
      volumeMode: "item",
      positional: {},
      expanded: true,
    };
  }

  return {
    id: typeof group.id === "string" && group.id.length > 0 ? group.id : `group_${foundry.utils.randomID()}`,
    name: typeof group.name === "string" && group.name.trim().length > 0 ? group.name.trim() : "Group",
    itemIds: Array.isArray(group.itemIds) ? group.itemIds.filter((id) => typeof id === "string" && id.length > 0) : [],
    mode: group.mode === "random" ? "random" : "sequential",
    avoidImmediateRepeat: group.avoidImmediateRepeat !== false,
    repeat: group.repeat !== false,
    offsetMin: typeof group.offsetMin === "number" && group.offsetMin >= 0 ? Math.round(group.offsetMin) : 1000,
    offsetMax: typeof group.offsetMax === "number" && group.offsetMax >= 0 ? Math.round(group.offsetMax) : 4000,
    perTokenDesync: group.perTokenDesync === true,
    volumeMode: group.volumeMode === "group" ? "group" : "item",
    positional: group.positional && typeof group.positional === "object" ? group.positional : {},
    expanded: group.expanded !== false,
  };
}

/**
 * Build a default layout from items and groups arrays.
 * Items appear in array order, groups appended at the end.
 *
 * @param {Array<object>} items
 * @param {Array<object>} groups
 * @returns {Array<{ type: "item"|"group", id: string }>}
 */
export function buildDefaultLayout(items, groups) {
  const layout = [];
  if (Array.isArray(items)) {
    for (const item of items) {
      if (item?.id) layout.push({ type: "item", id: item.id });
    }
  }
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (group?.id) layout.push({ type: "group", id: group.id });
    }
  }
  return layout;
}

/**
 * Normalize the full soundboard state to V2 format.
 * Handles migration from legacy soundboardItems if items/groups/layout are missing.
 *
 * @param {object} rawState — Raw panel state from getPanelState()
 * @returns {{ items: Array, groups: Array, layout: Array }}
 */
export function normalizeSoundboardState(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return { items: [], groups: [], layout: [] };
  }

  // V2 path: state already has items/groups/layout
  if (Array.isArray(rawState.items) || Array.isArray(rawState.groups) || Array.isArray(rawState.layout)) {
    const items = (Array.isArray(rawState.items) ? rawState.items : []).map(normalizeSoundboardItemV2);
    const groups = (Array.isArray(rawState.groups) ? rawState.groups : []).map(normalizeSoundboardGroup);
    const layout = Array.isArray(rawState.layout)
      ? rawState.layout.filter((r) => r && typeof r.type === "string" && typeof r.id === "string")
      : buildDefaultLayout(items, groups);

    // Validate layout references existing items/groups
    const itemIds = new Set(items.map((i) => i.id));
    const groupIds = new Set(groups.map((g) => g.id));
    const validLayout = layout.filter((r) =>
      (r.type === "item" && itemIds.has(r.id)) || (r.type === "group" && groupIds.has(r.id)),
    );

    return { items, groups, layout: validLayout };
  }

  // Legacy migration: only soundboardItems exists
  if (Array.isArray(rawState.soundboardItems)) {
    const items = rawState.soundboardItems.map(normalizeSoundboardItemV2).filter((i) => i.uuid);
    const deduped = [];
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      deduped.push(item);
    }
    return { items: deduped, groups: [], layout: buildDefaultLayout(deduped, []) };
  }

  return { items: [], groups: [], layout: [] };
}

/**
 * Extract legacy-compatible items array from V2 state.
 * Strips the id field that legacy consumers don't expect.
 *
 * @param {{ items: Array }} state — V2 state
 * @returns {Array<{ uuid: string, loop: boolean, offsetMin: number, offsetMax: number, positional: object }>}
 */
export function toLegacyItems(state) {
  if (!Array.isArray(state?.items)) return [];
  return state.items.map(({ id: _id, ...rest }) => rest);
}
