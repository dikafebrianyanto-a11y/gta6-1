// Boot, the one loop, and the wiring between every system.
//
// Solmar runs on four screens — title, play, paused, over — driven by one
// fixed-step simulation. The game object `g` is the single shared state:
// every module reads and writes it, and this file owns the order they run
// in. New systems land here: difficulty (config + save), bikes, roadblocks,
// the courier side job, beachfront ambience, and the time-of-day lighting.
//
// ?seed=N fixes the city. ?shot=cover|street|chase|mission (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { DEFAULT_DIFFICULTY, DIFFICULTY, WORLD_H, WORLD_W } from './config.js';
import { buildCity } from './world.js';
import { ACT_CONFIRM, ACT_ENTER, ACT_MUTE, ACT_PAUSE, ACT_PUNCH, createInput } from './input.js';
import { collideCarWithCars, collideCarWithCity, createPlayer, playerPunch, playerShoot, stepPlayerOnFoot, toggleCar } from './player.js';
import { carsOverlap, driveCar, isBike, separateCars, spawnBike } from './vehicles.js';
import { createTraffic, knockPed, spawnParked, updateTraffic } from './traffic.js';
import { clearRoadblocks, createPolice, updatePolice, updateRoadblocks } from './police.js';
import { batSwing, createCombat, throwBottle, updateCombat } from './combat.js';
import { courierMarker, createMissions, missionMarker, objectiveText, startMission, updateMissions } from './missions.js';
import { burst, createEffects, gullFlock, sandSpray, shake, skidMark, updateEffects, waveSparkle } from './effects.js';
import { createAudio } from './audio.js';
import { clearSave, loadSave, writeSave } from './save.js';
import { createRenderer, getTimeOfDay, setTimeOfDay } from './render.js';
import { drawHud, drawOver, drawPaused, drawTitle } from './hud.js';
import { stageShot } from './shots.js';

// One simulation step, and the longest a single frame may advance.
const STEP = 1 / 60;
const MAX_FRAME = 0.25;

// The three difficulty presets, in the order the title screen cycles them.
const DIFFICULTY_ORDER = Object.keys(DIFFICULTY);
// The finale runs at dusk; this is its mission index in the story list.
const LAST_FARE_INDEX = 6;

// Raw key codes for the actions no CONTROLS entry covers yet: bat, bottle,
// time-of-day, and the title-screen difficulty picker.
const KEY_BAT = 'KeyB';
const KEY_BOTTLE = 'KeyG';
const KEY_TIME = 'KeyT';
const KEY_DIFFICULTY = 'KeyD';

// Keys already seen down, so a held key fires once per physical press
// instead of once per simulation step. Released keys are pruned each frame.
const latchedKeys = new Set();

/** True only on the first step that sees this key held down. */
function tapped(code) {
  if (!input.held.has(code)) return false;
  if (latchedKeys.has(code)) return false;
  latchedKeys.add(code);
  return true;
}

/** Forget keys the player has let go of, so the next press taps again. */
function releaseLatchedKeys() {
  for (const code of [...latchedKeys]) {
    if (!input.held.has(code)) latchedKeys.delete(code);
  }
}

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();

/** Next preset after `name`, wrapping from hard back to easy. */
function nextDifficulty(name) {
  const at = DIFFICULTY_ORDER.indexOf(name);
  return DIFFICULTY_ORDER[(at + 1) % DIFFICULTY_ORDER.length];
}

/** 'normal' -> 'Normal', for the title-screen line. */
function prettyDifficulty(name) {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/** Park the three motorcycles: two along the beachfront, one by the marina spawn. */
function parkBikes(g) {
  const beach = g.city.markers.beachfront;
  const pier = g.city.markers.pier;
  const spawn = g.city.spawn;
  const parked = [
    spawnBike(beach.x - 90, beach.y - 26, Math.PI / 2, '#d94f2b'),
    spawnBike(pier.x + 130, g.city.promenadeY - 26, -Math.PI / 2, '#2b6fd9'),
    spawnBike(spawn.x, spawn.y - 66, Math.PI, '#e8c33a'),
  ];
  for (const bike of parked) g.cars.push(bike);
  return parked;
}

/** Mirror the courier run onto `g` in the shape the HUD reads. */
function syncCourierHud(g) {
  g.courier = g.missions.courier;
  g.courierMarker = courierMarker(g);
}

/** The whole game state, built fresh from a seed. */
export function createGame(seedValue) {
  const city = buildCity('solmar-' + seedValue);
  const g = {
    seed: seedValue,
    city,
    time: 0,
    mode: 'title',
    overKind: null,
    money: 0,
    wanted: 0,
    wantedTimer: 0,
    faresDone: 0,
    packages: 0,
    // Difficulty lives on the game state as the preset name ('easy' /
    // 'normal' / 'hard'); traffic, police and payouts all read it.
    difficulty: DEFAULT_DIFFICULTY,
    // Lifetime records: hottest the player ever got, and courier runs done.
    bestWanted: 0,
    deliveriesCompleted: 0,
    gunshotTimer: 0,
    saveNow: false,
    aimMouse: false,
    sprintHeld: false,
    ambienceTimer: 1.5,
    finaleDusk: false,
    input,
    audio,
    fx: createEffects(),
    player: createPlayer(city.spawn.x, city.spawn.y),
    cars: [],
    traffic: null,
    police: createPolice(),
    combat: createCombat(),
    enemies: [],
    bullets: [],
    missions: null,
    courier: null,
    courierMarker: null,
    camera: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    events: [],
    missionMarker: null,
    objective: '',
    hasSave: false,
  };
  g.missions = createMissions(city, seedValue);
  resetWorld(g);
  return g;
}

/** Rebuild the moving parts of the world: cars, bikes, traffic, cops, story. */
export function resetWorld(g) {
  const city = g.city;
  // Haul away any standing roadblock before the police force is rebuilt,
  // so its cruisers do not linger as ghosts in the fresh world.
  if (g.police) clearRoadblocks(g);
  g.player = createPlayer(city.spawn.x, city.spawn.y);
  g.cars = spawnParked(city, g.seed, 34);
  parkBikes(g);
  // The third argument is the difficulty preset name: without it every
  // world would spawn normal-density traffic whatever the player picked.
  g.traffic = createTraffic(city, g.seed, g.difficulty ?? DEFAULT_DIFFICULTY);
  for (const car of g.traffic.cars) g.cars.push(car);
  g.police = createPolice();
  g.combat = createCombat();
  g.enemies = [];
  g.bullets = [];
  g.missions = createMissions(city, g.seed);
  g.courier = null;
  g.courierMarker = null;
  g.wanted = 0;
  g.wantedTimer = 0;
  g.events = [];
  g.fx = createEffects();
  g.ambienceTimer = 1.5;
  g.finaleDusk = false;
}

/** Snapshot the progress worth keeping between visits. */
function snapshot(g) {
  return {
    version: 1,
    money: g.money,
    missionIndex: g.missions.done ? g.missions.scripts.length : g.missions.index,
    completed: g.missions.scripts.slice(0, g.missions.index).map((s) => s.title),
    player: { x: g.player.x, y: g.player.y },
    hp: g.player.hp,
    ammo: g.player.ammo,
    faresDone: g.faresDone,
    packages: g.packages,
    difficulty: g.difficulty,
    bestWanted: g.bestWanted,
    deliveriesCompleted: g.deliveriesCompleted,
  };
}

/** Apply a loaded save to a fresh game. */
function applySave(g, save) {
  g.money = save.money;
  g.faresDone = save.faresDone;
  g.packages = save.packages;
  g.difficulty = save.difficulty;
  g.bestWanted = save.bestWanted ?? 0;
  g.deliveriesCompleted = save.deliveriesCompleted ?? 0;
  g.player.hp = save.hp;
  g.player.ammo = save.ammo;
  if (save.missionIndex >= g.missions.scripts.length) {
    g.missions.done = true;
  } else if (save.missionIndex > 0) {
    startMission(g, save.missionIndex);
  }
  // Loading straight into the finale still earns its dusk.
  if (save.missionIndex === LAST_FARE_INDEX) {
    setTimeOfDay('dusk');
    g.finaleDusk = true;
  }
  g.player.x = save.player.x;
  g.player.y = save.player.y;
}

const game = createGame(seed);
// The title screen shows the saved difficulty, not the default.
const bootSave = loadSave();
game.hasSave = bootSave !== null;
if (bootSave) game.difficulty = bootSave.difficulty;
// Test hook: lets a play-test driver (or a curious player) inspect the game.
window.__solmar = game;

/** Remember the hottest the player has ever been this run. */
function trackHeat(g) {
  if (g.wanted > g.bestWanted) g.bestWanted = g.wanted;
}

/**
 * Watch the courier run across one mission tick and ring the chime for
 * its two happy moments: the package coming aboard, and the payout.
 * A run that simply vanishes while the package count rose is a delivery;
 * a run that vanishes without one expired.
 */
function watchCourier(g, before) {
  const run = g.missions.courier;
  if (before.active && run && before.phase === 'pickup' && run.phase === 'deliver') {
    g.audio.courierChime();
  }
  if (before.active && !run && g.packages > before.packages) {
    g.deliveriesCompleted += 1;
    g.audio.courierChime();
  }
}

/** The finale, Mission 7 'The Last Fare', plays at dusk — once. */
function applyFinaleLighting(g) {
  if (g.finaleDusk) return;
  const script = g.missions.scripts[g.missions.index];
  if (!g.missions.done && script && script.title === 'The Last Fare') {
    setTimeOfDay('dusk');
    g.finaleDusk = true;
  }
}

/**
 * Beachfront ambience: gulls circling the pier and glints on the water,
 * on a slow timer, plus sand kicked up whenever Dex is moving along the
 * promenade — on foot or on a fast ride.
 */
function beachAmbience(g, dt) {
  g.ambienceTimer -= dt;
  const pier = g.city.markers.pier;
  const nearBeach = Math.abs(g.player.y - g.city.promenadeY) < 300;
  const rolling = g.player.inCar
    ? Math.abs(g.player.inCar.speed) > 200
    : g.player.moving;
  if (nearBeach && rolling) {
    sandSpray(g.fx, g.player.x, g.player.y + 10, { count: 2, spread: 90, life: 0.4 });
  }
  if (g.ambienceTimer > 0) return;
  g.ambienceTimer = 2.2 + Math.random() * 1.6;
  gullFlock(g.fx, pier.x, pier.y - 60, 4);
  waveSparkle(g.fx, pier.x + (Math.random() - 0.5) * 320, pier.y + 70, { count: 5 });
}

/** One driving step: throttle, steer, collisions, and the bike's buzz. */
function driveStep(g, dt) {
  const p = g.player;
  const car = p.inCar;
  const throttle = g.input.driveAxis();
  const steer = g.input.steerAxis();
  const handbrake = g.input.held.has('Space');
  driveCar(car, dt, throttle, steer, handbrake);
  p.x = car.x;
  p.y = car.y;
  p.angle = car.angle;
  if (handbrake && Math.abs(car.speed) > 120) skidMark(g.fx, car);
  if (Math.abs(car.speed) > 60 && Math.random() < dt * 8) {
    burst(g.fx, car.x - Math.sin(car.angle) * car.h / 2, car.y + Math.cos(car.angle) * car.h / 2, { count: 1, color: 'rgba(120,120,120,0.5)', speed: 20, life: 0.6, size: 3 });
  }
  collideCarWithCity(g, car);
  collideCarWithCars(g, car);
  // Running over pedestrians is a crime the city sees.
  for (const ped of g.traffic.peds) {
    if (ped.down) continue;
    if (Math.hypot(ped.x - car.x, ped.y - car.y) < 26 && Math.abs(car.speed) > 60) knockPed(g, ped);
  }
  // Bumping traffic cars shunts them aside.
  for (const other of g.traffic.cars) {
    if (carsOverlap(car, other)) separateCars(car, other);
  }
  if (car.hp <= 0) {
    burst(g.fx, car.x, car.y, { count: 20, color: '#ff5a3c', speed: 240, life: 0.8, size: 4 });
    shake(g.fx, 8);
    g.audio.crash();
    car.occupied = false;
    car.driver = null;
    p.inCar = null;
    p.x = car.x + 40;
    p.y = car.y;
    const idx = g.cars.indexOf(car);
    if (idx !== -1) g.cars.splice(idx, 1);
  }
}

/**
 * One on-foot step. Sprint is read here through sprintHeld() so the
 * stamina meter in player.js sees the key; the bat and the bottle sit
 * beside the existing punch and shoot.
 */
function onFootStep(g, dt) {
  g.sprintHeld = g.input.sprintHeld();
  stepPlayerOnFoot(g, dt);
  if (tapped(KEY_BAT)) batSwing(g);
  if (tapped(KEY_BOTTLE)) throwBottle(g);
  if (g.input.shooting) playerShoot(g);
}

/** Cycle the lighting day -> dusk -> night when T is tapped in play. */
function cycleTimeOfDay() {
  const phases = ['day', 'dusk', 'night'];
  const at = phases.indexOf(getTimeOfDay());
  setTimeOfDay(phases[(at + 1) % phases.length]);
}

/** One fixed simulation step, in play mode. */
export function stepGame(g, dt) {
  g.time += dt;
  const p = g.player;

  // One-shot actions first.
  const actions = g.input.takeActions();
  if (actions & ACT_MUTE) g.audio.setMuted(!g.audio.muted);
  if (actions & ACT_PUNCH && !p.inCar) playerPunch(g);
  if (actions & ACT_ENTER && !p.inCar) {
    const result = toggleCar(g);
    if (result === 'in') {
      const idx = g.traffic.cars.indexOf(p.inCar);
      if (idx !== -1) g.traffic.cars.splice(idx, 1);
      g.audio.pickup();
    }
  } else if (actions & ACT_ENTER && p.inCar) {
    toggleCar(g);
  }
  if (tapped(KEY_TIME)) cycleTimeOfDay();

  // The player, on foot or behind the wheel.
  if (p.inCar) driveStep(g, dt);
  else onFootStep(g, dt);

  const courierBefore = {
    active: Boolean(g.missions.courier),
    phase: g.missions.courier ? g.missions.courier.phase : null,
    packages: g.packages,
  };
  updateTraffic(g, dt);
  updatePolice(g, dt);
  updateCombat(g, dt);
  updateMissions(g, dt);
  updateEffects(g.fx, dt);
  watchCourier(g, courierBefore);
  syncCourierHud(g);
  applyFinaleLighting(g);
  beachAmbience(g, dt);
  trackHeat(g);

  // Slow health regen when Dex is out of trouble.
  if (p.hp > 0 && p.hp < 100 && g.wanted === 0) p.hp = Math.min(100, p.hp + 2.5 * dt);

  // The camera chases the player, softly.
  const vw = renderer.view.w;
  const vh = renderer.view.h;
  const tx = p.x - vw / 2;
  const ty = p.y - vh / 2;
  const cx = vw >= WORLD_W ? (WORLD_W - vw) / 2 : Math.max(0, Math.min(WORLD_W - vw, tx));
  const cy = vh >= WORLD_H ? (WORLD_H - vh) / 2 : Math.max(0, Math.min(WORLD_H - vh, ty));
  g.camera.x += (cx - g.camera.x) * Math.min(1, 6 * dt);
  g.camera.y += (cy - g.camera.y) * Math.min(1, 6 * dt);
  g.camera.w = vw;
  g.camera.h = vh;

  // Engine and sirens follow the action. A bike gets its own buzz and no
  // car hum; anything else on wheels gets the car engine instead.
  const ridingBike = Boolean(p.inCar && isBike(p.inCar));
  g.audio.motorcycleEngine(p.inCar ? p.inCar.speed : 0, ridingBike);
  g.audio.engine(ridingBike ? 0 : (p.inCar ? p.inCar.speed : 0), Boolean(p.inCar) && !ridingBike);
  g.audio.siren(g.police.sirenNear, dt);
  g.audio.roadblockSiren(g.police.roadblocks.length > 0, dt);

  // Objective line and marker for the HUD.
  g.missionMarker = missionMarker(g);
  g.objective = objectiveText(g);

  // Busted or wasted ends the run.
  if (g.events.length > 0) {
    const event = g.events.shift();
    if (event === 'busted' || event === 'wasted') {
      g.mode = 'over';
      g.overKind = event;
      g.audio.fail();
      g.audio.engine(0, false);
      g.audio.motorcycleEngine(0, false);
    }
  }

  if (g.saveNow) {
    g.saveNow = false;
    writeSave(snapshot(g));
  }
}

/** The difficulty line under the title card, naming the current preset. */
function drawTitleDifficulty(ctx, g, w, h) {
  const cx = w / 2;
  const y = h * 0.52 + 236;
  ctx.font = '16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd94d';
  ctx.fillText(`Difficulty: ${prettyDifficulty(g.difficulty)}  ·  D — change  ·  Shift — sprint`, cx, y);
  ctx.fillStyle = 'rgba(238,241,245,0.75)';
  ctx.fillText('T — time of day  ·  B — bat  ·  G — throw bottle', cx, y + 24);
}

/** Paint the current screen. */
function drawGame(g) {
  renderer.draw(g);
  const { ctx } = renderer;
  const { w, h } = renderer.view;
  if (g.mode === 'title') {
    drawTitle(ctx, g, w, h, g.hasSave);
    drawTitleDifficulty(ctx, g, w, h);
  } else if (g.mode === 'pause') drawPaused(ctx, g, w, h);
  else if (g.mode === 'over') drawOver(ctx, g, w, h, g.overKind);
  else if (g.mode === 'complete') drawOver(ctx, g, w, h, 'complete');
  else drawHud(ctx, g, w, h);
}

function announce(message) {
  status.textContent = message;
}

/** Persist a difficulty pick without clobbering a real save's progress. */
function persistDifficultyPick() {
  const existing = loadSave();
  if (existing) writeSave({ ...existing, difficulty: game.difficulty });
}

function startNewGame() {
  clearSave();
  game.money = 0;
  game.faresDone = 0;
  game.packages = 0;
  game.bestWanted = 0;
  game.deliveriesCompleted = 0;
  resetWorld(game);
  startMission(game, 0);
  game.mode = 'play';
  game.overKind = null;
  audio.ensure();
  audio.musicStart();
  writeSave(snapshot(game));
  announce('Playing. Mission 1: First Fare.');
}

function continueGame() {
  const save = loadSave();
  if (!save) {
    startNewGame();
    return;
  }
  resetWorld(game);
  applySave(game, save);
  game.mode = 'play';
  game.overKind = null;
  audio.ensure();
  audio.musicStart();
  announce('Continuing. Mission ' + (game.missions.index + 1) + '.');
}

function runShot(name) {
  stageShot(game, name, stepGame, () => resetWorld(game));
  game.mode = 'play';
  let painted = 0;
  function paint() {
    drawGame(game);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();

  function handleActions() {
    const actions = input.takeActions();
    // Play keys belong to the simulation: hand them back untouched.
    const playKeys = actions & (ACT_ENTER | ACT_PUNCH);
    if (playKeys) input.requeue(playKeys);
    // D cycles the difficulty on the title screen, with a blip per pick.
    if (game.mode === 'title' && tapped(KEY_DIFFICULTY)) {
      game.difficulty = nextDifficulty(game.difficulty);
      audio.difficultyBlip();
      persistDifficultyPick();
    }
    if (game.mode === 'title' && (actions & ACT_CONFIRM)) {
      if (game.hasSave) continueGame();
      else startNewGame();
    } else if (game.mode === 'over' && (actions & ACT_CONFIRM)) {
      startNewGame();
    } else if (game.mode === 'complete' && (actions & ACT_CONFIRM)) {
      startNewGame();
    } else if (game.mode === 'play' && (actions & ACT_PAUSE)) {
      game.mode = 'pause';
      writeSave(snapshot(game));
      announce('Paused. Progress saved.');
    } else if (game.mode === 'pause' && (actions & ACT_PAUSE)) {
      game.mode = 'play';
      announce('Playing.');
    } else if (game.mode === 'pause' && (actions & ACT_CONFIRM)) {
      game.mode = 'title';
      game.hasSave = loadSave() !== null;
      announce('Solmar. Press Enter to play.');
    }
    // Mute is the simulation's job while playing; the menus own it otherwise.
    if (game.mode !== 'play' && (actions & ACT_MUTE)) audio.setMuted(!audio.muted);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (game.mode === 'play') {
      while (accumulator >= STEP) {
        stepGame(game, STEP);
        accumulator -= STEP;
        if (game.mode !== 'play') break;
      }
    } else if (game.mode === 'title') {
      // The city lives behind the title: traffic rolls on.
      while (accumulator >= STEP) {
        game.time += STEP;
        updateTraffic(game, STEP);
        updateEffects(game.fx, STEP);
        game.camera.x = Math.max(0, Math.min(WORLD_W - renderer.view.w, game.city.spawn.x - renderer.view.w / 2));
        game.camera.y = Math.max(0, Math.min(WORLD_H - renderer.view.h, game.city.spawn.y - renderer.view.h / 2));
        game.camera.w = renderer.view.w;
        game.camera.h = renderer.view.h;
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    releaseLatchedKeys();
    if (game.missions.done && game.mode === 'play') {
      game.mode = 'complete';
      game.overKind = 'complete';
    }
    drawGame(game);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.mode === 'play') {
      game.mode = 'pause';
      writeSave(snapshot(game));
      announce('Paused.');
    }
  });

  announce('Solmar: Streets of the Sun. Press Enter to play.');
  requestAnimationFrame(frame);
}

if (shotName) runShot(shotName);
else runGame();
