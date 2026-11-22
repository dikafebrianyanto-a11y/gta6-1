// Solmar painter: everything the camera can see, in layers.
// The island sits in open water, the city grid sits on the island, and the
// actors move on top of it. main.js owns the camera and the loop; this
// module only knows how to turn game state into coloured rectangles,
// circles and light. Nothing here mutates the game — it reads `g` and
// paints, so calling draw twice with the same state paints the same frame.
//
// Lighting: the renderer tracks a time-of-day phase (see setTimeOfDay).
// Day is the plain sunny look. Dusk warms and darkens the whole scene and
// switches every car's headlights on; night goes darker still, with
// brighter beams and lit windows. The default phase is day, so the plain
// game and the screenshot stages look exactly as they did before.
import { WORLD_H, WORLD_W, PAL } from './config.js';
import { drawEffects } from './effects.js';

// Phases the scene can sit in, with the screen tint each one lays over
// the finished world. The two fills per phase are painted in order:
// a warm or cool colour wash, then a darkening veil.
const PHASE_TINTS = {
  day: [],
  dusk: ['rgba(255, 122, 38, 0.10)', 'rgba(24, 18, 64, 0.20)'],
  night: ['rgba(30, 44, 110, 0.14)', 'rgba(8, 10, 40, 0.34)'],
};

// Aliases players / other modules might reasonably use.
const PHASE_ALIASES = { sunset: 'dusk', evening: 'dusk', midnight: 'night' };

/** Switch the scene lighting. `phase` is 'day', 'dusk' or 'night'. */
export function setTimeOfDay(phase) {
  const wanted = PHASE_ALIASES[phase] || phase;
  if (!PHASE_TINTS[wanted]) return false;
  currentPhase = wanted;
  return true;
}

/** Read back the phase set by setTimeOfDay (defaults to 'day'). */
export function getTimeOfDay() {
  return currentPhase;
}

let currentPhase = 'day';

/** True when the rectangle around (x, y) could be on screen. */
function visible(cam, x, y, margin = 120) {
  const left = cam.x - margin;
  const right = cam.x + cam.w + margin;
  const top = cam.y - margin;
  const bottom = cam.y + cam.h + margin;
  return x > left && x < right && y > top && y < bottom;
}

/** One renderer per canvas. Resize tracks the window and the DPR. */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0, dpr: 1 };

  function fitCanvasToWindow() {
    view.dpr = window.devicePixelRatio || 1;
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    canvas.style.width = `${view.w}px`;
    canvas.style.height = `${view.h}px`;
  }
  fitCanvasToWindow();
  window.addEventListener('resize', fitCanvasToWindow);

  /** Paint one frame: sea, land, actors, effects, then the light tint. */
  function draw(g) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    paintOpenWater(ctx, view);
    const cam = g.camera;
    ctx.save();
    ctx.translate(cam.x * -1 + g.fx.shakeX, cam.y * -1 + g.fx.shakeY);
    paintWorld(ctx, g);
    paintActors(ctx, g);
    drawEffects(ctx, g.fx);
    ctx.restore();
    paintPhaseTint(ctx, view);
  }

  return { ctx, view, draw, setTimeOfDay, getTimeOfDay };
}

// ---------------------------------------------------------------------------
// Backdrop and ground
// ---------------------------------------------------------------------------

/** Deep water fills the whole screen before the island is painted over it. */
function paintOpenWater(ctx, view) {
  ctx.fillStyle = PAL.seaDeep;
  ctx.fillRect(0, 0, view.w, view.h);
}

/** Land, shore, greenery, lots, streets and blocks, in that order. */
function paintWorld(ctx, g) {
  paintLandBase(ctx);
  paintDryPatches(ctx, g.camera);
  paintShoreline(ctx, g);
  paintSunsetPier(ctx, g);
  paintParks(ctx, g.camera, g.city.parks);
  paintTrees(ctx, g.camera, g.city.trees);
  paintParkingLots(ctx, g.camera, g.city.lots);
  paintStreetGrid(ctx, g);
  paintBlocks(ctx, g);
}

/** The island itself: one flat grass rectangle for the whole world. */
function paintLandBase(ctx) {
  ctx.fillStyle = PAL.grass;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
}

/** Scattered dry-grass ellipses, placed by a fixed hash so they never move. */
function paintDryPatches(ctx, cam) {
  ctx.fillStyle = PAL.grassDry;
  for (let slot = 0; slot < 24; slot += 1) {
    const px = ((slot * 977) % WORLD_W) - 100;
    const py = ((slot * 571) % WORLD_H) - 100;
    if (!visible(cam, px, py, 200)) continue;
    ctx.beginPath();
    ctx.ellipse(px, py, 130, 80, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Sand strip, then the sea, then animated foam lines on the water. */
function paintShoreline(ctx, g) {
  const city = g.city;
  ctx.fillStyle = PAL.sand;
  ctx.fillRect(0, city.beachTop, WORLD_W, city.waterTop - city.beachTop);
  ctx.fillStyle = PAL.sea;
  ctx.fillRect(0, city.waterTop, WORLD_W, WORLD_H - city.waterTop);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  const drift = (g.time * 12) % 96;
  for (let sx = 0; sx < WORLD_W; sx += 96) {
    ctx.fillRect(sx + drift, city.waterTop + 8, 40, 3);
  }
}

/** Sunset Pier: pilings in the water, then the plank deck and its wide end platform. */
function paintSunsetPier(ctx, g) {
  const pier = g.city.pier;
  if (!pier || !pier.deck) return;
  const cam = g.camera;
  const deck = pier.deck;
  const platform = pier.platform;
  const midX = deck.x + deck.w / 2;
  const midY = deck.y + deck.h / 2;
  if (!visible(cam, midX, midY, 200)) return;
  // Stout posts sunk into the sea, drawn first so the deck sits on them.
  ctx.fillStyle = '#4a3421';
  for (const post of pier.pilings || []) {
    if (!visible(cam, post.x, post.y)) continue;
    ctx.beginPath();
    ctx.arc(post.x + 4, post.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4c2e';
    ctx.beginPath();
    ctx.arc(post.x + 4, post.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3421';
  }
  // The deck itself: weathered boards with a darker rim on each side.
  ctx.fillStyle = '#a67c4e';
  ctx.fillRect(deck.x, deck.y, deck.w, deck.h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(deck.x, deck.y, 4, deck.h);
  ctx.fillRect(deck.x + deck.w - 4, deck.y, 4, deck.h);
  // Crosswise plank seams down the whole run of the deck.
  ctx.fillStyle = 'rgba(74, 52, 33, 0.55)';
  for (let py = deck.y + 14; py < deck.y + deck.h; py += 14) {
    ctx.fillRect(deck.x + 4, py, deck.w - 8, 2);
  }
  // A pale centre seam where the two board rows meet.
  ctx.fillStyle = 'rgba(255, 235, 200, 0.25)';
  ctx.fillRect(midX - 1, deck.y, 2, deck.h);
  if (!platform) return;
  // The wider fishing platform at the far end, planked the same way.
  ctx.fillStyle = '#966f42';
  ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(platform.x, platform.y, platform.w, 4);
  ctx.fillRect(platform.x, platform.y + platform.h - 4, platform.w, 4);
  ctx.fillStyle = 'rgba(74, 52, 33, 0.55)';
  for (let py = platform.y + 12; py < platform.y + platform.h; py += 12) {
    ctx.fillRect(platform.x + 4, py, platform.w - 8, 2);
  }
  // Corner bollards so the platform reads as a place to stand, not a slab.
  ctx.fillStyle = '#3d2b18';
  for (const [bx, by] of [
    [platform.x + 6, platform.y + 6],
    [platform.x + platform.w - 6, platform.y + 6],
    [platform.x + 6, platform.y + platform.h - 6],
    [platform.x + platform.w - 6, platform.y + platform.h - 6],
  ]) {
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Flat green rectangles for each park. */
function paintParks(ctx, cam, parks) {
  ctx.fillStyle = PAL.park;
  for (const park of parks) {
    if (!visible(cam, park.x + park.w / 2, park.y + park.h / 2, 200)) continue;
    ctx.fillRect(park.x, park.y, park.w, park.h);
  }
}

/** Each tree: a soft offset shadow, a round canopy, a lighter crown. */
function paintTrees(ctx, cam, trees) {
  for (const tree of trees) {
    if (!visible(cam, tree.x, tree.y)) continue;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.arc(tree.x + 4, tree.y + 5, tree.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.tree;
    ctx.beginPath();
    ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.treeLight;
    ctx.beginPath();
    ctx.arc(tree.x - 3, tree.y - 3, tree.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Pale concrete slabs with white bay lines down their length. */
function paintParkingLots(ctx, cam, lots) {
  for (const lot of lots) {
    if (!visible(cam, lot.x + lot.w / 2, lot.y + lot.h / 2, 200)) continue;
    ctx.fillStyle = '#8f8a82';
    ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    for (let bx = lot.x + 24; bx < lot.x + lot.w - 10; bx += 36) {
      ctx.beginPath();
      ctx.moveTo(bx, lot.y + 10);
      ctx.lineTo(bx, lot.y + lot.h - 10);
      ctx.stroke();
    }
  }
}

/** Asphalt ribbons, pale sidewalk edges, then the centre dashes. */
function paintStreetGrid(ctx, g) {
  const city = g.city;
  ctx.fillStyle = PAL.asphalt;
  for (const rx of city.roadX) ctx.fillRect(rx - 48, 0, 96, WORLD_H);
  for (const ry of city.roadY) ctx.fillRect(0, ry - 48, WORLD_W, 96);
  ctx.fillStyle = PAL.sidewalk;
  for (const rx of city.roadX) {
    ctx.fillRect(rx - 48, 0, 10, WORLD_H);
    ctx.fillRect(rx + 38, 0, 10, WORLD_H);
  }
  for (const ry of city.roadY) {
    ctx.fillRect(0, ry - 48, WORLD_W, 10);
    ctx.fillRect(0, ry + 38, WORLD_W, 10);
  }
  paintLaneDashes(ctx, g);
}

/**
 * Centre dashes on every road. A dash is skipped where it would land
 * inside an intersection, so the crossings stay clean.
 */
function paintLaneDashes(ctx, g) {
  const city = g.city;
  const cam = g.camera;
  ctx.fillStyle = PAL.lane;
  for (const rx of city.roadX) {
    for (let y = 0; y < WORLD_H; y += 48) {
      const nearCross = city.roadY.some((ry) => Math.abs(y + 24 - ry) < 60);
      if (nearCross || !visible(cam, rx, y)) continue;
      ctx.fillRect(rx - 2, y + 8, 4, 24);
    }
  }
  for (const ry of city.roadY) {
    for (let x = 0; x < WORLD_W; x += 48) {
      const nearCross = city.roadX.some((rx) => Math.abs(x + 24 - rx) < 60);
      if (nearCross || !visible(cam, x, ry)) continue;
      ctx.fillRect(x + 8, ry - 2, 24, 4);
    }
  }
}

/**
 * Buildings: a long afternoon shadow offset north-east, the coloured
 * walls, an inset roof, a pale top edge, and a grid of windows. After
 * dark some windows glow warm instead of staying dark.
 */
function paintBlocks(ctx, g) {
  const cam = g.camera;
  const dark = currentPhase !== 'day';
  for (const block of g.city.buildings) {
    const centreX = block.x + block.w / 2;
    const centreY = block.y + block.h / 2;
    if (!visible(cam, centreX, centreY, 120)) continue;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(block.x + 10, block.y + 12, block.w, block.h);
    ctx.fillStyle = block.color;
    ctx.fillRect(block.x, block.y, block.w, block.h);
    ctx.fillStyle = block.roof;
    ctx.fillRect(block.x + 8, block.y + 8, block.w - 16, block.h - 16);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(block.x + 8, block.y + 8, block.w - 16, 6);
    paintBlockWindows(ctx, block, dark);
  }
}

/** Window grid for one building; a third glow warm once it is dark. */
function paintBlockWindows(ctx, block, litUp) {
  for (let wx = block.x + 16; wx < block.x + block.w - 12; wx += 26) {
    for (let wy = block.y + 18; wy < block.y + block.h - 12; wy += 30) {
      const warm = litUp && (wx + wy) % 78 === 0;
      ctx.fillStyle = warm ? 'rgba(255, 214, 130, 0.9)' : 'rgba(20, 24, 32, 0.5)';
      ctx.fillRect(wx, wy, 12, 16);
    }
  }
}

// ---------------------------------------------------------------------------
// Actors: beacon, pickups, cars, people, bullets
// ---------------------------------------------------------------------------

/** Beacon, coins, fare rider, cars, pedestrians, enemies, player, bullets. */
function paintActors(ctx, g) {
  paintBeacon(ctx, g);
  paintCoins(ctx, g);
  paintFareRider(ctx, g);
  const cam = g.camera;
  const heroCar = g.player.inCar;
  for (const car of g.cars) {
    if (visible(cam, car.x, car.y, 80)) paintVehicle(ctx, car, car === heroCar, g.time);
  }
  for (const ped of g.traffic.peds) {
    if (visible(cam, ped.x, ped.y)) paintWalker(ctx, ped.x, ped.y, ped.angle, ped.color, ped.down, false);
  }
  paintEnemies(ctx, g);
  paintHeroOnFoot(ctx, g);
  paintBullets(ctx, g.bullets);
}

/** The mission marker: a pulsing halo, a ring, and a downward arrow. */
function paintBeacon(ctx, g) {
  const mark = g.missionMarker;
  if (!mark || !visible(g.camera, mark.x, mark.y, 200)) return;
  const pulse = 1 + Math.sin(g.time * 4) * 0.15;
  ctx.fillStyle = 'rgba(255, 217, 77, 0.12)';
  ctx.beginPath();
  ctx.arc(mark.x, mark.y, 90 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffd94d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(mark.x, mark.y, 34 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffd94d';
  ctx.beginPath();
  ctx.moveTo(mark.x, mark.y - 46);
  ctx.lineTo(mark.x + 12, mark.y - 22);
  ctx.lineTo(mark.x - 12, mark.y - 22);
  ctx.closePath();
  ctx.fill();
}

/** Untaken sun coins: a gold disc with a dollar sign. */
function paintCoins(ctx, g) {
  ctx.textAlign = 'center';
  for (const coin of g.missions.coins) {
    if (coin.taken || !visible(g.camera, coin.x, coin.y)) continue;
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8860b';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('$', coin.x, coin.y + 4);
  }
}

/** The waiting fare rider, marked by a green dollar bubble. */
function paintFareRider(ctx, g) {
  const fare = g.missions.fare;
  if (!fare || fare.phase !== 'pickup') return;
  if (!visible(g.camera, fare.x, fare.y)) return;
  ctx.fillStyle = '#7ddb6a';
  ctx.beginPath();
  ctx.arc(fare.x, fare.y - 24, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0c0e14';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('$', fare.x, fare.y - 20);
}

/** Cops and thugs on foot, with a PD tag above each cop. */
function paintEnemies(ctx, g) {
  for (const foe of g.enemies) {
    if (!foe.alive || !visible(g.camera, foe.x, foe.y)) continue;
    const shade = foe.kind === 'cop' ? '#2e4a6b' : '#8a2f2f';
    paintWalker(ctx, foe.x, foe.y, foe.angle, shade, false, false);
    if (foe.kind !== 'cop') continue;
    ctx.fillStyle = '#2e4a6b';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PD', foe.x, foe.y - 16);
  }
}

/** Dex on foot, blinking while his invulnerability timer runs. */
function paintHeroOnFoot(ctx, g) {
  const p = g.player;
  if (p.inCar) return;
  const blinking = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0;
  if (!blinking) paintWalker(ctx, p.x, p.y, p.angle, '#3a6ea5', false, true);
}

/** Bullets as short bright streaks pointing back along their velocity. */
function paintBullets(ctx, bullets) {
  ctx.strokeStyle = '#ffe9a8';
  ctx.lineWidth = 3;
  for (const shot of bullets) {
    const speed = Math.hypot(shot.vx, shot.vy) || 1;
    ctx.beginPath();
    ctx.moveTo(shot.x, shot.y);
    ctx.lineTo(shot.x - (shot.vx / speed) * 14, shot.y - (shot.vy / speed) * 14);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/**
 * One car, drawn in its own rotated frame: drop shadow, body, glass,
 * lights, badges, then — after dark — the headlight beams. The front
 * of the car is the local -y edge, where the yellow lamps sit.
 */
function paintVehicle(ctx, car, isHero, clock) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  paintVehicleShadow(ctx, car);
  paintVehicleBody(ctx, car);
  paintVehicleGlass(ctx, car);
  paintVehicleLamps(ctx, car);
  paintVehicleBadge(ctx, car, clock);
  if (currentPhase !== 'day') paintHeadlightBeams(ctx, car);
  if (isHero) {
    ctx.strokeStyle = '#ffd94d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-car.w / 2 - 4, -car.h / 2 - 4, car.w + 8, car.h + 8, 10);
    ctx.stroke();
  }
  ctx.restore();
}

function paintVehicleShadow(ctx, car) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.roundRect(-car.w / 2 + 3, -car.h / 2 + 4, car.w, car.h, 8);
  ctx.fill();
}

function paintVehicleBody(ctx, car) {
  ctx.fillStyle = car.color;
  ctx.beginPath();
  ctx.roundRect(-car.w / 2, -car.h / 2, car.w, car.h, 8);
  ctx.fill();
}

function paintVehicleGlass(ctx, car) {
  ctx.fillStyle = 'rgba(20, 28, 40, 0.85)';
  ctx.beginPath();
  ctx.roundRect(-car.w / 2 + 5, -car.h / 2 + 12, car.w - 10, 14, 5);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-car.w / 2 + 5, car.h / 2 - 26, car.w - 10, 14, 5);
  ctx.fill();
}

/** Yellow lamps at the front, red lamps at the rear. */
function paintVehicleLamps(ctx, car) {
  const halfW = car.w / 2;
  const halfH = car.h / 2;
  ctx.fillStyle = '#ffd94d';
  ctx.fillRect(-halfW + 4, -halfH + 2, 5, 5);
  ctx.fillRect(halfW - 9, -halfH + 2, 5, 5);
  ctx.fillStyle = '#ff5a3c';
  ctx.fillRect(-halfW + 4, halfH - 7, 5, 5);
  ctx.fillRect(halfW - 9, halfH - 7, 5, 5);
}

/**
 * Roof markings: police cars flash red/blue and carry a PD tag, taxis
 * carry a TAXI tag. The flash alternates on the game clock.
 */
function paintVehicleBadge(ctx, car, clock) {
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  if (car.type === 'police') {
    const redFirst = Math.floor(clock * 4.5) % 2 === 0;
    ctx.fillStyle = redFirst ? '#ff3b30' : '#3a86ff';
    ctx.beginPath();
    ctx.arc(-4, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = redFirst ? '#3a86ff' : '#ff3b30';
    ctx.beginPath();
    ctx.arc(5, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText('PD', 0, 4);
  } else if (car.type === 'taxi') {
    ctx.fillStyle = '#22252a';
    ctx.fillText('TAXI', 0, 4);
  }
}

/**
 * Headlight beams for dusk and night: a fading cone ahead of the car
 * plus a soft glow pooled around each front lamp. Night beams reach
 * further and burn brighter than dusk ones.
 */
function paintHeadlightBeams(ctx, car) {
  const front = -car.h / 2;
  const reach = currentPhase === 'night' ? 110 : 75;
  const strength = currentPhase === 'night' ? 0.4 : 0.28;
  const beam = ctx.createLinearGradient(0, front, 0, front - reach);
  beam.addColorStop(0, `rgba(255, 224, 130, ${strength})`);
  beam.addColorStop(1, 'rgba(255, 224, 130, 0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(-car.w / 2 + 4, front);
  ctx.lineTo(car.w / 2 - 4, front);
  ctx.lineTo(car.w / 2 + 6, front - reach);
  ctx.lineTo(-car.w / 2 - 6, front - reach);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255, 226, 140, ${strength + 0.25})`;
  ctx.beginPath();
  ctx.arc(-car.w / 2 + 6, front + 4, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(car.w / 2 - 6, front + 4, 7, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * One person: a knocked-down pedestrian lies flat as an ellipse, a
 * standing one gets a shadow, a coloured body disc and a face dot in
 * the direction they face. The hero also gets a gold ring and, when
 * armed, the pistol line along his aim.
 */
function paintWalker(ctx, x, y, angle, color, down, isHero) {
  ctx.save();
  ctx.translate(x, y);
  if (down) {
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(2, 3, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8b98a';
  ctx.beginPath();
  ctx.arc(Math.cos(angle) * 4, Math.sin(angle) * 4, 5, 0, Math.PI * 2);
  ctx.fill();
  if (isHero) {
    ctx.strokeStyle = '#ffd94d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#22252a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 10, Math.sin(angle) * 10);
    ctx.lineTo(Math.cos(angle) * 20, Math.sin(angle) * 20);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Time-of-day tint
// ---------------------------------------------------------------------------

/** Wash the finished frame with the current phase's tints (screen space). */
function paintPhaseTint(ctx, view) {
  for (const wash of PHASE_TINTS[currentPhase]) {
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}
