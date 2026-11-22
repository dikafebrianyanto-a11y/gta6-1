// Combat: bullets in flight, rival thugs who chase and swing, Dex's bat
// for close work, and the bottles he can hurl when a fight needs range.
// Dex's own punch and pistol live in player.js; this file runs everything
// that flies, gets thrown, or fights back.
//
// The two new weapons:
// - The bat (batSwing): a wide, slow swing that hits harder than a punch
//   and knocks whoever it catches flying backwards. No ammo, just timing.
// - The thrown bottle (throwBottle): a lobbed projectile that shatters on
//   whatever it hits, hurting the target and splashing glass over everyone
//   standing close by. It flies on the same bullet list as gunfire, marked
//   with kind 'bottle', so it needs no new plumbing to travel or collide.
import { COMBAT } from './config.js';
import { burst, floatText } from './effects.js';
import { hurtEnemy, hurtPlayer } from './player.js';

// The bat: longer reach than a fist, a wider arc, real knockback, and a
// slower recovery so it cannot be spammed like punches.
const BAT_RANGE = 54;
const BAT_ARC = 1.25;
const BAT_DAMAGE = 26;
const BAT_KNOCKBACK = 110;
const BAT_COOLDOWN = 0.55;

// The bottle: a short-range lob with a splash. The direct hit hurts, and
// anyone caught in the shatter takes splash damage too.
const BOTTLE_SPEED = 430;
const BOTTLE_RANGE = 280;
const BOTTLE_DAMAGE = 20;
const BOTTLE_SPLASH = 12;
const BOTTLE_SPLASH_RADIUS = 70;
const THROW_COOLDOWN = 0.7;

/** A fresh combat state: no bullets, no thugs, no bottle in the air. */
export function createCombat() {
  return {
    bullets: [],
    enemies: [],
    gunshotTimer: 0,
    throwTimer: 0,
  };
}

/** Spawn rival thugs at (x, y): they chase Dex and swing at him. */
export function spawnThugs(g, x, y, count, armed = false) {
  for (let i = 0; i < count; i += 1) {
    g.enemies.push({
      kind: 'thug',
      x: x + (Math.random() - 0.5) * 90,
      y: y + (Math.random() - 0.5) * 90,
      hp: COMBAT.thugHp,
      alive: true,
      speed: COMBAT.thugSpeed * (0.9 + Math.random() * 0.25),
      punchTimer: 0,
      shootTimer: Math.random() * 2,
      armed,
      angle: 0,
    });
  }
}

/** Smallest turn between two headings, always 0..PI. */
function angleGap(a, b) {
  let diff = Math.abs(a - b);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  return diff;
}

/**
 * Swing the bat: a wide arc in front of Dex that hits hard and shoves
 * everyone it catches backwards.
 *
 * On foot only, and it shares the punch cooldown slot on the player, so
 * Dex cannot bat and punch in the same beat. Anyone inside the range and
 * arc takes the damage, gets knocked BAT_KNOCKBACK away from Dex along
 * the street (walls stop the slide), and the swing announces itself.
 * Returns true when the swing happened, false when Dex could not swing.
 */
export function batSwing(g) {
  const p = g.player;
  if (p.inCar || p.punchTimer > 0) return false;
  p.punchTimer = BAT_COOLDOWN;
  g.audio.punch();
  const reachX = p.x + Math.cos(p.angle) * BAT_RANGE;
  const reachY = p.y + Math.sin(p.angle) * BAT_RANGE;
  burst(g.fx, reachX, reachY, { count: 7, color: '#ffffff', speed: 120, life: 0.25, size: 3 });
  let connected = false;
  for (const e of g.enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > BAT_RANGE + 14) continue;
    const bearing = Math.atan2(e.y - p.y, e.x - p.x);
    if (angleGap(bearing, p.angle) > BAT_ARC) continue;
    hurtEnemy(g, e, BAT_DAMAGE, 'bat');
    if (!e.alive) continue;
    // Knockback: shove the survivor straight away from Dex. The city
    // slide keeps them out of the walls while they fly.
    const away = Math.atan2(e.y - p.y, e.x - p.x);
    const pos = g.city.slide(e.x, e.y, 12, Math.cos(away) * BAT_KNOCKBACK, Math.sin(away) * BAT_KNOCKBACK);
    e.x = pos.x;
    e.y = pos.y;
    connected = true;
  }
  if (connected) floatText(g.fx, p.x, p.y - 26, 'WHACK!', '#ffd94d');
  return true;
}

/**
 * Hurl a bottle in the direction Dex is facing (or toward the mouse when
 * aiming with it). The bottle is a friendly projectile with kind
 * 'bottle': it flies slower and shorter than a bullet, shatters on the
 * first thing it meets, and splashes everyone nearby.
 *
 * On foot only, with its own cooldown kept on the player (throwTimer,
 * started lazily so older saves and test rigs without the field still
 * work). Returns true when a bottle left Dex's hand.
 */
export function throwBottle(g) {
  const p = g.player;
  if (p.inCar) return false;
  if (p.throwTimer === undefined) p.throwTimer = 0;
  if (p.throwTimer > 0) return false;
  p.throwTimer = THROW_COOLDOWN;
  let angle = p.angle;
  if (g.input.mouseDown || g.aimMouse) {
    const wx = g.camera.x + g.input.mouseX;
    const wy = g.camera.y + g.input.mouseY;
    angle = Math.atan2(wy - p.y, wx - p.x);
    p.angle = angle;
  }
  g.audio.punch();
  const mx = p.x + Math.cos(angle) * 22;
  const my = p.y + Math.sin(angle) * 22;
  burst(g.fx, mx, my, { count: 4, color: '#7ec850', speed: 140, life: 0.2, size: 2 });
  g.bullets.push({
    x: mx,
    y: my,
    vx: Math.cos(angle) * BOTTLE_SPEED,
    vy: Math.sin(angle) * BOTTLE_SPEED,
    left: BOTTLE_RANGE,
    friendly: true,
    damage: BOTTLE_DAMAGE,
    kind: 'bottle',
  });
  return true;
}

/**
 * Shatter a bottle at (x, y): glass flies, and every living enemy inside
 * the splash radius takes splash damage. The direct target, already hurt
 * by the impact, is skipped so they are not charged twice.
 */
function splashBottle(g, x, y, direct) {
  burst(g.fx, x, y, { count: 10, color: '#7ec850', speed: 180, life: 0.4, size: 3 });
  for (const e of g.enemies) {
    if (!e.alive || e === direct) continue;
    if (Math.hypot(e.x - x, e.y - y) < BOTTLE_SPLASH_RADIUS) {
      hurtEnemy(g, e, BOTTLE_SPLASH, 'bottle');
    }
  }
}

/** Does this projectile overlap a car body? Returns the car or null. */
function carHitBy(g, b, skip) {
  for (const car of g.cars) {
    if (car === skip) continue;
    const dx = b.x - car.x;
    const dy = b.y - car.y;
    const along = dx * Math.sin(car.angle) + dy * -Math.cos(car.angle);
    const across = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    if (Math.abs(along) < car.h / 2 && Math.abs(across) < car.w / 2) return car;
  }
  return null;
}

/** Step one projectile: move it, and resolve whatever it meets. */
function stepProjectile(g, b, dt) {
  const p = g.player;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.left -= Math.hypot(b.vx, b.vy) * dt;
  const isBottle = b.kind === 'bottle';
  if (b.left <= 0) return true;
  if (g.city.pointSolid(b.x, b.y, 1)) {
    if (isBottle) splashBottle(g, b.x, b.y, null);
    else burst(g.fx, b.x, b.y, { count: 3, color: '#c9bfa9', speed: 60, life: 0.2, size: 2 });
    return true;
  }
  if (b.friendly) {
    for (const e of g.enemies) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - b.x, e.y - b.y) >= 16) continue;
      hurtEnemy(g, e, b.damage, isBottle ? 'bottle' : 'shot');
      if (isBottle) splashBottle(g, b.x, b.y, e);
      return true;
    }
  } else if (Math.hypot(p.x - b.x, p.y - b.y) < 14 && !p.inCar) {
    hurtPlayer(g, b.damage, 'shot');
    return true;
  }
  // A bullet can also punch a hole in a parked car. A bottle just breaks
  // against the paintwork and leaves glass behind.
  const car = carHitBy(g, b, p.inCar);
  if (car) {
    if (isBottle) splashBottle(g, b.x, b.y, null);
    else {
      car.hp -= b.damage / 4;
      burst(g.fx, b.x, b.y, { count: 4, color: '#ffb347', speed: 90, life: 0.25, size: 2 });
    }
    return true;
  }
  return false;
}

/** One armed thug's shot at Dex, with muzzle flash and a gunshot echo. */
function thugShoot(g, e) {
  e.shootTimer = 1.4 + Math.random();
  g.audio.shot();
  g.gunshotTimer = 1.2;
  g.bullets.push({
    x: e.x + Math.cos(e.angle) * 20,
    y: e.y + Math.sin(e.angle) * 20,
    vx: Math.cos(e.angle) * COMBAT.bulletSpeed,
    vy: Math.sin(e.angle) * COMBAT.bulletSpeed,
    left: COMBAT.bulletRange,
    friendly: false,
    damage: 12,
    kind: 'bullet',
  });
  burst(g.fx, e.x + Math.cos(e.angle) * 22, e.y + Math.sin(e.angle) * 22, { count: 4, color: '#ffd94d', speed: 160, life: 0.1, size: 2 });
}

/** One enemy's step: chase Dex, shoot from range, or swing up close. */
function stepEnemy(g, e, dt) {
  const p = g.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy);
  e.angle = Math.atan2(dy, dx);
  if (e.punchTimer > 0) e.punchTimer -= dt;
  if (e.shootTimer > 0) e.shootTimer -= dt;
  if (p.inCar) {
    // Thugs cannot catch a car; they give up and mill about.
    if (dist > 500) return;
    const pos = g.city.slide(e.x, e.y, 12, (dx / (dist || 1)) * e.speed * 0.5 * dt, (dy / (dist || 1)) * e.speed * 0.5 * dt);
    e.x = pos.x;
    e.y = pos.y;
    return;
  }
  if (e.armed && dist < 420 && dist > 90 && e.shootTimer <= 0) {
    thugShoot(g, e);
    return;
  }
  if (dist > 26) {
    const pos = g.city.slide(e.x, e.y, 12, (dx / (dist || 1)) * e.speed * dt, (dy / (dist || 1)) * e.speed * dt);
    e.x = pos.x;
    e.y = pos.y;
    return;
  }
  if (e.punchTimer <= 0) {
    e.punchTimer = 0.9;
    g.audio.punch();
    hurtPlayer(g, COMBAT.thugPunch, 'thug');
    floatText(g.fx, p.x, p.y - 26, 'Ouch!', '#ff5a3c');
  }
}

/** One combat step: bullets fly, thugs hunt, the gunshot echo fades. */
export function updateCombat(g, dt) {
  const p = g.player;
  if (g.gunshotTimer > 0) g.gunshotTimer -= dt;
  if (p.throwTimer > 0) p.throwTimer -= dt;
  for (let i = g.bullets.length - 1; i >= 0; i -= 1) {
    if (stepProjectile(g, g.bullets[i], dt)) g.bullets.splice(i, 1);
  }
  for (const e of g.enemies) {
    if (e.alive) stepEnemy(g, e, dt);
  }
  g.enemies = g.enemies.filter((e) => e.alive);
}
