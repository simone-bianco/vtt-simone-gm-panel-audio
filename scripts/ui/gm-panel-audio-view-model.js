import { debug, error } from "../debug.js";

/**
 * Build soundboard entries (view models) for the Handlebars template.
 *
 * Extracted from GmPanelAudioController.getEntries to reduce controller size.
 * All state is passed as explicit parameters — no private fields accessed.
 *
 * @param {object} params
 * @param {Array} params.items - Soundboard items from settings
 * @param {string} params.searchQuery - Current search query
 * @param {(s: string) => string} params.normalizeSearchText - Search text normalizer
 * @param {(uuid: string) => Promise<object|null>} params.resolvePlaylistSoundByUuid
 * @param {Set<string>} params.expandedRows - Set of expanded row UUIDs
 * @param {Array} params.activeInstances - Active sound instances
 * @param {Array} params.ambientSoundInstances - Active ambient sound instances
 * @param {Map<string, Set>} params.rowStoppedInstanceIds - Row-level stopped instance tracking
 * @param {Map<string, Array>} params.rowStoppedAmbientUuids - Row-level stopped ambient tracking
 * @returns {Promise<Array>} Resolved entries
 */
export async function getEntries({
  items,
  searchQuery,
  normalizeSearchText,
  resolvePlaylistSoundByUuid,
  expandedRows,
  activeInstances,
  ambientSoundInstances,
  rowStoppedInstanceIds,
  rowStoppedAmbientUuids,
}) {
  try {
    const resolvedEntries = await Promise.all(items.map(async (item, index) => {
      const uuid = item.uuid;
      try {
        const sound = await resolvePlaylistSoundByUuid(uuid);
        const expanded = expandedRows.has(uuid);
        const soundInstances = activeInstances.filter((i) => i.soundUuid === uuid);
        const ambientInsts = ambientSoundInstances.filter((i) => i.soundUuid === uuid);

        let instanceRows = [];
        if (expanded) {
          instanceRows = [
            ...soundInstances.map((inst) => ({ id: inst.id, type: inst.type || "sound", loop: inst.loop, paused: inst.paused })),
            ...(await Promise.all(ambientInsts.map(async (inst) => {
              const tokenDoc = await foundry.utils.fromUuid(inst.tokenUuid);
              return { id: inst.id, type: "ambient", loop: inst.loop, paused: inst.paused === true, tokenName: tokenDoc?.name ?? "", tokenUuid: inst.tokenUuid };
            }))),
          ];
        }

        return {
          uuid,
          index,
          available: Boolean(sound?.path),
          isPlaying: soundInstances.some((i) => !i.paused),
          activeInstanceCount: soundInstances.length + ambientInsts.length,
          hasPlayingInstances: soundInstances.some((i) => !i.paused) || ambientInsts.length > 0,
          rowHasStopped: (rowStoppedInstanceIds.get(uuid)?.size ?? 0) > 0 || (rowStoppedAmbientUuids.get(uuid)?.length ?? 0) > 0,
          hasExpandedContent: instanceRows.length > 0 || (rowStoppedInstanceIds.get(uuid)?.size ?? 0) > 0 || (rowStoppedAmbientUuids.get(uuid)?.length ?? 0) > 0,
          hasAmbientInstances: ambientInsts.length > 0,
          expanded,
          instances: instanceRows,
          name: sound?.name ?? game.i18n.localize("SIMONE_GM_PANEL.Soundboard.MissingLabel"),
          playlistName: sound?.parent?.name ?? "",
          subtitle: sound?.path ?? game.i18n.localize("SIMONE_GM_PANEL.Soundboard.MissingHint"),
          icon: sound?.path ? "fa-solid fa-waveform-lines" : "fa-solid fa-triangle-exclamation",
          loop: item.loop === true,
          offsetMin: item.offsetMin ?? 0,
          offsetMax: item.offsetMax ?? 1000,
        };
      } catch (entryError) {
        debug("Failed to resolve single soundboard entry", { uuid, error: entryError?.message ?? entryError });
        return {
          uuid, index, available: false, isPlaying: false, activeInstanceCount: 0,
          hasPlayingInstances: false, rowHasStopped: false, hasAmbientInstances: false,
          expanded: false, instances: [],
          name: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.MissingLabel"),
          playlistName: "", subtitle: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.MissingHint"),
          icon: "fa-solid fa-triangle-exclamation", loop: false, offsetMin: 0, offsetMax: 1000,
        };
      }
    }));

    const query = normalizeSearchText(searchQuery);
    if (!query) return resolvedEntries;

    return resolvedEntries.filter((entry) => {
      const haystack = normalizeSearchText(`${entry.name} ${entry.playlistName} ${entry.subtitle}`);
      return haystack.includes(query);
    });
  } catch (entriesError) {
    error("Failed to resolve soundboard entries", { error: entriesError });
    return [];
  }
}

/**
 * Build mixed item/group rows from V2 state layout.
 * Falls back to item-only rows if layout is empty (legacy compat).
 *
 * @param {object} params
 * @param {object} params.state - Full V2 state { items, groups, layout }
 * @param {string} params.searchQuery
 * @param {(s: string) => string} params.normalizeSearchText
 * @param {(uuid: string) => Promise<object|null>} params.resolvePlaylistSoundByUuid
 * @param {Set<string>} params.expandedRows
 * @param {Array} params.activeInstances
 * @param {Array} params.ambientSoundInstances
 * @param {Map<string, Set>} params.rowStoppedInstanceIds
 * @param {Map<string, Array>} params.rowStoppedAmbientUuids
 * @param {Map<string, Set>} params.expandedGroupIds - Expanded group IDs
 * @param {Map<string, number>} params.groupActiveCounts - Active instance counts per group
 * @param {Map<string, Array>} params.groupSessionsByGroupId - Session view models per group
 * @param {Set<string>} params.selectedItemIds - Selected item IDs for group creation
 * @returns {Promise<Array>}
 */
export async function getSoundboardRows({
  state,
  searchQuery,
  normalizeSearchText,
  resolvePlaylistSoundByUuid,
  expandedRows,
  activeInstances,
  ambientSoundInstances,
  rowStoppedInstanceIds,
  rowStoppedAmbientUuids,
  expandedGroupIds,
  groupActiveCounts,
  selectedItemIds,
  groupSessionsByGroupId,
}) {
  try {
    // Build item entries (reuse existing logic)
    const itemMap = new Map();
    const itemEntries = await getEntries({
      items: state.items,
      searchQuery: "",
      normalizeSearchText,
      resolvePlaylistSoundByUuid,
      expandedRows,
      activeInstances,
      ambientSoundInstances,
      rowStoppedInstanceIds,
      rowStoppedAmbientUuids,
    });
    for (const entry of itemEntries) {
      const item = state.items.find((i) => i.uuid === entry.uuid);
      if (item) itemMap.set(item.id, { ...entry, id: item.id });
    }

    // Use layout if available, else build default from items
    const layout = state.layout.length > 0 ? state.layout : [];
    const defaultLayout = layout.length === 0
      ? state.items.map((item) => ({ type: "item", id: item.id }))
      : null;

    const rows = [];
    const processLayout = defaultLayout ?? layout;

    for (const row of processLayout) {
      if (row.type === "item") {
        const entry = itemMap.get(row.id);
        if (entry && (!searchQuery || searchMatch(entry, normalizeSearchText, searchQuery))) {
          rows.push({
            type: "item", isItem: true, isGroup: false, isGroupMember: false,
            isSelected: selectedItemIds?.has(entry.id) ?? false,
            ...entry,
          });
        }
      } else if (row.type === "group") {
        const group = state.groups.find((g) => g.id === row.id);
        if (!group) continue;
        const groupItems = group.itemIds.map((id) => itemMap.get(id)).filter(Boolean);
        if (searchQuery && !groupItems.some((gi) => searchMatch(gi, normalizeSearchText, searchQuery))
          && !group.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          continue;
        }
        const expanded = expandedGroupIds?.has(group.id) ?? group.expanded;
        rows.push({
          type: "group",
          isItem: false,
          isGroup: true,
          isGroupMember: false,
          id: group.id,
          name: group.name,
          itemCount: group.itemIds.length,
          mode: group.mode,
          expanded,
          activeCount: groupActiveCounts?.get(group.id) ?? 0,
          sessions: groupSessionsByGroupId?.get(group.id) ?? [],
        });
        if (expanded) {
          for (const child of groupItems) {
            rows.push({
              type: "group-member",
              isItem: false,
              isGroup: false,
              isGroupMember: true,
              groupId: group.id,
              ...child,
            });
          }
        }
      }
    }

    return rows;
  } catch (err) {
    error("Failed to build soundboard rows", { error: err });
    return [];
  }
}

function searchMatch(entry, normalizeSearchText, query) {
  const q = normalizeSearchText(query);
  const haystack = normalizeSearchText(`${entry.name} ${entry.playlistName ?? ""} ${entry.subtitle ?? ""}`);
  return haystack.includes(q);
}
