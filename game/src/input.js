// Input for Solmar: keyboard plus mouse, turned into a shape the game
// loop can read once a frame.
//
// Two kinds of input live here. Held keys (walk, drive, sprint, shoot)
// are read live through getters, so holding Shift keeps Dex sprinting for
// exactly as long as the key is down. One-shot presses (enter a car,
// punch, pause, confirm, mute) are queued as ACT_* flags and taken once
// by the loop, so a press that lands between two frames is never lost
// and never counted twice.
import { CONTROLS } from './config.js';

export const ACT_ENTER = 1;
export const ACT_PUNCH = 2;
export const ACT_PAUSE = 4;
export const ACT_CONFIRM = 8;
export const ACT_MUTE = 16;

// The physical keys behind the sprint action (either Shift), exposed so
// menus and the HUD can name the binding without hard-coding key codes.
export const SPRINT_KEYS = [...CONTROLS.sprint];

/** Turn a CONTROLS entry into a fast lookup set of key codes. */
function keySet(action) {
  return new Set(CONTROLS[action]);
}

// One set per action, built once at module load.
const KEYS = {
  up: keySet('up'),
  down: keySet('down'),
  left: keySet('left'),
  right: keySet('right'),
  sprint: keySet('sprint'),
  enterCar: keySet('enterCar'),
  punch: keySet('punch'),
  shoot: keySet('shoot'),
  pause: keySet('pause'),
  mute: keySet('mute'),
  confirm: keySet('confirm'),
};

/** Keys whose default browser behaviour (scrolling, spacebar) must not fire. */
const SCROLL_KEYS = new Set([...KEYS.up, ...KEYS.down, ...KEYS.left, ...KEYS.right, ...KEYS.punch]);

/** Attach listeners to the window and canvas; returns the live input state. */
export function createInput(canvas) {
  const held = new Set();
  let queued = 0;
  let mouseDown = false;
  let mouseX = 0;
  let mouseY = 0;

  /** True when any code in the set is currently held down. */
  const anyHeld = (set) => {
    for (const code of set) {
      if (held.has(code)) return true;
    }
    return false;
  };

  /** Map a fresh key press onto its one-shot action flag, if it has one. */
  const flagFor = (code) => {
    if (KEYS.enterCar.has(code)) return ACT_ENTER;
    if (KEYS.punch.has(code)) return ACT_PUNCH;
    if (KEYS.pause.has(code)) return ACT_PAUSE;
    if (KEYS.mute.has(code)) return ACT_MUTE;
    if (KEYS.confirm.has(code)) return ACT_CONFIRM;
    return 0;
  };

  const onKeyDown = (event) => {
    // Held-down repeats carry no new information; swallow them, but still
    // stop arrow keys from scrolling the page while held.
    if (event.repeat) {
      if (SCROLL_KEYS.has(event.code)) event.preventDefault();
      return;
    }
    held.add(event.code);
    queued |= flagFor(event.code);
    if (SCROLL_KEYS.has(event.code)) event.preventDefault();
  };

  const onKeyUp = (event) => {
    held.delete(event.code);
  };

  // A key released while the tab is hidden never sends keyup: let go of
  // everything, or Dex would keep walking (or sprinting) forever.
  const onBlur = () => {
    held.clear();
    mouseDown = false;
  };

  const onPointerDown = (event) => {
    mouseDown = true;
    mouseX = event.clientX;
    mouseY = event.clientY;
    queued |= ACT_PUNCH;
  };

  const onPointerUp = () => {
    mouseDown = false;
  };

  const onPointerMove = (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);

  return {
    held,
    get mouseDown() {
      return mouseDown;
    },
    get mouseX() {
      return mouseX;
    },
    get mouseY() {
      return mouseY;
    },
    /** -1/0/1 drive axis: up is forward, down is brake/reverse. */
    driveAxis() {
      return (anyHeld(KEYS.up) ? 1 : 0) - (anyHeld(KEYS.down) ? 1 : 0);
    },
    /** -1/0/1 steer axis: left is negative. */
    steerAxis() {
      return (anyHeld(KEYS.right) ? 1 : 0) - (anyHeld(KEYS.left) ? 1 : 0);
    },
    /** Normalised walk vector for on-foot movement. */
    walkVector() {
      const x = (anyHeld(KEYS.right) ? 1 : 0) - (anyHeld(KEYS.left) ? 1 : 0);
      const y = (anyHeld(KEYS.down) ? 1 : 0) - (anyHeld(KEYS.up) ? 1 : 0);
      if (x === 0 && y === 0) return { x: 0, y: 0 };
      const len = Math.hypot(x, y);
      return { x: x / len, y: y / len };
    },
    /**
     * True while a sprint key is held. This is only the raw key state —
     * whether Dex actually sprints (stamina, moving) is the player's job.
     */
    get sprint() {
      return anyHeld(KEYS.sprint);
    },
    /** Same check as the `sprint` getter, for callers that prefer a call. */
    sprintHeld() {
      return anyHeld(KEYS.sprint);
    },
    get shooting() {
      return anyHeld(KEYS.shoot) || mouseDown;
    },
    /** The one-shot presses since the last call, as ACT_* flags. */
    takeActions() {
      const taken = queued;
      queued = 0;
      return taken;
    },
    /** Put flags back for another consumer (menu code hands play keys on). */
    requeue(flags) {
      queued |= flags;
    },
  };
}
