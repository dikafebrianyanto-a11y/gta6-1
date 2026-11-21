// The HUD and the minimap, drawn in screen space after the world: health
// and money, wanted stars, the objective line, the speedometer, mission
// cards, and the title, pause and game-over panels.
import { WORLD_H, WORLD_W } from './config.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function text(ctx, value, x, y, size, color, align = 'left', weight = 'bold') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
}

function panel(ctx, x, y, w, h, alpha = 0.82) {
  ctx.fillStyle = `rgba(12, 14, 20, ${alpha})`;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Wanted stars, centred at the top: filled gold, empty dim. */
function drawStars(ctx, g, w) {
  const cx = w / 2;
  const y = 34;
  for (let i = 0; i < 5; i += 1) {
    const x = cx + (i - 2) * 30;
    text(ctx, '★', x, y, 26, i < g.wanted ? '#ffcf3d' : 'rgba(255,255,255,0.25)', 'center');
  }
}

/** The minimap: the whole island, shrunk, with the player and the markers. */
function drawMinimap(ctx, g, x, y, size) {
  const s = size / WORLD_W;
  panel(ctx, x - 6, y - 6, size + 12, size + 12, 0.75);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.fillStyle = '#5d9b4e';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#2e7f9e';
  ctx.fillRect(x, y + (g.city.waterTop - 0) * s, size, size - g.city.waterTop * s);
  ctx.fillStyle = '#e6d3a3';
  ctx.fillRect(x, y + g.city.beachTop * s, size, (g.city.waterTop - g.city.beachTop) * s);
  ctx.strokeStyle = '#3d3a38';
  ctx.lineWidth = Math.max(1.5, 44 * s);
  for (const rx of g.city.roadX) {
    ctx.beginPath();
    ctx.moveTo(x + rx * s, y);
    ctx.lineTo(x + rx * s, y + size);
    ctx.stroke();
  }
  for (const ry of g.city.roadY) {
    ctx.beginPath();
    ctx.moveTo(x, y + ry * s);
    ctx.lineTo(x + size, y + ry * s);
    ctx.stroke();
  }
  const dot = (wx, wy, color, r) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + wx * s, y + wy * s, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const mark = g.missionMarker;
  if (mark) {
    const pulse = 4 + Math.sin(g.time * 5) * 1.5;
    dot(mark.x, mark.y, '#ffd94d', pulse);
  }
  if (g.missions.fare) {
    const f = g.missions.fare;
    dot(f.phase === 'pickup' ? f.x : f.destX, f.phase === 'pickup' ? f.y : f.destY, '#7ddb6a', 4);
  }
  for (const car of g.police.cars) dot(car.x, car.y, '#3a86ff', 3);
  for (const cop of g.police.foot) dot(cop.x, cop.y, '#3a86ff', 2.5);
  const p = g.player;
  const px = p.inCar ? p.inCar.x : p.x;
  const py = p.inCar ? p.inCar.y : p.y;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x + px * s, y + py * s, 5, 0, Math.PI * 2);
  ctx.stroke();
  dot(px, py, '#ffffff', 3.5);
  ctx.restore();
}

/** The in-play HUD: health, money, stars, objective, speed, minimap. */
export function drawHud(ctx, g, w, h) {
  const p = g.player;
  // Health bar and money, top left.
  panel(ctx, 14, 14, 220, 62, 0.7);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.roundRect(26, 26, 170, 14, 7);
  ctx.fill();
  ctx.fillStyle = p.hp > 40 ? '#5ec95a' : '#e5534b';
  ctx.beginPath();
  ctx.roundRect(26, 26, Math.max(0, 170 * (p.hp / 100)), 14, 7);
  ctx.fill();
  text(ctx, `$${g.money}`, 26, 66, 20, '#ffd94d');
  text(ctx, `Ammo ${p.ammo}`, 150, 66, 16, '#eef1f5', 'left', 'normal');
  drawStars(ctx, g, w);
  drawMinimap(ctx, g, w - 216, 14, 196);
  // Objective, bottom left.
  const obj = g.objective;
  ctx.font = '16px system-ui, -apple-system, "Segoe UI", sans-serif';
  panel(ctx, 14, h - 52, Math.min(560, ctx.measureText(obj).width + 120), 38, 0.7);
  text(ctx, '◆ ' + obj, 26, h - 26, 16, '#ffffff', 'left', 'normal');
  // Speedometer, bottom right, only while driving.
  if (p.inCar) {
    const kmh = Math.round(Math.abs(p.inCar.speed) * 0.32);
    panel(ctx, w - 130, h - 52, 116, 38, 0.7);
    text(ctx, `${kmh} km/h`, w - 72, h - 26, 20, '#ffffff', 'center');
  }
  // Mission title card.
  const m = g.missions;
  if (m.bannerTimer > 0 && m.banner) {
    const bw = 520;
    const bx = (w - bw) / 2;
    const by = h * 0.24;
    panel(ctx, bx, by, bw, 92, 0.88);
    text(ctx, m.banner.title, w / 2, by + 38, 26, '#ffd94d', 'center');
    text(ctx, m.banner.sub, w / 2, by + 68, 15, '#eef1f5', 'center', 'normal');
  }
  // Damage flash and low-health vignette.
  if (p.hurtTimer > 0) {
    ctx.fillStyle = `rgba(229, 83, 75, ${0.22 * (p.hurtTimer / 0.4)})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (p.hp > 0 && p.hp <= 25) {
    ctx.fillStyle = `rgba(229, 83, 75, ${0.08 + 0.05 * Math.sin(g.time * 4)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

const MENU_LINES = [
  'WASD / arrows — move & drive',
  'E — get in / out of a car',
  'Space — punch · J / click — shoot',
  'Shift — sprint · P — pause · M — mute',
];

/** Title screen over the live city. */
export function drawTitle(ctx, g, w, h, hasSave) {
  ctx.fillStyle = 'rgba(8, 10, 16, 0.45)';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  text(ctx, 'SOLMAR', cx, h * 0.3, 84, '#ffd94d', 'center');
  text(ctx, 'S T R E E T S   O F   T H E   S U N', cx, h * 0.3 + 34, 18, '#eef1f5', 'center', 'normal');
  text(ctx, 'Dex Marlowe is back in town. Mara has work. The cops have questions.', cx, h * 0.3 + 72, 16, 'rgba(238,241,245,0.8)', 'center', 'normal');
  const bw = 460;
  const bx = cx - bw / 2;
  const by = h * 0.52;
  panel(ctx, bx, by, bw, 210, 0.85);
  for (let i = 0; i < MENU_LINES.length; i += 1) {
    text(ctx, MENU_LINES[i], cx, by + 40 + i * 26, 16, '#eef1f5', 'center', 'normal');
  }
  text(ctx, hasSave ? 'ENTER — Continue' : 'ENTER — New game', cx, by + 40 + MENU_LINES.length * 26 + 8, 20, '#7ddb6a', 'center');
}

/** Pause panel. */
export function drawPaused(ctx, g, w, h) {
  ctx.fillStyle = 'rgba(8, 10, 16, 0.55)';
  ctx.fillRect(0, 0, w, h);
  const bw = 420;
  const bx = (w - bw) / 2;
  const by = h / 2 - 110;
  panel(ctx, bx, by, bw, 220, 0.9);
  text(ctx, 'Paused', w / 2, by + 52, 34, '#ffffff', 'center');
  text(ctx, `Cash $${g.money} · Mission ${g.missions.done ? 'done' : g.missions.index + 1} of 5`, w / 2, by + 92, 16, '#eef1f5', 'center', 'normal');
  text(ctx, 'P — resume', w / 2, by + 136, 18, '#ffd94d', 'center');
  text(ctx, 'Enter — save & title', w / 2, by + 168, 18, '#ffd94d', 'center');
  text(ctx, 'M — mute', w / 2, by + 198, 16, 'rgba(238,241,245,0.7)', 'center', 'normal');
}

/** Game over / busted / story-complete panels. */
export function drawOver(ctx, g, w, h, kind) {
  ctx.fillStyle = 'rgba(8, 10, 16, 0.6)';
  ctx.fillRect(0, 0, w, h);
  const bw = 460;
  const bx = (w - bw) / 2;
  const by = h / 2 - 110;
  panel(ctx, bx, by, bw, 220, 0.9);
  if (kind === 'busted') {
    text(ctx, 'BUSTED', w / 2, by + 56, 44, '#3a86ff', 'center');
    text(ctx, 'The Solmar PD finally caught up with Dex.', w / 2, by + 96, 16, '#eef1f5', 'center', 'normal');
  } else if (kind === 'complete') {
    text(ctx, 'STORY COMPLETE', w / 2, by + 56, 36, '#ffd94d', 'center');
    text(ctx, 'Every mission done. Solmar is yours — keep driving.', w / 2, by + 96, 16, '#eef1f5', 'center', 'normal');
  } else {
    text(ctx, 'WASTED', w / 2, by + 56, 44, '#e5534b', 'center');
    text(ctx, 'Dex went down in the streets of Solmar.', w / 2, by + 96, 16, '#eef1f5', 'center', 'normal');
  }
  text(ctx, `Cash $${g.money} · Fares ${g.faresDone} · Coins ${g.packages}/8`, w / 2, by + 132, 16, '#eef1f5', 'center', 'normal');
  text(ctx, 'ENTER — play again', w / 2, by + 176, 18, '#7ddb6a', 'center');
}
