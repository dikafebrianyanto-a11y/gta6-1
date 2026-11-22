// Saving to localStorage.
//
// What gets kept between sessions: money, story progress, the player's spot
// on the map, health and ammo, the chosen difficulty, and two lifetime
// stats — the hottest the player ever got, and how many courier deliveries
// they finished.
//
// The save is written after every mission and whenever the game is paused,
// and it is read back from the title screen's Continue button. Everything
// lives under one key, solmar-save-v1 (see SAVE_KEY in config.js), as a
// single JSON object with a version number so an old or half-written save
// can be recognised and safely ignored.
import { DEFAULT_DIFFICULTY, DIFFICULTY, SAVE_KEY } from './config.js';

// The three difficulty names the save is allowed to carry. Anything else
// found in a stored save is treated as a stale value and reset.
const DIFFICULTY_NAMES = Object.keys(DIFFICULTY);

// The wanted scale runs 0..5; a stored best-wanted outside that range is
// clamped rather than trusted.
const MAX_WANTED = 5;

/**
 * The save shape, with a sensible default for every field.
 *
 * A fresh game starts broke, on mission zero, at the origin, with full
 * health and the starting ammo, on the default difficulty, with no record
 * yet — best wanted 0, no deliveries done, no fares, no packages.
 */
export function blankSave() {
  return {
    version: 1,
    money: 0,
    missionIndex: 0,
    completed: [],
    player: { x: 0, y: 0 },
    hp: 100,
    ammo: 24,
    difficulty: DEFAULT_DIFFICULTY,
    bestWanted: 0,
    deliveriesCompleted: 0,
    faresDone: 0,
    packages: 0,
    savedAt: 0,
  };
}

/**
 * Clean up a parsed save object before the game trusts it.
 *
 * Missing fields fall back to the blank save, an unknown difficulty name
 * falls back to the default, and the best-wanted stat is clamped to the
 * 0..5 scale. A save that survives this is always safe to play from, even
 * if it was written by an older build that never knew about difficulty or
 * the new stats — those fields simply take their defaults.
 */
function normaliseSave(parsed) {
  const cleaned = { ...blankSave(), ...parsed };
  if (!DIFFICULTY_NAMES.includes(cleaned.difficulty)) {
    cleaned.difficulty = DEFAULT_DIFFICULTY;
  }
  const best = Number(cleaned.bestWanted);
  cleaned.bestWanted = Number.isFinite(best)
    ? Math.max(0, Math.min(MAX_WANTED, Math.floor(best)))
    : 0;
  const deliveries = Number(cleaned.deliveriesCompleted);
  cleaned.deliveriesCompleted = Number.isFinite(deliveries)
    ? Math.max(0, Math.floor(deliveries))
    : 0;
  return cleaned;
}

/**
 * Read the save, or null when there is none or it does not parse.
 *
 * A stored object with the wrong version is treated as no save at all,
 * rather than migrated — the shape is small enough that starting fresh
 * beats guessing at a conversion.
 */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      return null;
    }
    return normaliseSave(parsed);
  } catch {
    return null;
  }
}

/**
 * Write the save, stamping it with the current time.
 *
 * Any fields the caller leaves out are filled from the blank save, so a
 * partial update can never produce a save that is missing a field the
 * loader expects. Returns false when storage is unavailable.
 */
export function writeSave(data) {
  try {
    const merged = normaliseSave({ ...data, savedAt: Date.now() });
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(merged));
    return true;
  } catch {
    return false;
  }
}

/**
 * Wipe the save (new game). A no-op when storage is off.
 */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage unavailable: nothing to wipe.
  }
}
