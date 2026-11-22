// Solmar's screen-space layer: everything the player reads while driving —
// vitals, wanted heat, difficulty, the courier clock, the objective stack,
// the speedometer and the minimap — plus the title, pause and end screens.
// Nothing here simulates; it only paints the shared game state `g` onto
// the canvas after the world has been drawn.
import { WORLD_H, WORLD_W } from './config.js';

// One typeface for the whole overlay, so every label matches.
const TYPEFACE = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// The overlay palette: warm gold for money and goals, green for health and
// good news, red for damage and danger, blue for the law.
const INK = {
  gold: '#ffd94d',
  green: '#5ec95a',
  softGreen: '#7ddb6a',
  red: '#e5534b',
  brightRed: '#ff5a3c',
  blue: '#3a86ff',
  white: '#eef1f5',
  dim: 'rgba(238,241,245,0.7)',
  faint: 'rgba(255,255,255,0.25)',
  track: 'rgba(255,255,255,0.18)',
  frame: 'rgba(255,255,255,0.14)',
  orange: '#ff9f2e',
};

/** Paint one line of text at (x, y), honouring alignment and weight. */
function label(ctx, value, x, y, size, color, align, weight) {
  ctx.font = `${weight || 'bold'} ${size}px ${TYPEFACE}`;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(value), x, y);
}

/** A dark rounded card with a faint rim; the base of almost every widget. */
function card(ctx, x, y, w, h, alpha) {
  ctx.fillStyle = `rgba(12, 14, 20, ${alpha === undefined ? 0.82 : alpha})`;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = INK.frame;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** A horizontal meter: a dim track with a coloured fill clipped to a ratio. */
function meter(ctx, x, y, w, h, ratio, color) {
  const clamped = Math.max(0, Math.min(1, ratio));
  ctx.fillStyle = INK.track;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  if (clamped <= 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(h, w * clamped), h, h / 2);
  ctx.fill();
}

/** Centre a translucent wash over the whole screen for menu/end panels. */
function dimScreen(ctx, w, h, alpha) {
  ctx.fillStyle = `rgba(8, 10, 16, ${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

/** Centre a card on the screen and return its top-left corner. */
function centredCard(ctx, w, h, cardW, cardH, yTop, alpha) {
  const x = (w - cardW) / 2;
  card(ctx, x, yTop, cardW, cardH, alpha);
  return x;
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

// Difficulty levels other systems may set on the game state. The badge reads
// whatever is there — a plain string, a { label } object, or nothing — and
// falls back to Normal, so the HUD works before difficulty is wired in.
const DIFFICULTY_STYLE = {
  Easy: { tag: 'EASY', color: INK.softGreen },
  Normal: { tag: 'NORMAL', color: INK.gold },
  Hard: { tag: 'HARD', color: INK.orange },
  Insane: { tag: 'INSANE', color: INK.brightRed },
};

function difficultyOf(g) {
  const raw = g.difficulty ?? g.settings?.difficulty ?? g.options?.difficulty ?? 'Normal';
  const name = typeof raw === 'string' ? raw : raw.label || raw.name || 'Normal';
  const pretty = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return DIFFICULTY_STYLE[pretty] || DIFFICULTY_STYLE.Normal;
}

/** A small pill under the wanted stars naming the current difficulty. */
function drawDifficultyBadge(ctx, g, w) {
  const style = difficultyOf(g);
  const caption = `DIFFICULTY · ${style.tag}`;
  ctx.font = `bold 12px ${TYPEFACE}`;
  const pillW = ctx.measureText(caption).width + 26;
  const x = w / 2 - pillW / 2;
  const y = 48;
  ctx.fillStyle = 'rgba(12, 14, 20, 0.7)';
  ctx.beginPath();
  ctx.roundRect(x, y, pillW, 22, 11);
  ctx.fill();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = 1;
  ctx.stroke();
  label(ctx, caption, w / 2, y + 15.5, 12, style.color, 'center');
}

// ---------------------------------------------------------------------------
// Wanted stars
// ---------------------------------------------------------------------------

/** Five stars across the top: gold for each live star, dim for the rest. */
function drawWantedStars(ctx, g, w) {
  const middle = w / 2;
  for (let i = 0; i < 5; i += 1) {
    const x = middle + (i - 2) * 30;
    label(ctx, '★', x, 34, 26, i < g.wanted ? INK.gold : INK.faint, 'center');
  }
}

// ---------------------------------------------------------------------------
// Courier timer and package marker
// ---------------------------------------------------------------------------

// The courier run is the timed delivery: `g.courier` carries the clock when
// another system owns it; otherwise the HUD falls back to the taxi fare's
// tip timer and the story's carried package, so the chip still means
// something before the courier system lands.
function courierState(g) {
  const courier = g.courier;
  if (courier) {
    return {
      active: courier.active !== false,
      secondsLeft: courier.timeLeft ?? courier.secondsLeft ?? courier.timer ?? null,
      total: courier.total ?? courier.timeLimit ?? null,
      carrying: Boolean(courier.hasPackage ?? courier.carrying ?? g.missions?.hasPackage),
      destX: courier.destX ?? courier.x ?? null,
      destY: courier.destY ?? courier.y ?? null,
    };
  }
  const fare = g.missions?.fare;
  return {
    active: Boolean(fare && fare.phase === 'dropoff'),
    secondsLeft: fare ? fare.timer : null,
    total: null,
    carrying: Boolean(g.missions?.hasPackage),
    destX: fare ? fare.destX : null,
    destY: fare ? fare.destY : null,
  };
}

function clockText(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '--:--';
  const left = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(left / 60);
  const secs = left % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/** The courier countdown chip, bottom centre; it flashes red under 10s. */
function drawCourierChip(ctx, g, w, h) {
  const run = courierState(g);
  if (!run.active && !run.carrying) return;
  const urgent = run.secondsLeft !== null && run.secondsLeft <= 10;
  const blink = urgent && Math.sin(g.time * 8) > 0;
  const caption = run.carrying
    ? `📦 COURIER ${clockText(run.secondsLeft)}`
    : `COURIER ${clockText(run.secondsLeft)}`;
  ctx.font = `bold 17px ${TYPEFACE}`;
  const chipW = ctx.measureText(caption).width + 30;
  const x = w / 2 - chipW / 2;
  const y = h - 96;
  ctx.fillStyle = blink ? 'rgba(120, 16, 10, 0.9)' : 'rgba(12, 14, 20, 0.78)';
  ctx.beginPath();
  ctx.roundRect(x, y, chipW, 34, 10);
  ctx.fill();
  ctx.strokeStyle = urgent ? INK.brightRed : INK.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  label(ctx, caption, w / 2, y + 23, 17, urgent ? '#ffffff' : INK.gold, 'center');
  // A thin urgency bar drains as the clock runs down, when a total is known.
  if (run.total && run.secondsLeft !== null) {
    const ratio = Math.max(0, run.secondsLeft / run.total);
    meter(ctx, x + 10, y + 29, chipW - 20, 3, ratio, urgent ? INK.brightRed : INK.gold);
  }
}

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------

/** One marker dot on the minimap, at world coords scaled into the frame. */
function minimapDot(ctx, originX, originY, scale, wx, wy, color, radius) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(originX + wx * scale, originY + wy * scale, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** The island shrunk into a corner: sea, sand, roads, markers, cops, Dex. */
function drawMinimap(ctx, g, x, y, size) {
  const scale = size / WORLD_W;
  card(ctx, x - 6, y - 6, size + 12, size + 12, 0.75);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  // Ground, then the southern sea and the beach strip above it.
  ctx.fillStyle = '#5d9b4e';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#2e7f9e';
  ctx.fillRect(x, y + g.city.waterTop * scale, size, size - g.city.waterTop * scale);
  ctx.fillStyle = '#e6d3a3';
  ctx.fillRect(x, y + g.city.beachTop * scale, size, (g.city.waterTop - g.city.beachTop) * scale);
  // Roads: verticals first, then horizontals.
  ctx.strokeStyle = '#3d3a38';
  ctx.lineWidth = Math.max(1.5, 44 * scale);
  for (const rx of g.city.roadX) {
    ctx.beginPath();
    ctx.moveTo(x + rx * scale, y);
    ctx.lineTo(x + rx * scale, y + size);
    ctx.stroke();
  }
  for (const ry of g.city.roadY) {
    ctx.beginPath();
    ctx.moveTo(x, y + ry * scale);
    ctx.lineTo(x + size, y + ry * scale);
    ctx.stroke();
  }
  // The story marker pulses gold; fares ride green; the courier rides orange.
  const mark = g.missionMarker;
  if (mark) {
    const pulse = 4 + Math.sin(g.time * 5) * 1.5;
    minimapDot(ctx, x, y, scale, mark.x, mark.y, INK.gold, pulse);
  }
  const fare = g.missions.fare;
  if (fare) {
    const fx = fare.phase === 'pickup' ? fare.x : fare.destX;
    const fy = fare.phase === 'pickup' ? fare.y : fare.destY;
    minimapDot(ctx, x, y, scale, fx, fy, INK.softGreen, 4);
  }
  const run = courierState(g);
  if (run.destX !== null && run.destY !== null && (run.active || run.carrying)) {
    const throb = 5 + Math.sin(g.time * 6) * 1.5;
    minimapDot(ctx, x, y, scale, run.destX, run.destY, INK.orange, throb);
  }
  // Cops in blue, then Dex as a white-ringed dot.
  for (const car of g.police.cars) minimapDot(ctx, x, y, scale, car.x, car.y, INK.blue, 3);
  for (const cop of g.police.foot) minimapDot(ctx, x, y, scale, cop.x, cop.y, INK.blue, 2.5);
  const p = g.player;
  const px = p.inCar ? p.inCar.x : p.x;
  const py = p.inCar ? p.inCar.y : p.y;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x + px * scale, y + py * scale, 5, 0, Math.PI * 2);
  ctx.stroke();
  minimapDot(ctx, x, y, scale, px, py, '#ffffff', 3.5);
  ctx.restore();
  void WORLD_H;
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

// The objective stack: the current step first, then the next step as a
// preview, then the fare or package line. New missions only need to add
// steps to the script — the stack picks them up on its own.
function objectiveLines(g) {
  const lines = [];
  const m = g.missions;
  if (!m) return [g.objective || ''];
  if (m.done) {
    lines.push('Story complete — Solmar is yours. Take fares, find coins.');
    return lines;
  }
  const script = m.scripts[m.index];
  if (!script) return [g.objective || ''];
  const step = script.steps[m.step];
  if (step) lines.push(`${script.title}: ${step.text}`);
  else lines.push(g.objective || '');
  const next = script.steps[m.step + 1];
  if (next) lines.push(`Next: ${next.text}`);
  if (m.fare) {
    lines.push(m.fare.phase === 'pickup'
      ? `Fare waiting — pick up the rider ($${m.fare.reward})`
      : `Fare aboard — drop off in ${clockText(m.fare.timer)}`);
  }
  if (m.hasPackage) lines.push('Package in hand — get it to the drop-off.');
  const courier = courierState(g);
  if (courier.active && courier.secondsLeft !== null) {
    lines.push(`Courier clock: ${clockText(courier.secondsLeft)} left.`);
  }
  return lines.slice(0, 3);
}

/** The objective panel, bottom left, one line per entry in the stack. */
function drawObjectives(ctx, g, h) {
  const lines = objectiveLines(g);
  const rowH = 24;
  const panelH = lines.length * rowH + 14;
  ctx.font = `16px ${TYPEFACE}`;
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
  const panelW = Math.min(620, widest + 120);
  const top = h - 52 - (lines.length - 1) * rowH;
  card(ctx, 14, top, panelW, panelH, 0.7);
  lines.forEach((line, i) => {
    const marker = i === 0 ? '◆ ' : '· ';
    label(ctx, marker + line, 26, top + 24 + i * rowH, 16, INK.white, 'left', 'normal');
  });
}

// ---------------------------------------------------------------------------
// In-play HUD
// ---------------------------------------------------------------------------

/** Health, cash and ammo, top left. */
function drawVitals(ctx, g) {
  const p = g.player;
  card(ctx, 14, 14, 220, 62, 0.7);
  meter(ctx, 26, 26, 170, 14, p.hp / 100, p.hp > 40 ? INK.green : INK.red);
  label(ctx, `$${g.money}`, 26, 66, 20, INK.gold);
  label(ctx, `Ammo ${p.ammo}`, 150, 66, 16, INK.white, 'left', 'normal');
}

/** The speedometer, bottom right, only while Dex is behind the wheel. */
function drawSpeedo(ctx, g, w, h) {
  const p = g.player;
  if (!p.inCar) return;
  const kmh = Math.round(Math.abs(p.inCar.speed) * 0.32);
  card(ctx, w - 130, h - 52, 116, 38, 0.7);
  label(ctx, `${kmh} km/h`, w - 72, h - 26, 20, '#ffffff', 'center');
}

/** The mission title card that slides in when a mission starts. */
function drawBanner(ctx, g, w, h) {
  const m = g.missions;
  if (!m || m.bannerTimer <= 0 || !m.banner) return;
  const bw = 520;
  const bx = (w - bw) / 2;
  const by = h * 0.24;
  card(ctx, bx, by, bw, 92, 0.88);
  label(ctx, m.banner.title, w / 2, by + 38, 26, INK.gold, 'center');
  label(ctx, m.banner.sub, w / 2, by + 68, 15, INK.white, 'center', 'normal');
}

/** Red flash on damage and a slow pulse while health is critical. */
function drawDamageOverlay(ctx, g, w, h) {
  const p = g.player;
  if (p.hurtTimer > 0) {
    ctx.fillStyle = `rgba(229, 83, 75, ${0.22 * (p.hurtTimer / 0.4)})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (p.hp > 0 && p.hp <= 25) {
    ctx.fillStyle = `rgba(229, 83, 75, ${0.08 + 0.05 * Math.sin(g.time * 4)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/** The in-play HUD: vitals, stars, difficulty, objectives, courier clock,
// speedometer, minimap, banner and damage feedback. */
export function drawHud(ctx, g, w, h) {
  drawVitals(ctx, g);
  drawWantedStars(ctx, g, w);
  drawDifficultyBadge(ctx, g, w);
  drawMinimap(ctx, g, w - 216, 14, 196);
  drawObjectives(ctx, g, h);
  drawCourierChip(ctx, g, w, h);
  drawSpeedo(ctx, g, w, h);
  drawBanner(ctx, g, w, h);
  drawDamageOverlay(ctx, g, w, h);
}

// ---------------------------------------------------------------------------
// Title, pause and end screens
// ---------------------------------------------------------------------------

const CONTROLS_LINES = [
  'WASD / arrows — move & drive',
  'E — get in / out of a car',
  'Space — punch · J / click — shoot',
  'Shift — sprint · P — pause · M — mute',
];

/** Title screen over the live city. */
export function drawTitle(ctx, g, w, h, hasSave) {
  dimScreen(ctx, w, h, 0.45);
  const cx = w / 2;
  label(ctx, 'SOLMAR', cx, h * 0.3, 84, INK.gold, 'center');
  label(ctx, 'S T R E E T S   O F   T H E   S U N', cx, h * 0.3 + 34, 18, INK.white, 'center', 'normal');
  label(ctx, 'Dex Marlowe is back in town. Mara has work. The cops have questions.', cx, h * 0.3 + 72, 16, 'rgba(238,241,245,0.8)', 'center', 'normal');
  const bw = 460;
  const bx = cx - bw / 2;
  const by = h * 0.52;
  card(ctx, bx, by, bw, 210, 0.85);
  for (let i = 0; i < CONTROLS_LINES.length; i += 1) {
    label(ctx, CONTROLS_LINES[i], cx, by + 40 + i * 26, 16, INK.white, 'center', 'normal');
  }
  label(ctx, hasSave ? 'ENTER — Continue' : 'ENTER — New game', cx, by + 40 + CONTROLS_LINES.length * 26 + 8, 20, INK.softGreen, 'center');
}

/** Pause panel. */
export function drawPaused(ctx, g, w, h) {
  dimScreen(ctx, w, h, 0.55);
  const bw = 420;
  const by = h / 2 - 110;
  centredCard(ctx, w, h, bw, 220, by, 0.9);
  label(ctx, 'Paused', w / 2, by + 52, 34, '#ffffff', 'center');
  const progress = g.missions.done ? 'done' : `${g.missions.index + 1} of 5`;
  label(ctx, `Cash $${g.money} · Mission ${progress}`, w / 2, by + 92, 16, INK.white, 'center', 'normal');
  label(ctx, 'P — resume', w / 2, by + 136, 18, INK.gold, 'center');
  label(ctx, 'Enter — save & title', w / 2, by + 168, 18, INK.gold, 'center');
  label(ctx, 'M — mute', w / 2, by + 198, 16, INK.dim, 'center', 'normal');
}

/** Game over / busted / story-complete panels. */
export function drawOver(ctx, g, w, h, kind) {
  dimScreen(ctx, w, h, 0.6);
  const bw = 460;
  const by = h / 2 - 110;
  centredCard(ctx, w, h, bw, 220, by, 0.9);
  if (kind === 'busted') {
    label(ctx, 'BUSTED', w / 2, by + 56, 44, INK.blue, 'center');
    label(ctx, 'The Solmar PD finally caught up with Dex.', w / 2, by + 96, 16, INK.white, 'center', 'normal');
  } else if (kind === 'complete') {
    label(ctx, 'STORY COMPLETE', w / 2, by + 56, 36, INK.gold, 'center');
    label(ctx, 'Every mission done. Solmar is yours — keep driving.', w / 2, by + 96, 16, INK.white, 'center', 'normal');
  } else {
    label(ctx, 'WASTED', w / 2, by + 56, 44, INK.red, 'center');
    label(ctx, 'Dex went down in the streets of Solmar.', w / 2, by + 96, 16, INK.white, 'center', 'normal');
  }
  label(ctx, `Cash $${g.money} · Fares ${g.faresDone} · Coins ${g.packages}/8`, w / 2, by + 132, 16, INK.white, 'center', 'normal');
  label(ctx, 'ENTER — play again', w / 2, by + 176, 18, INK.softGreen, 'center');
}
