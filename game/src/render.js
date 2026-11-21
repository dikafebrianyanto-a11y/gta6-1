// Drawing the world: sea around the island, grass, beach, roads with lane
// dashes, buildings with long sun shadows, parks and trees, then every
// car, pedestrian, cop and bullet, and the mission beacon. The camera
// transform is set by main; this file only paints what the viewport holds.
import { PAL, WORLD_H, WORLD_W } from './config.js';
import { drawEffects } from './effects.js';

/** A renderer bound to one canvas; resize follows the window. */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0, dpr: 1 };

  function resize() {
    view.dpr = window.devicePixelRatio || 1;
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
  }
  resize();
  window.addEventListener('resize', resize);

  /** Paint the whole frame: world, entities, effects, then the HUD. */
  function draw(g) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    // The island floats in the sea.
    ctx.fillStyle = PAL.seaDeep;
    ctx.fillRect(0, 0, view.w, view.h);
    const cam = g.camera;
    ctx.save();
    ctx.translate(-cam.x + g.fx.shakeX, -cam.y + g.fx.shakeY);
    drawGround(ctx, g);
    drawEntities(ctx, g);
    drawEffects(ctx, g.fx);
    ctx.restore();
  }

  return { ctx, view, draw };
}

function inView(cam, x, y, pad = 120) {
  return x > cam.x - pad && x < cam.x + cam.w + pad && y > cam.y - pad && y < cam.y + cam.h + pad;
}

function drawGround(ctx, g) {
  const city = g.city;
  const cam = g.camera;
  // Land base.
  ctx.fillStyle = PAL.grass;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  // Dry patches for variety.
  ctx.fillStyle = PAL.grassDry;
  for (let i = 0; i < 24; i += 1) {
    const x = ((i * 977) % WORLD_W) - 100;
    const y = ((i * 571) % WORLD_H) - 100;
    if (!inView(cam, x, y, 200)) continue;
    ctx.beginPath();
    ctx.ellipse(x, y, 130, 80, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Beach and sea at the south edge.
  ctx.fillStyle = PAL.sand;
  ctx.fillRect(0, city.beachTop, WORLD_W, city.waterTop - city.beachTop);
  ctx.fillStyle = PAL.sea;
  ctx.fillRect(0, city.waterTop, WORLD_W, WORLD_H - city.waterTop);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let x = 0; x < WORLD_W; x += 96) {
    ctx.fillRect(x + ((g.time * 12) % 96), city.waterTop + 8, 40, 3);
  }
  // Parks and their trees.
  for (const park of city.parks) {
    if (!inView(cam, park.x + park.w / 2, park.y + park.h / 2, 200)) continue;
    ctx.fillStyle = PAL.park;
    ctx.fillRect(park.x, park.y, park.w, park.h);
  }
  for (const tree of city.trees) {
    if (!inView(cam, tree.x, tree.y)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
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
  // Parking lots: pale slabs with bay lines.
  for (const lot of city.lots) {
    if (!inView(cam, lot.x + lot.w / 2, lot.y + lot.h / 2, 200)) continue;
    ctx.fillStyle = '#8f8a82';
    ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let x = lot.x + 24; x < lot.x + lot.w - 10; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, lot.y + 10);
      ctx.lineTo(x, lot.y + lot.h - 10);
      ctx.stroke();
    }
  }
  drawRoads(ctx, g);
  drawBuildings(ctx, g);
}

function drawRoads(ctx, g) {
  const city = g.city;
  const cam = g.camera;
  ctx.fillStyle = PAL.asphalt;
  for (const rx of city.roadX) ctx.fillRect(rx - 48, 0, 96, WORLD_H);
  for (const ry of city.roadY) ctx.fillRect(0, ry - 48, WORLD_W, 96);
  // Sidewalk strips along every road edge.
  ctx.fillStyle = PAL.sidewalk;
  for (const rx of city.roadX) {
    ctx.fillRect(rx - 48, 0, 10, WORLD_H);
    ctx.fillRect(rx + 38, 0, 10, WORLD_H);
  }
  for (const ry of city.roadY) {
    ctx.fillRect(0, ry - 48, WORLD_W, 10);
    ctx.fillRect(0, ry + 38, WORLD_W, 10);
  }
  // Centre dashes, skipped near intersections so the crossings read clean.
  ctx.fillStyle = PAL.lane;
  for (const rx of city.roadX) {
    for (let y = 0; y < WORLD_H; y += 48) {
      if (city.roadY.some((ry) => Math.abs(y + 24 - ry) < 60)) continue;
      if (!inView(cam, rx, y)) continue;
      ctx.fillRect(rx - 2, y + 8, 4, 24);
    }
  }
  for (const ry of city.roadY) {
    for (let x = 0; x < WORLD_W; x += 48) {
      if (city.roadX.some((rx) => Math.abs(x + 24 - rx) < 60)) continue;
      if (!inView(cam, x, ry)) continue;
      ctx.fillRect(x + 8, ry - 2, 24, 4);
    }
  }
}

function drawBuildings(ctx, g) {
  const cam = g.camera;
  for (const b of g.city.buildings) {
    if (!inView(cam, b.x + b.w / 2, b.y + b.h / 2, 120)) continue;
    // Long afternoon shadow to the north-east.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x + 10, b.y + 12, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, 6);
    // Windows along the walls.
    ctx.fillStyle = 'rgba(20,24,32,0.5)';
    for (let wx = b.x + 16; wx < b.x + b.w - 12; wx += 26) {
      for (let wy = b.y + 18; wy < b.y + b.h - 12; wy += 30) {
        ctx.fillRect(wx, wy, 12, 16);
      }
    }
  }
}

function drawCar(ctx, car, isPlayer) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.roundRect(-car.w / 2 + 3, -car.h / 2 + 4, car.w, car.h, 8);
  ctx.fill();
  ctx.fillStyle = car.color;
  ctx.beginPath();
  ctx.roundRect(-car.w / 2, -car.h / 2, car.w, car.h, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(20,28,40,0.85)';
  ctx.beginPath();
  ctx.roundRect(-car.w / 2 + 5, -car.h / 2 + 12, car.w - 10, 14, 5);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-car.w / 2 + 5, car.h / 2 - 26, car.w - 10, 14, 5);
  ctx.fill();
  ctx.fillStyle = '#ffd94d';
  ctx.fillRect(-car.w / 2 + 4, -car.h / 2 + 2, 5, 5);
  ctx.fillRect(car.w / 2 - 9, -car.h / 2 + 2, 5, 5);
  ctx.fillStyle = '#ff5a3c';
  ctx.fillRect(-car.w / 2 + 4, car.h / 2 - 7, 5, 5);
  ctx.fillRect(car.w / 2 - 9, car.h / 2 - 7, 5, 5);
  if (car.type === 'police') {
    const flash = Math.floor(performance.now() / 220) % 2 === 0;
    ctx.fillStyle = flash ? '#ff3b30' : '#3a86ff';
    ctx.beginPath();
    ctx.arc(-4, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#3a86ff' : '#ff3b30';
    ctx.beginPath();
    ctx.arc(5, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PD', 0, 4);
  }
  if (car.type === 'taxi') {
    ctx.fillStyle = '#22252a';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TAXI', 0, 4);
  }
  if (isPlayer) {
    ctx.strokeStyle = '#ffd94d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-car.w / 2 - 4, -car.h / 2 - 4, car.w + 8, car.h + 8, 10);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPerson(ctx, x, y, angle, color, down, isPlayer) {
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
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
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
  if (isPlayer) {
    ctx.strokeStyle = '#ffd94d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
    // The pistol, when Dex is armed and aiming.
    ctx.strokeStyle = '#22252a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 10, Math.sin(angle) * 10);
    ctx.lineTo(Math.cos(angle) * 20, Math.sin(angle) * 20);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEntities(ctx, g) {
  const cam = g.camera;
  // Mission beacon: a pulsing ring and a shaft of light.
  const mark = g.missionMarker;
  if (mark && inView(cam, mark.x, mark.y, 200)) {
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
  // Sun coins.
  for (const coin of g.missions.coins) {
    if (coin.taken || !inView(cam, coin.x, coin.y)) continue;
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8860b';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$', coin.x, coin.y + 4);
  }
  // Fare rider.
  const fare = g.missions.fare;
  if (fare && fare.phase === 'pickup' && inView(cam, fare.x, fare.y)) {
    ctx.fillStyle = '#7ddb6a';
    ctx.beginPath();
    ctx.arc(fare.x, fare.y - 24, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0c0e14';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$', fare.x, fare.y - 20);
  }
  for (const car of g.cars) {
    if (inView(cam, car.x, car.y, 80)) drawCar(ctx, car, car === g.player.inCar);
  }
  for (const ped of g.traffic.peds) {
    if (inView(cam, ped.x, ped.y)) drawPerson(ctx, ped.x, ped.y, ped.angle, ped.color, ped.down, false);
  }
  for (const e of g.enemies) {
    if (!e.alive || !inView(cam, e.x, e.y)) continue;
    drawPerson(ctx, e.x, e.y, e.angle, e.kind === 'cop' ? '#2e4a6b' : '#8a2f2f', false, false);
    if (e.kind === 'cop') {
      ctx.fillStyle = '#2e4a6b';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PD', e.x, e.y - 16);
    }
  }
  const p = g.player;
  if (!p.inCar) {
    const blink = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0;
    if (!blink) drawPerson(ctx, p.x, p.y, p.angle, '#3a6ea5', false, true);
  }
  // Bullets as short bright streaks.
  ctx.strokeStyle = '#ffe9a8';
  ctx.lineWidth = 3;
  for (const b of g.bullets) {
    const len = 14;
    const inv = 1 / Math.hypot(b.vx, b.vy);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * inv * len, b.y - b.vy * inv * len);
    ctx.stroke();
  }
}
