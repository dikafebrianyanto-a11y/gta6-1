// Solmar itself: a seeded grid city on a grass island, ringed by sea, with a
// beach on the south shore and docks on the east. Roads run every eight tiles;
// the blocks between them hold buildings, parks and parking lots. Traffic
// drives a graph of the road intersections; everything else collides with
// the buildings and the water.
import { CITY_COLS, CITY_ROWS, PAL, ROAD_EVERY, ROAD_W, TILE, WORLD_H, WORLD_W } from './config.js';
import { rngKit, seedFromText } from './random.js';

const PARK_CHANCE = 0.12;
const LOT_CHANCE = 0.1;

/** Road centre-lines, in pixels, one per grid step. */
function roadLines(count) {
  const lines = [];
  for (let i = 0; i < count; i += 1) lines.push((i * ROAD_EVERY + 1) * TILE + TILE / 2);
  return lines;
}

/** The city Solmar, built once from a seed. */
export function buildCity(seedText) {
  const rng = rngKit(seedFromText(seedText));
  const roadX = roadLines(CITY_COLS / ROAD_EVERY);
  const roadY = roadLines(CITY_ROWS / ROAD_EVERY);
  const half = ROAD_W / 2;

  // Blocks between neighbouring roads, plus the strips along the edges.
  const blocks = [];
  for (let bx = 0; bx <= roadX.length; bx += 1) {
    const x0 = bx === 0 ? TILE : roadX[bx - 1] + half;
    const x1 = bx === roadX.length ? WORLD_W - TILE : roadX[bx] - half;
    for (let by = 0; by <= roadY.length; by += 1) {
      const y0 = by === 0 ? TILE : roadY[by - 1] + half;
      const y1 = by === roadY.length ? WORLD_H - TILE : roadY[by] - half;
      blocks.push({ x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
    }
  }

  const buildings = [];
  const parks = [];
  const trees = [];
  const lots = [];
  const beachTop = 60 * TILE;
  const waterTop = 62 * TILE;

  for (const b of blocks) {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    // The southern strip is beach, not blocks.
    if (b.y0 >= beachTop) continue;
    if (rng.chance(PARK_CHANCE)) {
      parks.push({ x: b.x0, y: b.y0, w, h });
      const treeCount = rng.int(4, 9);
      for (let i = 0; i < treeCount; i += 1) {
        trees.push({ x: rng.range(b.x0 + 20, b.x1 - 20), y: rng.range(b.y0 + 20, b.y1 - 20), r: rng.range(9, 15) });
      }
      continue;
    }
    if (rng.chance(LOT_CHANCE)) {
      lots.push({ x: b.x0, y: b.y0, w, h });
      continue;
    }
    const style = rng.pick(['single', 'pair', 'quad']);
    const inset = rng.range(14, 26);
    const color = rng.pick(PAL.building);
    const roof = rng.pick(PAL.roof);
    const height = rng.range(18, 62);
    if (style === 'single') {
      buildings.push({ x: b.x0 + inset, y: b.y0 + inset, w: w - inset * 2, h: h - inset * 2, color, roof, height });
    } else if (style === 'pair') {
      const vertical = rng.chance(0.5);
      if (vertical) {
        buildings.push({ x: b.x0 + inset, y: b.y0 + inset, w: w - inset * 2, h: h / 2 - inset - 6, color, roof, height });
        buildings.push({ x: b.x0 + inset, y: b.cy + 6, w: w - inset * 2, h: h / 2 - inset - 6, color: rng.pick(PAL.building), roof: rng.pick(PAL.roof), height: rng.range(18, 62) });
      } else {
        buildings.push({ x: b.x0 + inset, y: b.y0 + inset, w: w / 2 - inset - 6, h: h - inset * 2, color, roof, height });
        buildings.push({ x: b.cx + 6, y: b.y0 + inset, w: w / 2 - inset - 6, h: h - inset * 2, color: rng.pick(PAL.building), roof: rng.pick(PAL.roof), height: rng.range(18, 62) });
      }
    } else {
      const qw = w / 2 - inset - 4;
      const qh = h / 2 - inset - 4;
      for (const [qx, qy] of [[b.x0 + inset, b.y0 + inset], [b.cx + 4, b.y0 + inset], [b.x0 + inset, b.cy + 4], [b.cx + 4, b.cy + 4]]) {
        buildings.push({ x: qx, y: qy, w: qw, h: qh, color: rng.pick(PAL.building), roof: rng.pick(PAL.roof), height: rng.range(18, 62) });
      }
    }
  }

  // Intersection graph: nodes at every road crossing, edges to neighbours.
  const nodes = [];
  const nodeAt = new Map();
  for (let ix = 0; ix < roadX.length; ix += 1) {
    for (let iy = 0; iy < roadY.length; iy += 1) {
      const id = iy * roadX.length + ix;
      nodes.push({ id, x: roadX[ix], y: roadY[iy], ix, iy });
      nodeAt.set(`${ix},${iy}`, id);
    }
  }
  const neighbours = nodes.map((n) => {
    const out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const id = nodeAt.get(`${n.ix + dx},${n.iy + dy}`);
      if (id !== undefined) out.push(id);
    }
    return out;
  });

  // Named places, pinned to intersections so markers are always reachable.
  const at = (ix, iy, dx = 0, dy = 0) => ({ x: roadX[ix] + dx, y: roadY[iy] + dy });
  const markers = {
    marina: { ...at(1, 6, 0, 60), label: 'Marina' },
    hotel: { ...at(4, 3, 40, 0), label: 'Grand Solmar Hotel' },
    garage: { ...at(6, 4, -40, 0), label: "Ray's Garage" },
    casino: { ...at(6, 1, -40, 0), label: 'Casino Luna' },
    park: { ...at(3, 3, 0, 40), label: 'Palm Park' },
    docks: { ...at(7, 5, -60, 0), label: 'Harbor Docks' },
    safehouse: { ...at(1, 1, 40, 0), label: 'Safehouse' },
    bank: { ...at(4, 4, 40, 0), label: 'Solmar National Bank' },
    hospital: { ...at(1, 4, 40, 0), label: 'St. Anselm Hospital' },
    gunshop: { ...at(2, 6, 0, -40), label: 'Ammo & Iron' },
  };

  // Parked-car spots along road edges, offset onto the shoulder.
  const parkedSpots = [];
  for (let i = 0; i < 90; i += 1) {
    const vertical = rng.chance(0.5);
    const line = rng.pick(vertical ? roadX : roadY);
    const along = rng.range(TILE * 3, WORLD_W - TILE * 3);
    const side = rng.pick([-1, 1]) * (half - 14);
    // The car faces ALONG its road: north/south on a vertical road,
    // east/west on a horizontal one. (Facing across the road would point
    // every parked car straight at the building opposite it.)
    parkedSpots.push({
      x: vertical ? line + side : along,
      y: vertical ? along : line + side,
      angle: vertical ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2),
    });
  }

  const city = {
    seed: seedText,
    roadX,
    roadY,
    buildings,
    parks,
    trees,
    lots,
    nodes,
    neighbours,
    markers,
    beachTop,
    waterTop,
    spawn: { x: markers.marina.x, y: markers.marina.y + 30 },
    parkedSpots,
  };

  // --- Collision -----------------------------------------------------------
  city.pointSolid = (x, y, r = 0) => {
    if (x < r || y < r || x > WORLD_W - r || y > WORLD_H - r) return true;
    if (y > waterTop - r) return true;
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
    }
    return false;
  };

  /** Move a circle by (dx, dy), sliding along walls. Returns the new position. */
  city.slide = (x, y, r, dx, dy) => {
    let nx = x;
    let ny = y;
    if (!city.pointSolid(x + dx, y, r)) nx = x + dx;
    if (!city.pointSolid(nx, y + dy, r)) ny = y + dy;
    return { x: nx, y: ny };
  };

  /** True when a building stands between two points (sampled). */
  city.sightBlocked = (x0, y0, x1, y1) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.floor(dist / 24));
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let j = 0; j < buildings.length; j += 1) {
        const b = buildings[j];
        if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
      }
    }
    return false;
  };

  /** The road centre-line closest to a point, snapped onto it. */
  city.nearestRoad = (x, y) => {
    let bestX = roadX[0];
    let bestY = roadY[0];
    for (const rx of roadX) if (Math.abs(rx - x) < Math.abs(bestX - x)) bestX = rx;
    for (const ry of roadY) if (Math.abs(ry - y) < Math.abs(bestY - y)) bestY = ry;
    return Math.abs(bestX - x) < Math.abs(bestY - y) ? { x: bestX, y, vertical: true } : { x, y: bestY, vertical: false };
  };

  return city;
}
