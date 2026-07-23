import { error } from "../debug.js";
import { POSITIONAL_PRESETS } from "./gm-panel-presets.js";

const { FormDataExtended } = foundry.applications.ux;
const renderTemplate = foundry.applications.handlebars.renderTemplate;

/**
 * Open the sound settings modal for a given sound UUID.
 *
 * Extracted from GmPanelSoundboardStore.openSoundSettings.
 * All state flows through callbacks — no private fields accessed.
 *
 * @param {string} uuid - Sound UUID to edit
 * @param {object} callbacks
 * @param {(uuid: string) => Promise<object|null>} callbacks.resolvePlaylistSound
 * @param {() => { radius: number, volume: number, walls: boolean, easing: boolean, elevation: number }} callbacks.getPositionalDefaults
 * @param {() => { items: Array, groups: Array, layout: Array }} callbacks.getSoundboardState
 * @param {(state: object) => Promise<void>} callbacks.setSoundboardState
 * @param {() => void} callbacks.scheduleAutosave
 * @param {() => Promise<void>} callbacks.render
 * @returns {Promise<void>}
 */
export async function openSoundSettings(uuid, {
  resolvePlaylistSound,
  getPositionalDefaults,
  getSoundboardState,
  setSoundboardState,
  scheduleAutosave,
  render,
}) {
  const normalizedUuid = typeof uuid === "string" ? uuid.trim() : "";
  if (!normalizedUuid) return;

  const state = getSoundboardState();
  const item = state.items.find((i) => i.uuid === normalizedUuid);
  if (!item) return;

  const sound = await resolvePlaylistSound(normalizedUuid);
  const title = sound?.name ?? game.i18n.localize("SIMONE_GM_PANEL.Soundboard.SettingsTitle");

  const presets = POSITIONAL_PRESETS.map((p) => ({
    ...p,
    label: game.i18n.localize(`SIMONE_GM_PANEL.Soundboard.PresetLabel_${p.id}`),
    description: game.i18n.localize(`SIMONE_GM_PANEL.Soundboard.PresetDesc_${p.id}`),
  }));

  const globalDefaults = getPositionalDefaults();
  const overrides = item.positional && typeof item.positional === "object" ? item.positional : {};

  const content = await renderTemplate("modules/simone-gm-panel-sounds/templates/sound-settings-modal.hbs", {
    offsetMin: item.offsetMin ?? 0,
    offsetMax: item.offsetMax ?? 1000,
    loop: item.loop === true,
    soundName: title,
    presets,
    positional: {
      radius: overrides.radius ?? globalDefaults.radius,
      volume: overrides.volume ?? globalDefaults.volume,
      walls: overrides.walls ?? globalDefaults.walls,
      easing: overrides.easing ?? globalDefaults.easing,
      elevation: overrides.elevation ?? globalDefaults.elevation,
    },
    globalDefaults,
  });

  const { DialogV2 } = foundry.applications.api;
  const result = await new Promise((resolve) => {
    let resolved = false;
    const dialog = new DialogV2({
      title,
      content,
      buttons: [
        {
          action: "ok",
          label: game.i18n.localize("SIMONE_GM_PANEL.Soundboard.SettingsSave"),
          default: true,
          callback: (event, button) => {
            if (resolved) return;
            resolved = true;
            const form = dialog.element?.querySelector("form");
            if (!(form instanceof HTMLFormElement)) { resolve(null); return; }
            const fd = new FormDataExtended(form);
            const offsetMin = Math.round(Math.max(0, Math.min(60000, Number(fd.object.offsetMin) || 0)));
            const offsetMax = Math.round(Math.max(offsetMin, Math.min(60000, Number(fd.object.offsetMax) || 1000)));
            const loop = fd.object.loop === true;
            const positional = {
              radius: Number(fd.object.positionalRadius),
              volume: Number(fd.object.positionalVolume),
              walls: fd.object.positionalWalls === true,
              easing: fd.object.positionalEasing === true,
              elevation: Number(fd.object.positionalElevation),
            };
            const storedPositional = {};
            if (Number.isFinite(positional.radius) && positional.radius !== globalDefaults.radius) storedPositional.radius = positional.radius;
            if (Number.isFinite(positional.volume) && positional.volume !== globalDefaults.volume) storedPositional.volume = positional.volume;
            if (positional.walls !== globalDefaults.walls) storedPositional.walls = positional.walls;
            if (positional.easing !== globalDefaults.easing) storedPositional.easing = positional.easing;
            if (Number.isFinite(positional.elevation) && positional.elevation !== globalDefaults.elevation) storedPositional.elevation = positional.elevation;
            resolve({ offsetMin, offsetMax, loop, positional: Object.keys(storedPositional).length ? storedPositional : undefined });
          },
        },
        { action: "cancel", label: game.i18n.localize("Cancel") },
      ],
      close: () => {
        if (!resolved) { resolved = true; resolve(null); }
      },
      modal: true,
      rejectClose: false,
      window: { resizable: true },
      position: { width: 400, height: "auto" },
    });

    dialog.render({ force: true }).then(() => {
      const form = dialog.element?.querySelector("form");

      const volumeRange = form?.elements?.namedItem("positionalVolume");
      if (volumeRange instanceof HTMLInputElement && volumeRange.type === "range") {
        const display = volumeRange.parentElement?.querySelector(".sgmp-range-value");
        const onRangeInput = () => {
          if (display) display.textContent = Number(volumeRange.value).toFixed(2);
        };
        volumeRange.addEventListener("input", onRangeInput);
      }

      const chipContainer = dialog.element?.querySelector(".sgmp-preset-chips");
      if (chipContainer instanceof HTMLElement) {
        chipContainer.addEventListener("click", (event) => {
          const chip = event.target.closest(".sgmp-preset-chip");
          if (!(chip instanceof HTMLElement)) return;
          if (!form) return;
          const ds = chip.dataset;
          const setVal = (name, value) => {
            const el = form.elements.namedItem(name);
            if (el instanceof HTMLInputElement) {
              if (el.type === "checkbox") el.checked = value === "true";
              else el.value = value;
            }
            if (el?.type === "range") {
              const disp = el.parentElement?.querySelector(".sgmp-range-value");
              if (disp) disp.textContent = Number(value).toFixed(2);
            }
          };
          setVal("positionalRadius", ds.presetRadius);
          setVal("positionalVolume", ds.presetVolume);
          setVal("positionalWalls", ds.presetWalls);
          setVal("positionalEasing", ds.presetEasing);
          setVal("positionalElevation", ds.presetElevation);
        });
      }
    }).catch((err) => {
      error("Failed to render sound settings dialog", { error: err });
      if (!resolved) { resolved = true; resolve(null); }
    });
  });

  if (!result) return;

  const { offsetMin, offsetMax, loop, positional } = result;
  const nextItems = state.items.map((i) =>
    i.uuid === normalizedUuid ? { ...i, loop, offsetMin, offsetMax, ...(positional ? { positional } : {}) } : i,
  );
  await setSoundboardState({ ...state, items: nextItems });
  scheduleAutosave?.();
  await render();
}
