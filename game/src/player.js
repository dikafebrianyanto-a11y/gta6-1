// Dex on foot — and in the driver's seat. The player is a circle with a
// facing; a car he drives is a separate entity he sits in, and getting out
// puts him back on the pavement beside it. This file owns everything Dex
// does himself: walking and sprinting, punching and shooting, taking a
// hit, raising the heat, and climbing in and out of rides.
import { COMBAT, HEAT, PLAYER } from './config.js';
import { carsOverlap, separateCars } from './vehicles.js';
import { burst, floatText } from './effects.js';

// --- Sprint stamina -----------------------------------------------------
// Sprinting is fast but finite: the meter drains while Dex runs and refills
// while he walks or stands. Run it dry and he is winded — sprint stays
// locked out until the meter climbs back past the floor, so the player
// cannot flutter the key to cheat the drain.
const STAMINA_MAX = 100;
const STAMINA_DRAIN = 28;
const STAMINA_REGEN = 18;
const STAMINA_FLOOR = 15;

// --- Combat timing ------------------------------------------------------
const PUNCH_DURATION = 0.32;
const HURT_FLASH = 0.4;
const MERCY_WINDOW = 0.35;
const AMMO_DROP_CHANCE = 0.4;
const AMMO_DROP_AMOUNT = 6;

// --- Small helpers ------------------------------------------------------

/** Smallest signed angle between two headings, in (-PI, PI]. */
function angleBetween(a, b) {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Count a timer down by dt, never below zero. */
function tick(timer, dt) {
  return timer > 0 ? Math.max(0, timer - dt) : 0;
}

/** Where Dex's fist (or muzzle) is, a reach straight ahead of him. */
function reachPoint(p, reach) {
  return {
    x: p.x + Math.cos(p.angle) * reach,
    y: p.y + Math.sin(p.angle) * reach,
  };
}

/** A fresh Dex, standing at the marina with a full stamina meter. */
export function createPlayer(x, y) {
  return {
    x,
    y,
    angle: -Math.PI / 2,
    hp: PLAYER.hp,
    ammo: PLAYER.startAmmo,
    speed: 0,
    moving: false,
    sprinting: false,
    stamina: STAMINA_MAX,
    staminaMax: STAMINA_MAX,
    winded: false,
    inCar: null,
    punchTimer: 0,
    shootTimer: 0,
    hurtTimer: 0,
    invuln: 0,
  };
}

/**
 * Decide whether this frame is a sprint, and move the stamina meter.
 * Sprinting needs three things: the key held, Dex actually moving, and
 * a meter that is not empty and not winded. While sprinting the meter
 * drains; otherwise it refills. Hitting zero winds Dex until the meter
 * recovers past the floor.
 */
function updateSprint(p, wantsSprint, moving, dt) {
  const canSprint = wantsSprint && moving && !p.winded && p.stamina > 0;
  p.sprinting = canSprint;
  if (canSprint) {
    p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
    if (p.stamina <= 0) p.winded = true;
  } else {
    p.stamina = Math.min(p.staminaMax, p.stamina + STAMINA_REGEN * dt);
    if (p.winded && p.stamina >= STAMINA_FLOOR) p.winded = false;
  }
  return p.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
}

/** On-foot step: walk where the keys point, slide along walls, manage stamina. */
export function stepPlayerOnFoot(g, dt) {
  const p = g.player;
  const v = g.input.walkVector();
  p.moving = v.x !== 0 || v.y !== 0;
  const speed = updateSprint(p, g.input.sprint, p.moving, dt);
  if (p.moving) {
    p.angle = Math.atan2(v.y, v.x);
    const pos = g.city.slide(p.x, p.y, PLAYER.radius, v.x * speed * dt, v.y * speed * dt);
    p.x = pos.x;
    p.y = pos.y;
    p.speed = speed;
  } else {
    p.speed = 0;
  }
  p.punchTimer = tick(p.punchTimer, dt);
  p.shootTimer = tick(p.shootTimer, dt);
  p.hurtTimer = tick(p.hurtTimer, dt);
  p.invuln = tick(p.invuln, dt);
}

/** A punch in front of Dex: hurts the nearest thug or cop in reach and arc. */
export function playerPunch(g) {
  const p = g.player;
  if (p.inCar || p.punchTimer > 0) return;
  p.punchTimer = PUNCH_DURATION;
  g.audio.punch();
  const fist = reachPoint(p, PLAYER.punchRange);
  burst(g.fx, fist.x, fist.y, { count: 5, color: '#ffffff', speed: 90, life: 0.25, size: 2 });
  for (const e of g.enemies) {
    if (!e.alive) continue;
    const dist = Math.hypot(e.x - p.x, e.y - p.y);
    if (dist > PLAYER.punchRange + 14) continue;
    const toEnemy = Math.atan2(e.y - p.y, e.x - p.x);
    if (Math.abs(angleBetween(toEnemy, p.angle)) > PLAYER.punchArc) continue;
    hurtEnemy(g, e, PLAYER.punchDamage, 'punch');
  }
}

/** Fire the pistol toward the mouse (or the facing, with J). */
export function playerShoot(g) {
  const p = g.player;
  if (p.inCar || p.shootTimer > 0 || p.ammo <= 0) return;
  p.shootTimer = PLAYER.shootCooldown;
  p.ammo -= 1;
  let angle = p.angle;
  if (g.input.mouseDown || g.aimMouse) {
    const wx = g.camera.x + g.input.mouseX;
    const wy = g.camera.y + g.input.mouseY;
    angle = Math.atan2(wy - p.y, wx - p.x);
    p.angle = angle;
  }
  g.audio.shot();
  const muzzle = reachPoint(p, 22);
  burst(g.fx, muzzle.x, muzzle.y, { count: 6, color: '#ffd94d', speed: 200, life: 0.12, size: 2 });
  g.bullets.push({
    x: muzzle.x,
    y: muzzle.y,
    vx: Math.cos(angle) * COMBAT.bulletSpeed,
    vy: Math.sin(angle) * COMBAT.bulletSpeed,
    left: COMBAT.bulletRange,
    friendly: true,
    damage: COMBAT.bulletDamage,
  });
  raiseHeat(g, HEAT.shoot, 'gunfire');
}

/** Damage Dex, with a brief mercy window so one burst cannot melt him. */
export function hurtPlayer(g, amount, source) {
  const p = g.player;
  if (p.invuln > 0 || p.hp <= 0) return;
  p.hp -= amount;
  p.hurtTimer = HURT_FLASH;
  p.invuln = MERCY_WINDOW;
  burst(g.fx, p.x, p.y, { count: 8, color: '#d42b1e', speed: 120, life: 0.4, size: 3 });
  if (p.hp <= 0) {
    p.hp = 0;
    g.events.push(source === 'cop' ? 'busted' : 'wasted');
  }
}

/** Damage a thug or cop; a kill pays heat and sometimes drops ammo. */
export function hurtEnemy(g, e, amount, how) {
  e.hp -= amount;
  burst(g.fx, e.x, e.y, { count: 6, color: '#d42b1e', speed: 110, life: 0.35, size: 3 });
  if (e.hp > 0) return;
  e.alive = false;
  floatText(g.fx, e.x, e.y - 20, how === 'punch' ? 'KO!' : 'Down!', '#ffd94d');
  if (e.kind === 'cop') raiseHeat(g, HEAT.killCop, 'cop down');
  else raiseHeat(g, HEAT.killCivilian, 'thug down');
  if (Math.random() < AMMO_DROP_CHANCE) {
    g.player.ammo = Math.min(PLAYER.maxAmmo, g.player.ammo + AMMO_DROP_AMOUNT);
    floatText(g.fx, e.x, e.y - 36, `+${AMMO_DROP_AMOUNT} ammo`, '#9fd6ff');
  }
}

/** Heat, capped at the wanted max, with a shout when it climbs. */
export function raiseHeat(g, stars, reason) {
  const before = g.wanted;
  g.wanted = Math.min(5, g.wanted + stars);
  g.wantedTimer = 0;
  if (g.wanted > before) {
    floatText(g.fx, g.player.x, g.player.y - 30, `WANTED +${g.wanted - before}`, '#ff5a3c');
  }
  void reason;
}

/** The nearest ride Dex can climb into, within reach. Occupied cop cars are off limits. */
export function nearestCar(g, maxDist = 70) {
  let best = null;
  let bestD = maxDist;
  for (const car of g.cars) {
    if (car.type === 'police' && car.occupied) continue;
    const d = Math.hypot(car.x - g.player.x, car.y - g.player.y);
    if (d < bestD) {
      best = car;
      bestD = d;
    }
  }
  return best;
}

/** Throw a car's driver out onto the street, fleeing, when Dex jacks the ride. */
function ejectDriver(g, car) {
  const driver = car.driver;
  if (!driver) return;
  driver.x = car.x + 40;
  driver.y = car.y + 40;
  driver.fleeing = true;
  driver.fleeTimer = 4;
}

/** Step Dex out of a ride onto the pavement beside it. */
function climbOut(p, car) {
  car.occupied = false;
  car.driver = null;
  const side = car.angle + Math.PI / 2;
  p.x = car.x + Math.cos(side) * (car.w / 2 + 18);
  p.y = car.y + Math.sin(side) * (car.w / 2 + 18);
  p.inCar = null;
}

/** Climb into a ride (jack it if someone is driving), or climb out. */
export function toggleCar(g) {
  const p = g.player;
  if (p.inCar) {
    climbOut(p, p.inCar);
    return 'out';
  }
  const car = nearestCar(g);
  if (!car) return 'none';
  if (car.occupied) {
    // Yank the driver out; they run, and the law notices.
    ejectDriver(g, car);
    raiseHeat(g, HEAT.stealOccupied, 'carjack');
    floatText(g.fx, car.x, car.y - 30, 'Carjacked!', '#ff5a3c');
  }
  car.occupied = true;
  car.driver = p;
  p.inCar = car;
  p.x = car.x;
  p.y = car.y;
  return 'in';
}

/** The four corners of a ride, in world space, for wall probing. */
function rideCorners(car) {
  const fx = Math.sin(car.angle);
  const fy = -Math.cos(car.angle);
  const rx = Math.cos(car.angle);
  const ry = Math.sin(car.angle);
  const corners = [];
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    corners.push({
      x: car.x + fx * (car.h / 2) * sy + rx * (car.w / 2) * sx,
      y: car.y + fy * (car.h / 2) * sy + ry * (car.w / 2) * sx,
    });
  }
  return { corners, fx, fy };
}

/** Keep the player's ride inside the city and off the buildings. */
export function collideCarWithCity(g, car) {
  // Probe the ride's four corners against walls; a hit stops the ride.
  const { corners, fx, fy } = rideCorners(car);
  const hitWall = corners.some((c) => g.city.pointSolid(c.x, c.y, 2));
  if (!hitWall) return false;
  // Back the ride out along its travel and bleed its speed.
  car.x -= fx * car.speed * 0.05;
  car.y -= fy * car.speed * 0.05;
  const impact = Math.abs(car.speed);
  car.speed *= -0.25;
  if (impact > 200) {
    g.audio.crash();
    burst(g.fx, car.x, car.y, { count: 12, color: '#ffb347', speed: 200, life: 0.5, size: 3 });
    car.hp -= Math.round((impact - 200) / 12);
  }
  return true;
}

/** Rides Dex bumps while driving: shove them aside, and only a hard hit hurts. */
export function collideCarWithCars(g, car) {
  for (const other of g.cars) {
    if (other === car || other === g.player.inCar) continue;
    if (!carsOverlap(car, other)) continue;
    const impact = Math.abs(car.speed);
    // Push both rides out of the overlap so a nudge never becomes a trap.
    separateCars(car, other);
    const cooledDown = !car.lastCrash || g.time - car.lastCrash > 0.4;
    if (impact > 180 && cooledDown) {
      car.lastCrash = g.time;
      g.audio.crash();
      const midX = (car.x + other.x) / 2;
      const midY = (car.y + other.y) / 2;
      burst(g.fx, midX, midY, { count: 10, color: '#ffb347', speed: 180, life: 0.4, size: 3 });
      car.speed *= 0.6;
    }
  }
}
