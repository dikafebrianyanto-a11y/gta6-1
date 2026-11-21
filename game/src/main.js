// Boot and the one loop: Solmar's screens (title, play, paused, over), the
// fixed-step simulation, and the wiring between every system. The game
// object `g` is the single shared state: every module reads and writes it,
// and main owns the order they run in.
//
// ?seed=N fixes the city. ?shot=cover|street|chase|mission (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { WORLD_H, WORLD_W } from './config.js';
import { buildCity } from './world.js';
import { ACT_CONFIRM, ACT_ENTER, ACT_MUTE, ACT_PAUSE, ACT_PUNCH, createInput } from './input.js';
import { collideCarWithCars, collideCarWithCity, createPlayer, hurtPlayer, playerPunch, playerShoot, stepPlayerOnFoot, toggleCar } from './player.js';
import { carsOverlap, driveCar, separateCars } from './vehicles.js';
import { createTraffic, knockPed, spawnParked, updateTraffic } from './traffic.js';
import { createPolice, updatePolice } from './police.js';
import { createCombat, updateCombat } from './combat.js';
import { createMissions, missionMarker, objectiveText, startMission, updateMissions } from './missions.js';
import { burst, createEffects, floatText, shake, skidMark, updateEffects } from './effects.js';
import { createAudio } from './audio.js';
import { clearSave, loadSave, writeSave } from './save.js';
import { createRenderer } from './render.js';
import { drawHud, drawOver, drawPaused, drawTitle } from './hud.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();

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
    gunshotTimer: 0,
    saveNow: false,
    aimMouse: false,
    input,
    audio,
    fx: createEffects(),
    player: createPlayer(city.spawn.x, city.spawn.y),
    cars: [],
    traffic: null,
    police: createPolice(),
    enemies: [],
    bullets: [],
    missions: null,
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

/** Rebuild the moving parts of the world: cars, traffic, cops, story. */
export function resetWorld(g) {
  const city = g.city;
  g.player = createPlayer(city.spawn.x, city.spawn.y);
  g.cars = spawnParked(city, g.seed, 34);
  g.traffic = createTraffic(city, g.seed);
  for (const car of g.traffic.cars) g.cars.push(car);
  g.police = createPolice();
  g.enemies = [];
  g.bullets = [];
  g.missions = createMissions(city, g.seed);
  g.wanted = 0;
  g.wantedTimer = 0;
  g.events = [];
  g.fx = createEffects();
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
  };
}

/** Apply a loaded save to a fresh game. */
function applySave(g, save) {
  g.money = save.money;
  g.faresDone = save.faresDone;
  g.packages = save.packages;
  g.player.hp = save.hp;
  g.player.ammo = save.ammo;
  if (save.missionIndex >= g.missions.scripts.length) {
    g.missions.done = true;
  } else if (save.missionIndex > 0) {
    startMission(g, save.missionIndex);
  }
  g.player.x = save.player.x;
  g.player.y = save.player.y;
}

const game = createGame(seed);
game.hasSave = loadSave() !== null;
// Test hook: lets a play-test driver (or a curious player) inspect the game.
window.__solmar = game;

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

  // The player, on foot or behind the wheel.
  if (p.inCar) {
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
  } else {
    stepPlayerOnFoot(g, dt);
    if (g.input.shooting) playerShoot(g);
  }

  updateTraffic(g, dt);
  updatePolice(g, dt);
  updateCombat(g, dt);
  updateMissions(g, dt);
  updateEffects(g.fx, dt);

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

  // Engine and sirens follow the action.
  g.audio.engine(p.inCar ? p.inCar.speed : 0, Boolean(p.inCar));
  g.audio.siren(g.police.sirenNear, dt);

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
    }
  }

  if (g.saveNow) {
    g.saveNow = false;
    writeSave(snapshot(g));
  }
}

/** Paint the current screen. */
function drawGame(g) {
  renderer.draw(g);
  const { ctx } = renderer;
  const { w, h } = renderer.view;
  if (g.mode === 'title') drawTitle(ctx, g, w, h, g.hasSave);
  else if (g.mode === 'pause') drawPaused(ctx, g, w, h);
  else if (g.mode === 'over') drawOver(ctx, g, w, h, g.overKind);
  else if (g.mode === 'complete') drawOver(ctx, g, w, h, 'complete');
  else drawHud(ctx, g, w, h);
}

function announce(message) {
  status.textContent = message;
}

function startNewGame() {
  clearSave();
  game.money = 0;
  game.faresDone = 0;
  game.packages = 0;
  resetWorld(game);
  startMission(game, 0);
  game.mode = 'play';
  game.overKind = null;
  audio.ensure();
  audio.musicStart();
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
