// Juice: particles, skid marks, floating text and screen shake. All of it is
// cheap canvas work, and all of it is fire-and-forget: spawn it, the update
// ages it out, the renderer draws what is left.
import { TILE } from './config.js';

/** A fresh effects bag: particles, skid decals, floating labels, shake. */
export function createEffects() {
  return {
    particles: [],
    skids: [],
    texts: [],
    shake: 0,
    shakeX: 0,
    shakeY: 0,
  };
}

/** A burst of sparks, smoke or blood at (x, y). */
export function burst(fx, x, y, opts = {}) {
  const count = opts.count ?? 10;
  const color = opts.color ?? '#ffb347';
  const speed = opts.speed ?? 160;
  const life = opts.life ?? 0.5;
  const size = opts.size ?? 3;
  const up = opts.up ?? 0;
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    fx.particles.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - up,
      life: life * (0.6 + Math.random() * 0.6),
      maxLife: life,
      size: size * (0.6 + Math.random() * 0.8),
      color,
    });
  }
}

/** A short skid-mark segment under a sliding car. */
export function skidMark(fx, car) {
  const back = car.h / 2 - 6;
  const side = car.w / 2 - 4;
  const fxw = Math.sin(car.angle);
  const fyw = -Math.cos(car.angle);
  const rx = Math.cos(car.angle);
  const ry = Math.sin(car.angle);
  for (const s of [-1, 1]) {
    fx.skids.push({
      x: car.x - fxw * back + rx * side * s,
      y: car.y - fyw * back + ry * side * s,
      angle: car.angle,
      life: 6,
    });
  }
  if (fx.skids.length > 400) fx.skids.splice(0, fx.skids.length - 400);
}

/** A label that rises and fades above the world. */
export function floatText(fx, x, y, text, color = '#ffffff') {
  fx.texts.push({ x, y, text, color, life: 1.2 });
}

/** A camera jolt; bigger numbers hit harder. */
export function shake(fx, amount) {
  fx.shake = Math.min(14, fx.shake + amount);
}

/** Age every effect by dt; shake settles into a fresh random offset. */
export function updateEffects(fx, dt) {
  for (let i = fx.particles.length - 1; i >= 0; i -= 1) {
    const p = fx.particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 2.4 * dt;
    p.vy *= 1 - 2.4 * dt;
    if (p.life <= 0) fx.particles.splice(i, 1);
  }
  for (let i = fx.skids.length - 1; i >= 0; i -= 1) {
    fx.skids[i].life -= dt;
    if (fx.skids[i].life <= 0) fx.skids.splice(i, 1);
  }
  for (let i = fx.texts.length - 1; i >= 0; i -= 1) {
    const t = fx.texts[i];
    t.life -= dt;
    t.y -= 34 * dt;
    if (t.life <= 0) fx.texts.splice(i, 1);
  }
  fx.shake = Math.max(0, fx.shake - 30 * dt);
  fx.shakeX = (Math.random() * 2 - 1) * fx.shake;
  fx.shakeY = (Math.random() * 2 - 1) * fx.shake;
}

/** Draw every live effect in world space. */
export function drawEffects(ctx, fx) {
  for (const s of fx.skids) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, s.life / 6 + 0.15);
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.fillStyle = '#1a1816';
    ctx.fillRect(-2, -7, 4, 14);
    ctx.restore();
  }
  for (const p of fx.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(TILE * 0.42)}px system-ui, sans-serif`;
  for (const t of fx.texts) {
    ctx.globalAlpha = Math.min(1, t.life);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}
