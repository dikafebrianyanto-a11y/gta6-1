// The law: a wanted level, police cars that hunt the player down, foot
// cops who try to make the arrest, and — once the heat gets serious —
// roadblocks parked across the road ahead to cut off the escape. Stars
// climb when Dex is seen doing wrong and fade when he stays out of sight;
// a cop's touch at low speed is a bust.
//
// Difficulty shapes the whole force through the DIFFICULTY preset on the
// game state (g.difficulty, easy / normal / hard, defaulting to normal):
// policeAggression speeds up spawning and the chase, and
// wantedDecaySeconds sets how long Dex must stay unseen before a star
// fades. The preset is resolved fresh every tick, so changing difficulty
// mid-game takes effect immediately.
import { DEFAULT_DIFFICULTY, DIFFICULTY, WANTED } from './config.js';
import { makeCar, separateCars } from './vehicles.js';
import { burst, floatText, shake } from './effects.js';
import { collideCarWithCity, hurtPlayer } from './player.js';

// Roadblocks only exist once the heat is serious, and they are built from
// two cruisers parked nose-to-tail across the road, long axis across the
// lane so there is no gap to thread between them.
const ROADBLOCK_MIN_STARS = 3;
const ROADBLOCK_CARS = 2;
const ROADBLOCK_SPACING = 46;
const ROADBLOCK_AHEAD = 430;
const ROADBLOCK_DESPAWN_DIST = 1000;

// How the chase itself is tuned. Spawn waves arrive faster, and cruisers
// run harder, the more aggressive the preset.
const SPAWN_INTERVAL_BASE = 1.6;
const CHASE_BASE_SPEED = 300;
const CHASE_PER_STAR = 45;
const CHASE_TOP_SPEED = 560;
const FOOT_COP_SPEED = 185;

/**
 * Resolve the difficulty preset for this game state. Reads g.difficulty
 * first (the name the save persists), then the settings/options spots the
 * HUD also checks, and falls back to the default preset for anything
 * missing or misspelled — never crash on a bad difficulty value.
 */
function difficultyPreset(g) {
  const raw = g.difficulty ?? g.settings?.difficulty ?? g.options?.difficulty;
  const key = typeof raw === 'string' ? raw.toLowerCase() : '';
  return DIFFICULTY[key] ?? DIFFICULTY[DEFAULT_DIFFICULTY];
}

/** Wrap any angle difference into the -PI..PI range. */
function wrapAngle(diff) {
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Can this cop see the player, with buildings in the way checked? */
function copCanSee(g, x, y, px, py) {
  return Math.hypot(x - px, y - py) < WANTED.sightRange && !g.city.sightBlocked(x, y, px, py);
}

/** A fresh police force: no heat, no cops on the street, no roadblocks. */
export function createPolice() {
  return {
    cars: [],
    foot: [],
    spawnTimer: 0,
    sirenNear: false,
    roadblocks: [],
    roadblockTimer: 0,
  };
}

/** How many cars and foot cops the current stars call for. */
function quotaForStars(stars) {
  const level = Math.min(stars, WANTED.max);
  return {
    cars: WANTED.carsPerStar[level],
    foot: WANTED.footPerStar[level],
  };
}

/** A police car rolling in from the edge of the player's view. */
function spawnCopCar(g) {
  const p = g.player;
  const angle = Math.random() * Math.PI * 2;
  const dist = 700 + Math.random() * 300;
  const clampedX = Math.max(60, Math.min(3072 - 60, p.x + Math.cos(angle) * dist));
  const clampedY = Math.max(60, Math.min(3072 - 60, p.y + Math.sin(angle) * dist));
  const spot = g.city.nearestRoad(clampedX, clampedY);
  const car = makeCar('police', spot.x, spot.y, Math.atan2(p.x - spot.x, -(p.y - spot.y)), '#22252a');
  car.occupied = true;
  car.driver = { kind: 'cop' };
  car.cruise = 320;
  car.blocked = 0;
  g.police.cars.push(car);
  g.cars.push(car);
  return car;
}

/** A foot cop appearing a block away, running in. */
function spawnFootCop(g, preset) {
  const p = g.player;
  const angle = Math.random() * Math.PI * 2;
  const cop = {
    kind: 'cop',
    x: p.x + Math.cos(angle) * 420,
    y: p.y + Math.sin(angle) * 420,
    hp: 60,
    alive: true,
    speed: FOOT_COP_SPEED * preset.policeAggression,
    punchTimer: 0,
    angle: 0,
  };
  g.police.foot.push(cop);
  g.enemies.push(cop);
  return cop;
}

/**
 * Park a roadblock across the road ahead of the player.
 *
 * Two cruisers are placed on the nearest road a little way ahead of Dex's
 * direction of travel, side by side across the lane (their long axis
 * perpendicular to his heading), so the only way through is around them
 * or through them. Both cars join g.cars, so the renderer draws them, the
 * city's car collision stops Dex's car on them, and bullets can wreck
 * them like any other police car.
 */
export function spawnRoadblock(g) {
  const pol = g.police;
  const p = g.player;
  const heading = p.inCar ? p.inCar.angle : p.angle;
  const forwardX = Math.sin(heading);
  const forwardY = -Math.cos(heading);
  const anchorX = p.x + forwardX * ROADBLOCK_AHEAD;
  const anchorY = p.y + forwardY * ROADBLOCK_AHEAD;
  const spot = g.city.nearestRoad(anchorX, anchorY);
  // Across the road: rotate the heading by 90 degrees. A car's forward
  // vector is (sin a, -cos a), so facing across the road means
  // a = heading + PI / 2.
  const acrossAngle = heading + Math.PI / 2;
  const perpX = Math.cos(heading);
  const perpY = Math.sin(heading);
  const placed = [];
  for (let i = 0; i < ROADBLOCK_CARS; i += 1) {
    const offset = (i - (ROADBLOCK_CARS - 1) / 2) * ROADBLOCK_SPACING;
    const car = makeCar('police', spot.x + perpX * offset, spot.y + perpY * offset, acrossAngle, '#22252a');
    car.occupied = true;
    car.driver = { kind: 'cop' };
    car.cruise = 0;
    car.speed = 0;
    car.blocked = 0;
    car.roadblock = true;
    pol.roadblocks.push(car);
    g.cars.push(car);
    placed.push(car);
  }
  floatText(g.fx, spot.x, spot.y - 40, 'ROADBLOCK AHEAD!', '#ff5a3c');
  return placed;
}

/** Pull one roadblock car out of the world (wrecked, dodged, or stood down). */
function removeRoadblockCar(g, car) {
  const pol = g.police;
  const inWorld = g.cars.indexOf(car);
  if (inWorld !== -1) g.cars.splice(inWorld, 1);
  const inBlock = pol.roadblocks.indexOf(car);
  if (inBlock !== -1) pol.roadblocks.splice(inBlock, 1);
}

/** Stand every roadblock down and clear the timer. */
export function clearRoadblocks(g) {
  const pol = g.police;
  for (const car of [...pol.roadblocks]) removeRoadblockCar(g, car);
  pol.roadblocks = [];
  pol.roadblockTimer = 0;
}

/**
 * One roadblock step: keep a block ahead of Dex while the heat stays at
 * three stars or more, and take it away when it does not.
 *
 * A fresh block is laid when none is standing and the timer has run out;
 * the timer runs faster on more aggressive presets, so hard mode rebuilds
 * the trap sooner. A block is abandoned when Dex gets far away from it
 * (he slipped around it or turned off), and wrecked cruisers are hauled
 * away instead of lingering as ghosts.
 */
export function updateRoadblocks(g, dt) {
  const pol = g.police;
  const preset = difficultyPreset(g);
  if (g.wanted < ROADBLOCK_MIN_STARS) {
    if (pol.roadblocks.length > 0) clearRoadblocks(g);
    return;
  }
  const p = g.player;
  for (let i = pol.roadblocks.length - 1; i >= 0; i -= 1) {
    const car = pol.roadblocks[i];
    if (car.hp <= 0) {
      burst(g.fx, car.x, car.y, { count: 14, color: '#ff5a3c', speed: 200, life: 0.6, size: 4 });
      removeRoadblockCar(g, car);
    }
  }
  if (pol.roadblocks.length > 0) {
    const block = pol.roadblocks[0];
    const away = Math.hypot(block.x - p.x, block.y - p.y);
    if (away > ROADBLOCK_DESPAWN_DIST) {
      clearRoadblocks(g);
      pol.roadblockTimer = 4 / preset.policeAggression;
    }
    return;
  }
  pol.roadblockTimer -= dt;
  if (pol.roadblockTimer <= 0) {
    spawnRoadblock(g);
    pol.roadblockTimer = 10 / preset.policeAggression;
  }
}

/** Fade one star after the preset's unseen-seconds have passed. */
function fadeWantedIfUnseen(g, dt, seen, preset) {
  if (g.wanted <= 0) return;
  if (seen) {
    g.wantedTimer = 0;
    return;
  }
  g.wantedTimer += dt;
  if (g.wantedTimer < preset.wantedDecaySeconds) return;
  g.wantedTimer = 0;
  g.wanted -= 1;
  const p = g.player;
  floatText(g.fx, p.inCar ? p.inCar.x : p.x, (p.inCar ? p.inCar.y : p.y) - 30, 'Heat cooling…', '#9fd6ff');
}

/** Steer one chasing cruiser at the player, ramming when it connects. */
function stepChaseCar(g, car, dt, px, py, preset) {
  const p = g.player;
  const dist = Math.hypot(px - car.x, py - car.y);
  let targetX = px;
  let targetY = py;
  if (car.blocked > 0) {
    // A wall in the way sends the car to the nearest junction first, so
    // the chase goes around the block instead of through the building.
    car.blocked -= dt;
    const node = g.city.nearestRoad(car.x, car.y);
    targetX = node.x;
    targetY = node.y;
  }
  const wantAngle = Math.atan2(targetX - car.x, -(targetY - car.y));
  const diff = wrapAngle(wantAngle - car.angle);
  car.angle += Math.max(-3.4 * dt, Math.min(3.4 * dt, diff));
  const cruise = Math.min(CHASE_TOP_SPEED, (CHASE_BASE_SPEED + g.wanted * CHASE_PER_STAR) * preset.policeAggression);
  car.speed += Math.max(-500 * dt, Math.min(420 * dt, cruise - car.speed));
  car.x += Math.sin(car.angle) * car.speed * dt;
  car.y += -Math.cos(car.angle) * car.speed * dt;
  // Corners, not just the centre: a cop car is as wide as any other.
  if (collideCarWithCity(g, car)) car.blocked = 1.2;
  if (car.ramTimer > 0) car.ramTimer -= dt;
  if (dist < 46 && Math.abs(car.speed) > 120 && car.ramTimer <= 0) {
    // A hard ram hurts Dex's car and shakes the camera — but one hit only
    // counts once, so a cop leaning on the door cannot shred it in a second.
    car.ramTimer = 0.8;
    if (p.inCar) {
      p.inCar.hp -= 6;
      p.inCar.speed *= 0.55;
      shake(g.fx, 5);
      g.audio.crash();
      burst(g.fx, car.x, car.y, { count: 8, color: '#ffb347', speed: 160, life: 0.4, size: 3 });
      car.speed *= 0.4;
    }
  }
  if (!p.inCar && dist < WANTED.bustRange && Math.abs(car.speed) < WANTED.bustSpeed) {
    g.events.push('busted');
  }
}

/** Run one foot cop down toward Dex and try to cuff him. */
function stepFootCop(g, cop, dt) {
  const p = g.player;
  const dx = p.x - cop.x;
  const dy = p.y - cop.y;
  const dist = Math.hypot(dx, dy);
  cop.angle = Math.atan2(dy, dx);
  const pos = g.city.slide(cop.x, cop.y, 12, (dx / (dist || 1)) * cop.speed * dt, (dy / (dist || 1)) * cop.speed * dt);
  cop.x = pos.x;
  cop.y = pos.y;
  if (cop.punchTimer > 0) cop.punchTimer -= dt;
  if (dist < 30 && cop.punchTimer <= 0) {
    cop.punchTimer = 0.9;
    hurtPlayer(g, 12, 'cop');
    floatText(g.fx, p.x, p.y - 26, 'Stop right there!', '#ff5a3c');
  }
  if (!p.inCar && dist < WANTED.bustRange && p.speed < WANTED.bustSpeed) {
    g.events.push('busted');
  }
  if (dist > 1500) cop.alive = false;
}

/** One police step: spawn to quota, chase, ram, arrest, fade. */
export function updatePolice(g, dt) {
  const pol = g.police;
  const p = g.player;
  const preset = difficultyPreset(g);
  const px = p.inCar ? p.inCar.x : p.x;
  const py = p.inCar ? p.inCar.y : p.y;
  const quota = quotaForStars(g.wanted);

  // Spawn toward the quota, a little at a time so they arrive in waves.
  // Aggressive presets wave them in faster.
  pol.spawnTimer -= dt;
  if (g.wanted > 0 && pol.spawnTimer <= 0) {
    pol.spawnTimer = SPAWN_INTERVAL_BASE / preset.policeAggression;
    if (pol.cars.length < quota.cars) spawnCopCar(g);
    else if (pol.foot.length < quota.foot && !p.inCar) spawnFootCop(g, preset);
  }

  // Heat fades when no cop can see Dex, after the preset's unseen time.
  let seen = false;
  for (const car of pol.cars) {
    if (copCanSee(g, car.x, car.y, px, py)) seen = true;
  }
  for (const cop of pol.foot) {
    if (copCanSee(g, cop.x, cop.y, px, py)) seen = true;
  }
  pol.sirenNear = seen || pol.cars.length > 0;
  fadeWantedIfUnseen(g, dt, seen, preset);

  // Roadblocks go up (and come down) with the heat.
  updateRoadblocks(g, dt);

  // Police cars: steer at Dex, ram to stop him.
  for (let i = pol.cars.length - 1; i >= 0; i -= 1) {
    const car = pol.cars[i];
    const dist = Math.hypot(px - car.x, py - car.y);
    stepChaseCar(g, car, dt, px, py, preset);
    // A wrecked or far-off cop car gives up and leaves.
    if (car.hp <= 0 || dist > 1600) {
      car.occupied = false;
      const idx = g.cars.indexOf(car);
      if (idx !== -1) g.cars.splice(idx, 1);
      pol.cars.splice(i, 1);
    }
  }
  for (let i = 0; i < pol.cars.length; i += 1) {
    for (let j = i + 1; j < pol.cars.length; j += 1) {
      if (Math.abs(pol.cars[i].x - pol.cars[j].x) < 44 && Math.abs(pol.cars[i].y - pol.cars[j].y) < 44) {
        separateCars(pol.cars[i], pol.cars[j]);
      }
    }
  }

  // Foot cops: run Dex down and try to cuff him.
  for (let i = pol.foot.length - 1; i >= 0; i -= 1) {
    const cop = pol.foot[i];
    if (!cop.alive) {
      pol.foot.splice(i, 1);
      continue;
    }
    stepFootCop(g, cop, dt);
    if (!cop.alive) pol.foot.splice(i, 1);
  }

  // When the heat is gone, the street empties — cruisers, foot cops, and
  // any roadblock still standing.
  if (g.wanted === 0) {
    for (const car of pol.cars) {
      const idx = g.cars.indexOf(car);
      if (idx !== -1) g.cars.splice(idx, 1);
    }
    pol.cars = [];
    for (const cop of pol.foot) cop.alive = false;
    pol.foot = [];
    clearRoadblocks(g);
  }
}
