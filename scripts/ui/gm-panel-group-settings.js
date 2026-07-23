import { GROUP_PRESETS, POSITIONAL_PRESETS } from "./gm-panel-presets.js";

const { FormDataExtended } = foundry.applications.ux;
const renderTemplate = foundry.applications.handlebars.renderTemplate;

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Safely parse a checkbox value from FormDataExtended.
 * Handles hidden+checkbox duplicates that may produce arrays.
 */
const isChecked = (value) => {
  if (Array.isArray(value)) return value.includes("true") || value.includes(true);
  return value === "true" || value === true || value === "on";
};

/**
 * Parse a group settings form into a patch object.
 *
 * @param {HTMLFormElement} form
 * @param {object} currentGroup
 * @returns {object} patch ready for updateGroup
 */
export function parseGroupSettingsForm(form, currentGroup) {
  const data = new FormDataExtended(form).object;

  return {
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : currentGroup.name,
    mode: data.mode === "random" ? "random" : "sequential",
    avoidImmediateRepeat: isChecked(data.avoidImmediateRepeat),
    repeat: isChecked(data.repeat),
    offsetMin: Math.max(0, Math.round(Number(data.offsetMin) || 1000)),
    offsetMax: Math.max(0, Math.round(Number(data.offsetMax) || 4000)),
    perTokenDesync: isChecked(data.perTokenDesync),
    volumeMode: data.volumeMode === "group" ? "group" : "item",
    positional: {
      radius: Number(data.positionalRadius) >= 0 ? Number(data.positionalRadius) : undefined,
      volume: Math.max(0, Math.min(1, Number(data.positionalVolume) || 1)),
      walls: isChecked(data.positionalWalls),
      easing: isChecked(data.positionalEasing),
      elevation: !Number.isNaN(Number(data.positionalElevation)) ? Number(data.positionalElevation) : undefined,
    },
  };
}

/**
 * Normalize / clamp a group settings patch in-place.
 *
 * @param {object} patch
 */
export function normalizeGroupSettings(patch) {
  // Swap min/max if inverted
  if (patch.offsetMin > patch.offsetMax) {
    [patch.offsetMin, patch.offsetMax] = [patch.offsetMax, patch.offsetMin];
  }
}

/**
 * Apply a group preset to the settings form.
 * Handles both behavioral fields (mode, repeat, delay, volumeMode)
 * and positional fields (radius, volume, walls, easing, elevation).
 *
 * @param {HTMLFormElement} form
 * @param {object} preset  Full group preset with mode, repeat, offsetMin, offsetMax, volumeMode, positional
 */
export function applyGroupPresetToForm(form, preset) {
  const set = (name, value) => {
    const el = form?.querySelector(`[name="${name}"]`);
    if (!el) return;
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      el.checked = value === true;
    } else if (el instanceof HTMLSelectElement) {
      el.value = String(value);
    } else if (el instanceof HTMLInputElement) {
      el.value = value;
    }
  };
  // Behavioral fields
  if (preset.mode) set("mode", preset.mode);
  if (typeof preset.avoidImmediateRepeat === "boolean") set("avoidImmediateRepeat", preset.avoidImmediateRepeat);
  if (typeof preset.repeat === "boolean") set("repeat", preset.repeat);
  if (typeof preset.offsetMin === "number") set("offsetMin", preset.offsetMin);
  if (typeof preset.offsetMax === "number") set("offsetMax", preset.offsetMax);
  if (preset.volumeMode) set("volumeMode", preset.volumeMode);

  // Positional fields (only if preset has positional data)
  const pos = preset.positional;
  if (pos && typeof pos === "object") {
    if (typeof pos.radius === "number") set("positionalRadius", pos.radius);
    if (typeof pos.volume === "number") {
      set("positionalVolume", pos.volume);
      // Update live display
      const volumeEl = form?.querySelector('[name="positionalVolume"]');
      if (volumeEl) {
        const disp = volumeEl.parentElement?.querySelector(".sgmp-range-value");
        if (disp) disp.textContent = Number(pos.volume).toFixed(2);
      }
    }
    if (typeof pos.walls === "boolean") set("positionalWalls", pos.walls);
    if (typeof pos.easing === "boolean") set("positionalEasing", pos.easing);
    if (typeof pos.elevation === "number") set("positionalElevation", pos.elevation);
  }
}

// ── Modal ───────────────────────────────────────────────────────────────────

/**
 * Open the group settings modal.
 *
 * @param {string} groupId
 * @param {object} callbacks
 * @param {(groupId: string) => object|null} callbacks.getGroupById
 * @param {(groupId: string, patch: object) => Promise<void>} callbacks.updateGroup
 * @param {() => { radius: number, volume: number, walls: boolean, easing: boolean, elevation: number }} callbacks.getPositionalDefaults
 * @param {() => Promise<void>} callbacks.render
 */
export async function openGroupSettings(groupId, {
  getGroupById,
  updateGroup,
  getPositionalDefaults,
  render,
}) {
  if (typeof groupId !== "string" || !groupId) return;
  const group = getGroupById(groupId);
  if (!group) return;

  const presets = GROUP_PRESETS.map((p) => ({
    ...p,
    label: game.i18n.localize(`SIMONE_GM_PANEL.Soundboard.GroupPresetLabel_${p.id}`),
    description: game.i18n.localize(`SIMONE_GM_PANEL.Soundboard.GroupPresetDesc_${p.id}`),
  }));

  const globalDefaults = getPositionalDefaults();
  const pos = group.positional && typeof group.positional === "object" ? group.positional : {};

  const content = await renderTemplate("modules/simone-gm-panel-sounds/templates/group-settings-modal.hbs", {
    groupName: group.name,
    mode: group.mode ?? "sequential",
    avoidImmediateRepeat: group.avoidImmediateRepeat !== false,
    repeat: group.repeat !== false,
    offsetMin: group.offsetMin ?? 1000,
    offsetMax: group.offsetMax ?? 4000,
    perTokenDesync: group.perTokenDesync === true,
    volumeMode: group.volumeMode ?? "item",
    presets,
    positional: {
      radius: pos.radius ?? globalDefaults.radius,
      volume: pos.volume ?? globalDefaults.volume,
      walls: pos.walls ?? globalDefaults.walls,
      easing: pos.easing ?? globalDefaults.easing,
      elevation: pos.elevation ?? globalDefaults.elevation,
    },
    globalDefaults,
  });

  const { DialogV2 } = foundry.applications.api;
  const dialog = new DialogV2({
    title: game.i18n.format("SIMONE_GM_PANEL.Soundboard.GroupSettingsTitle", { name: group.name }),
    content: `<div class="sgmp-modal-body">${content}</div>`,
    buttons: [
      { action: "save", label: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.GroupSettingsSave"), callback: async (event, button) => {
        const form = button.form;
        if (!(form instanceof HTMLFormElement)) return;

        const patch = parseGroupSettingsForm(form, group);
        normalizeGroupSettings(patch);

        await updateGroup(groupId, patch);
        await render();
      }, default: true },
      { action: "close", label: game.i18n.localize("Close") },
    ],
    modal: true,
    window: { resizable: true },
    position: { width: 520, height: "auto" },
  });

  await dialog.render({ force: true });
  dialog.setPosition({ width: 520, height: "auto" });

  // Volume live update
  const el = dialog.element;
  if (el instanceof HTMLElement) {
    const volumeRange = el.querySelector('[name="positionalVolume"]');
    if (volumeRange instanceof HTMLInputElement && volumeRange.type === "range") {
      const display = volumeRange.parentElement?.querySelector(".sgmp-range-value");
      const onRangeInput = () => {
        if (display) display.textContent = Number(volumeRange.value).toFixed(2);
      };
      volumeRange.addEventListener("input", onRangeInput);
    }

    // Preset chip click handlers — apply full group preset
    el.addEventListener("click", (e) => {
      const chip = e.target?.closest?.(".sgmp-preset-chip");
      if (!chip) return;
      e.preventDefault();
      const form = el.querySelector("form");
      if (!form) return;

      const ds = chip.dataset;
      applyGroupPresetToForm(form, {
        mode: ds.presetMode,
        avoidImmediateRepeat: ds.presetAvoidRepeat === "true",
        repeat: ds.presetRepeat === "true",
        offsetMin: Number(ds.presetOffsetMin),
        offsetMax: Number(ds.presetOffsetMax),
        volumeMode: ds.presetVolumeMode,
        positional: {
          radius: Number(ds.presetRadius) || undefined,
          volume: Number(ds.presetVolume) || undefined,
          walls: ds.presetWalls === "true" ? true : ds.presetWalls === "false" ? false : undefined,
          easing: ds.presetEasing === "true" ? true : ds.presetEasing === "false" ? false : undefined,
          elevation: ds.presetElevation != null ? Number(ds.presetElevation) : undefined,
        },
      });
    });
  }
}
