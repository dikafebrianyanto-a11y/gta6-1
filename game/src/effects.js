// Juice: particles, skid marks, floating text and screen shake, plus
// beachfront life — sand kicked up on the shore, glints dancing on the
// water by the pier, and gulls circling overhead. All of it is cheap
// canvas work and fire-and-forget: spawn it, the update ages it out,
// the renderer draws what is left.
import { TILE } from './config.js';

// Particle kinds: 'dot' is a plain fading mote, 'sparkle' is a glint
// that pulses as it twinkles, 'gull' is a bird circling a fixed point,
// 'grain' is a speck of sand that arcs up and falls back down.
const MAX_SKIDS = 400;

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

/** Push one particle onto the bag, filling in the shared defaults. */
function addParticle(fx, mote) {
  fx.particles.push({
    kind: 'dot',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0.5,
    maxLife: 0.5,
    size: 3,
    color: '#ffffff',
    grav: 0,
    baseSize: 3,
    twinkle: 0,
    cx: 0,
    cy: 0,
    orbitR: 0,
    angle: 0,
    spin: 0,
    ...mote,
  });
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
    const heading = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    const moteLife = life * (0.6 + Math.random() * 0.6);
    addParticle(fx, {
      x,
      y,
      vx: Math.cos(heading) * v,
      vy: Math.sin(heading) * v - up,
      life: moteLife,
      maxLife: life,
      size: size * (0.6 + Math.random() * 0.8),
      color,
    });
  }
}

/**
 * Sand spray: pale grains kicked up where feet or tyres hit the beach.
 * They arc up with a little sideways scatter, then fall back under
 * gravity and fade fast.
 */
export function sandSpray(fx, x, y, opts = {}) {
  const count = opts.count ?? 8;
  const spread = opts.spread ?? 120;
  const life = opts.life ?? 0.55;
  for (let i = 0; i < count; i += 1) {
    const moteLife = life * (0.6 + Math.random() * 0.7);
    addParticle(fx, {
      kind: 'grain',
      x: x + (Math.random() * 2 - 1) * 6,
      y,
      vx: (Math.random() * 2 - 1) * spread,
      vy: -Math.random() * 130 - 30,
      life: moteLife,
      maxLife: life,
      size: 1.5 + Math.random() * 2,
      color: Math.random() < 0.5 ? '#e6d3a3' : '#cbb27f',
      grav: 520,
    });
  }
}

/**
 * Wave sparkle: brief glints on the water beside the pier, twinkling
 * in place along a short stretch of the shoreline.
 */
export function waveSparkle(fx, x, y, opts = {}) {
  const count = opts.count ?? 6;
  const stretch = opts.stretch ?? 90;
  const life = opts.life ?? 0.8;
  for (let i = 0; i < count; i += 1) {
    const moteLife = life * (0.5 + Math.random() * 0.8);
    const baseSize = 2 + Math.random() * 2.5;
    addParticle(fx, {
      kind: 'sparkle',
      x: x + (Math.random() * 2 - 1) * stretch,
      y: y + (Math.random() * 2 - 1) * 8,
      life: moteLife,
      maxLife: life,
      size: baseSize,
      baseSize,
      twinkle: Math.random() * Math.PI * 2,
      color: Math.random() < 0.6 ? '#dff3ff' : '#ffffff',
    });
  }
}

/**
 * A flock of gulls circling above (x, y) — the pier's permanent
 * residents. Each bird keeps its own orbit radius and direction and
 * flaps as it goes round.
 */
export function gullFlock(fx, x, y, count = 4) {
  for (let i = 0; i < count; i += 1) {
    const orbitR = 40 + Math.random() * 55;
    const startAngle = Math.random() * Math.PI * 2;
    const moteLife = 4 + Math.random() * 3;
    addParticle(fx, {
      kind: 'gull',
      x: x + Math.cos(startAngle) * orbitR,
      y: y + Math.sin(startAngle) * orbitR * 0.6,
      life: moteLife,
      maxLife: moteLife,
      size: 5 + Math.random() * 3,
      color: '#f2f2f2',
      cx: x,
      cy: y,
      orbitR,
      angle: startAngle,
      spin: (0.5 + Math.random() * 0.4) * (Math.random() < 0.5 ? -1 : 1),
      twinkle: Math.random() * Math.PI * 2,
    });
  }
}

/** A short skid-mark segment under a sliding car. */
export function skidMark(fx, car) {
  const back = car.h / 2 - 6;
  const side = car.w / 2 - 4;
  // Forward and right unit vectors from the car's heading.
  const fwdX = Math.sin(car.angle);
  const fwdY = -Math.cos(car.angle);
  const rightX = Math.cos(car.angle);
  const rightY = Math.sin(car.angle);
  for (const s of [-1, 1]) {
    fx.skids.push({
      x: car.x - fwdX * back + rightX * side * s,
      y: car.y - fwdY * back + rightY * side * s,
      angle: car.angle,
      life: 6,
    });
  }
  if (fx.skids.length > MAX_SKIDS) fx.skids.splice(0, fx.skids.length - MAX_SKIDS);
}

/** A label that rises and fades above the world. */
export function floatText(fx, x, y, text, color = '#ffffff') {
  fx.texts.push({ x, y, text, color, life: 1.2 });
}

/** A camera jolt; bigger numbers hit harder. */
export function shake(fx, amount) {
  fx.shake = Math.min(14, fx.shake + amount);
}

/** Age a single particle by dt, following its kind's motion. */
function ageParticle(p, dt) {
  p.life -= dt;
  if (p.kind === 'gull') {
    // Circle the home point; the flap phase advances with the orbit.
    p.angle += p.spin * dt;
    p.twinkle += dt * 9;
    p.x = p.cx + Math.cos(p.angle) * p.orbitR;
    p.y = p.cy + Math.sin(p.angle) * p.orbitR * 0.6;
    return;
  }
  if (p.kind === 'sparkle') {
    // Glints stay put and pulse: swell, then shrink back to nothing.
    p.twinkle += dt * 10;
    p.size = Math.max(0.4, p.baseSize * (0.55 + 0.45 * Math.sin(p.twinkle)));
    return;
  }
  // Dots and sand grains drift, drag, and fall under their gravity.
  p.vy += p.grav * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vx *= 1 - 2.4 * dt;
  p.vy *= 1 - 2.4 * dt;
}

/** Age every effect by dt; shake settles into a fresh random offset. */
export function updateEffects(fx, dt) {
  for (let i = fx.particles.length - 1; i >= 0; i -= 1) {
    const p = fx.particles[i];
    ageParticle(p, dt);
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

/** Draw one gull as a flapping "v" of two wing strokes. */
function drawGull(ctx, p) {
  const flap = Math.sin(p.twinkle) * p.size * 0.45;
  const half = p.size;
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x - half, p.y - flap);
  ctx.lineTo(p.x, p.y);
  ctx.lineTo(p.x + half, p.y - flap);
  ctx.stroke();
}

/** Draw one sparkle as a small four-point glint. */
function drawSparkle(ctx, p) {
  const r = p.size;
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y);
  ctx.lineTo(p.x + r, p.y);
  ctx.moveTo(p.x, p.y - r);
  ctx.lineTo(p.x, p.y + r);
  ctx.stroke();
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
    if (p.kind === 'gull') {
      drawGull(ctx, p);
    } else if (p.kind === 'sparkle') {
      drawSparkle(ctx, p);
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
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
