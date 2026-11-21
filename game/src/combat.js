// Combat: bullets in flight, rival thugs who chase and swing, and the
// little rules that make a street fight feel fair. Dex's own punch and
// pistol live in player.js; this file runs everything that flies or fights
// back.
import { COMBAT } from './config.js';
import { burst, floatText } from './effects.js';
import { hurtEnemy, hurtPlayer } from './player.js';

/** A fresh combat state: no bullets, no thugs. */
export function createCombat() {
  return {
    bullets: [],
    enemies: [],
    gunshotTimer: 0,
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

/** One combat step: bullets fly, thugs hunt, the gunshot echo fades. */
export function updateCombat(g, dt) {
  const p = g.player;
  if (g.gunshotTimer > 0) g.gunshotTimer -= dt;

  for (let i = g.bullets.length - 1; i >= 0; i -= 1) {
    const b = g.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.left -= Math.hypot(b.vx, b.vy) * dt;
    let dead = b.left <= 0 || g.city.pointSolid(b.x, b.y, 1);
    if (dead && g.city.pointSolid(b.x, b.y, 1)) {
      burst(g.fx, b.x, b.y, { count: 3, color: '#c9bfa9', speed: 60, life: 0.2, size: 2 });
    }
    if (!dead) {
      if (b.friendly) {
        for (const e of g.enemies) {
          if (!e.alive) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) < 16) {
            hurtEnemy(g, e, b.damage, 'shot');
            dead = true;
            break;
          }
        }
      } else if (Math.hypot(p.x - b.x, p.y - b.y) < 14 && !p.inCar) {
        hurtPlayer(g, b.damage, 'shot');
        dead = true;
      }
      // A bullet can also punch a hole in a parked car.
      if (!dead) {
        for (const car of g.cars) {
          if (car === p.inCar) continue;
          const dx = b.x - car.x;
          const dy = b.y - car.y;
          const along = dx * Math.sin(car.angle) + dy * -Math.cos(car.angle);
          const across = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
          if (Math.abs(along) < car.h / 2 && Math.abs(across) < car.w / 2) {
            car.hp -= b.damage / 4;
            burst(g.fx, b.x, b.y, { count: 4, color: '#ffb347', speed: 90, life: 0.25, size: 2 });
            dead = true;
            break;
          }
        }
      }
    }
    if (dead) g.bullets.splice(i, 1);
  }

  for (const e of g.enemies) {
    if (!e.alive) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy);
    e.angle = Math.atan2(dy, dx);
    if (e.punchTimer > 0) e.punchTimer -= dt;
    if (e.shootTimer > 0) e.shootTimer -= dt;
    if (p.inCar) {
      // Thugs cannot catch a car; they give up and mill about.
      if (dist > 500) continue;
      const pos = g.city.slide(e.x, e.y, 12, (dx / (dist || 1)) * e.speed * 0.5 * dt, (dy / (dist || 1)) * e.speed * 0.5 * dt);
      e.x = pos.x;
      e.y = pos.y;
      continue;
    }
    if (e.armed && dist < 420 && dist > 90 && e.shootTimer <= 0) {
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
      });
      burst(g.fx, e.x + Math.cos(e.angle) * 22, e.y + Math.sin(e.angle) * 22, { count: 4, color: '#ffd94d', speed: 160, life: 0.1, size: 2 });
    } else if (dist > 26) {
      const pos = g.city.slide(e.x, e.y, 12, (dx / (dist || 1)) * e.speed * dt, (dy / (dist || 1)) * e.speed * dt);
      e.x = pos.x;
      e.y = pos.y;
    } else if (e.punchTimer <= 0) {
      e.punchTimer = 0.9;
      g.audio.punch();
      hurtPlayer(g, COMBAT.thugPunch, 'thug');
      floatText(g.fx, p.x, p.y - 26, 'Ouch!', '#ff5a3c');
    }
  }
  g.enemies = g.enemies.filter((e) => e.alive);
}
