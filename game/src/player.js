// Dex on foot: walking, sprinting, punching, shooting, and the car-jack.
// The player is a circle with a facing; a car he drives is a separate
// entity he sits in, and getting out puts him back on the pavement beside it.
import { COMBAT, HEAT, PLAYER } from './config.js';
import { carsOverlap, separateCars } from './vehicles.js';
import { burst, floatText } from './effects.js';

/** A fresh Dex, standing at the marina. */
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
    inCar: null,
    punchTimer: 0,
    shootTimer: 0,
    hurtTimer: 0,
    invuln: 0,
  };
}

/** On-foot step: walk where the keys point, slide along walls. */
export function stepPlayerOnFoot(g, dt) {
  const p = g.player;
  const v = g.input.walkVector();
  p.moving = v.x !== 0 || v.y !== 0;
  p.sprinting = g.input.sprint && p.moving;
  if (p.moving) {
    const speed = p.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    p.angle = Math.atan2(v.y, v.x);
    const pos = g.city.slide(p.x, p.y, PLAYER.radius, v.x * speed * dt, v.y * speed * dt);
    p.x = pos.x;
    p.y = pos.y;
    p.speed = speed;
  } else {
    p.speed = 0;
  }
  if (p.punchTimer > 0) p.punchTimer -= dt;
  if (p.shootTimer > 0) p.shootTimer -= dt;
  if (p.hurtTimer > 0) p.hurtTimer -= dt;
  if (p.invuln > 0) p.invuln -= dt;
}

/** A punch in front of Dex: hurts the nearest thug or cop in reach. */
export function playerPunch(g) {
  const p = g.player;
  if (p.inCar || p.punchTimer > 0) return;
  p.punchTimer = 0.32;
  g.audio.punch();
  const px = p.x + Math.cos(p.angle) * PLAYER.punchRange;
  const py = p.y + Math.sin(p.angle) * PLAYER.punchRange;
  burst(g.fx, px, py, { count: 5, color: '#ffffff', speed: 90, life: 0.25, size: 2 });
  for (const e of g.enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > PLAYER.punchRange + 14) continue;
    const ang = Math.atan2(e.y - p.y, e.x - p.x);
    let diff = Math.abs(ang - p.angle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff > PLAYER.punchArc) continue;
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
  const mx = p.x + Math.cos(angle) * 22;
  const my = p.y + Math.sin(angle) * 22;
  burst(g.fx, mx, my, { count: 6, color: '#ffd94d', speed: 200, life: 0.12, size: 2 });
  g.bullets.push({
    x: mx,
    y: my,
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
  p.hurtTimer = 0.4;
  p.invuln = 0.35;
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
  if (Math.random() < 0.4) {
    g.player.ammo = Math.min(PLAYER.maxAmmo, g.player.ammo + 6);
    floatText(g.fx, e.x, e.y - 36, '+6 ammo', '#9fd6ff');
  }
}

/** Heat, capped at the wanted max, with a shout when it climbs. */
export function raiseHeat(g, stars, reason) {
  const before = g.wanted;
  g.wanted = Math.min(5, g.wanted + stars);
  g.wantedTimer = 0;
  if (g.wanted > before) floatText(g.fx, g.player.x, g.player.y - 30, 'WANTED +' + (g.wanted - before), '#ff5a3c');
  void reason;
}

/** The nearest car Dex can climb into, within reach. */
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

/** Climb into a car (jack it if someone is driving), or climb out. */
export function toggleCar(g) {
  const p = g.player;
  if (p.inCar) {
    const car = p.inCar;
    car.occupied = false;
    car.driver = null;
    const side = car.angle + Math.PI / 2;
    p.x = car.x + Math.cos(side) * (car.w / 2 + 18);
    p.y = car.y + Math.sin(side) * (car.w / 2 + 18);
    p.inCar = null;
    return 'out';
  }
  const car = nearestCar(g);
  if (!car) return 'none';
  if (car.occupied) {
    // Yank the driver out; they run, and the law notices.
    const driver = car.driver;
    if (driver) {
      driver.x = car.x + 40;
      driver.y = car.y + 40;
      driver.fleeing = true;
      driver.fleeTimer = 4;
    }
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

/** Keep the player's car inside the city and off the buildings. */
export function collideCarWithCity(g, car) {
  // Probe the car's four corners against walls; a hit stops the car.
  const fx = Math.sin(car.angle);
  const fy = -Math.cos(car.angle);
  const rx = Math.cos(car.angle);
  const ry = Math.sin(car.angle);
  let hit = false;
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cx = car.x + fx * (car.h / 2) * sy + rx * (car.w / 2) * sx;
    const cy = car.y + fy * (car.h / 2) * sy + ry * (car.w / 2) * sx;
    if (g.city.pointSolid(cx, cy, 2)) {
      hit = true;
      break;
    }
  }
  if (!hit) return false;
  // Back the car out along its travel and bleed its speed.
  car.x -= fx * car.speed * 0.05;
  car.y -= fy * car.speed * 0.05;
  const before = Math.abs(car.speed);
  car.speed *= -0.25;
  if (before > 200) {
    g.audio.crash();
    burst(g.fx, car.x, car.y, { count: 12, color: '#ffb347', speed: 200, life: 0.5, size: 3 });
    car.hp -= Math.round((before - 200) / 12);
  }
  return true;
}

/** Cars Dex bumps while driving: shove them aside, and only a hard hit hurts. */
export function collideCarWithCars(g, car) {
  for (const other of g.cars) {
    if (other === car || other === g.player.inCar) continue;
    if (!carsOverlap(car, other)) continue;
    const before = Math.abs(car.speed);
    // Push both cars out of the overlap so a nudge never becomes a trap.
    separateCars(car, other);
    if (before > 180 && (!car.lastCrash || g.time - car.lastCrash > 0.4)) {
      car.lastCrash = g.time;
      g.audio.crash();
      burst(g.fx, (car.x + other.x) / 2, (car.y + other.y) / 2, { count: 10, color: '#ffb347', speed: 180, life: 0.4, size: 3 });
      car.speed *= 0.6;
    }
  }
}
