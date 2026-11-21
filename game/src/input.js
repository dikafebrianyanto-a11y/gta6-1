// Keyboard and mouse input for Solmar. Held keys give a movement vector;
// one-shot presses (enter car, punch, pause, confirm) are queued as flags
// and taken once by the loop, so a press between two frames is never lost
// and never counted twice.
import { CONTROLS } from './config.js';

export const ACT_ENTER = 1;
export const ACT_PUNCH = 2;
export const ACT_PAUSE = 4;
export const ACT_CONFIRM = 8;
export const ACT_MUTE = 16;

function codesFor(action) {
  return new Set(CONTROLS[action]);
}

const UP = codesFor('up');
const DOWN = codesFor('down');
const LEFT = codesFor('left');
const RIGHT = codesFor('right');
const SPRINT = codesFor('sprint');
const ENTER = codesFor('enterCar');
const PUNCH = codesFor('punch');
const SHOOT = codesFor('shoot');
const PAUSE = codesFor('pause');
const MUTE = codesFor('mute');
const CONFIRM = codesFor('confirm');

/** Attach listeners to the window and canvas; returns the live input state. */
export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let mouseDown = false;
  let mouseX = 0;
  let mouseY = 0;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)) event.preventDefault();
      return;
    }
    held.add(event.code);
    if (ENTER.has(event.code)) actions |= ACT_ENTER;
    else if (PUNCH.has(event.code)) actions |= ACT_PUNCH;
    else if (PAUSE.has(event.code)) actions |= ACT_PAUSE;
    else if (MUTE.has(event.code)) actions |= ACT_MUTE;
    else if (CONFIRM.has(event.code)) actions |= ACT_CONFIRM;
    if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code) || PUNCH.has(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of all.
  window.addEventListener('blur', () => {
    held.clear();
    mouseDown = false;
  });
  canvas.addEventListener('pointerdown', (event) => {
    mouseDown = true;
    mouseX = event.clientX;
    mouseY = event.clientY;
    actions |= ACT_PUNCH;
  });
  window.addEventListener('pointerup', () => {
    mouseDown = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });

  const has = (set) => {
    for (const code of set) if (held.has(code)) return true;
    return false;
  };

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
      return (has(UP) ? 1 : 0) - (has(DOWN) ? 1 : 0);
    },
    /** -1/0/1 steer axis: left is negative. */
    steerAxis() {
      return (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0);
    },
    /** Normalised walk vector for on-foot movement. */
    walkVector() {
      const x = (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0);
      const y = (has(DOWN) ? 1 : 0) - (has(UP) ? 1 : 0);
      if (x === 0 && y === 0) return { x: 0, y: 0 };
      const len = Math.hypot(x, y);
      return { x: x / len, y: y / len };
    },
    get sprint() {
      return has(SPRINT);
    },
    get shooting() {
      return has(SHOOT) || mouseDown;
    },
    /** The one-shot presses since the last call, as ACT_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Put flags back for another consumer (menu code hands play keys on). */
    requeue(flags) {
      actions |= flags;
    },
  };
}
