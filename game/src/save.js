// Saving to localStorage: money, story progress, the player's spot on the
// map, health and ammo. Saved after every mission and whenever the game is
// paused; loaded from the title screen's Continue button.
import { SAVE_KEY } from './config.js';

/** The save shape, so a load of a half-written save still makes sense. */
export function blankSave() {
  return {
    version: 1,
    money: 0,
    missionIndex: 0,
    completed: [],
    player: { x: 0, y: 0 },
    hp: 100,
    ammo: 24,
    faresDone: 0,
    packages: 0,
    savedAt: 0,
  };
}

/** Read the save, or null when there is none or it does not parse. */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || data.version !== 1) return null;
    return { ...blankSave(), ...data };
  } catch {
    return null;
  }
}

/** Write the save. Returns false when storage is unavailable. */
export function writeSave(data) {
  try {
    const out = { ...blankSave(), ...data, savedAt: Date.now() };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(out));
    return true;
  } catch {
    return false;
  }
}

/** Wipe the save (new game). */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage off: nothing to wipe.
  }
}
