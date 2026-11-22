// Solmar: a seeded island city with a road grid, block fill, and a
// beachfront district on the south shore — a promenade avenue, beach
// huts on the sand, and a wooden pier reaching out past the waterline.
// Traffic runs on the intersection graph; everything solid (buildings,
// water, the island edge) blocks movement, except the pier deck, which
// stays walkable even though it stands over the sea.
import { CITY_COLS, CITY_ROWS, PAL, ROAD_EVERY, ROAD_W, TILE, WORLD_H, WORLD_W } from './config.js';
import { rngKit, seedFromText } from './random.js';

// Odds that a block becomes a park or a parking lot instead of buildings.
const PARK_ODDS = 0.12;
const LOT_ODDS = 0.1;

// Beachfront tuning: where the sand starts, where the sea starts, how
// wide the pier deck is, and how far apart its pilings stand.
const BEACH_ROW = 60;
const SEA_ROW = 62;
const PIER_HALF_W = 20;
const PIER_PILING_GAP = 48;
const HUT_COUNT = 7;
const PROMENADE_SPOTS = 10;

/** Pixel centres of the road lines across `steps` grid columns/rows. */
function roadCentres(steps) {
  const centres = [];
  for (let step = 0; step < steps; step += 1) {
    centres.push((step * ROAD_EVERY + 1) * TILE + TILE / 2);
  }
  return centres;
}

/**
 * The rectangles between neighbouring roads, plus the edge strips.
 * Each block carries its corners and its centre for splitting later.
 */
function blockRects(xs, ys) {
  const halfRoad = ROAD_W / 2;
  const rects = [];
  for (let bx = 0; bx <= xs.length; bx += 1) {
    const left = bx === 0 ? TILE : xs[bx - 1] + halfRoad;
    const right = bx === xs.length ? WORLD_W - TILE : xs[bx] - halfRoad;
    for (let by = 0; by <= ys.length; by += 1) {
      const top = by === 0 ? TILE : ys[by - 1] + halfRoad;
      const bottom = by === ys.length ? WORLD_H - TILE : ys[by] - halfRoad;
      rects.push({ x0: left, y0: top, x1: right, y1: bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 });
    }
  }
  return rects;
}

/** One building record, with a fresh wall colour, roof and height. */
function makeBuilding(rng, x, y, w, h) {
  return {
    x,
    y,
    w,
    h,
    color: rng.pick(PAL.building),
    roof: rng.pick(PAL.roof),
    height: rng.range(18, 62),
  };
}

/** Split a block into two buildings, side by side or stacked. */
function splitPair(rng, block, inset, buckets) {
  const w = block.x1 - block.x0;
  const h = block.y1 - block.y0;
  const first = makeBuilding(rng, block.x0 + inset, block.y0 + inset, 0, 0);
  if (rng.chance(0.5)) {
    // Stacked: one above the other, sharing the full width.
    first.w = w - inset * 2;
    first.h = h / 2 - inset - 6;
    buckets.buildings.push(first);
    buckets.buildings.push(makeBuilding(rng, block.x0 + inset, block.cy + 6, w - inset * 2, h / 2 - inset - 6));
  } else {
    // Side by side, sharing the full height.
    first.w = w / 2 - inset - 6;
    first.h = h - inset * 2;
    buckets.buildings.push(first);
    buckets.buildings.push(makeBuilding(rng, block.cx + 6, block.y0 + inset, w / 2 - inset - 6, h - inset * 2));
  }
}

/** Split a block into four small buildings, one per quadrant. */
function splitQuad(rng, block, inset, buckets) {
  const w = block.x1 - block.x0;
  const h = block.y1 - block.y0;
  const qw = w / 2 - inset - 4;
  const qh = h / 2 - inset - 4;
  const corners = [
    [block.x0 + inset, block.y0 + inset],
    [block.cx + 4, block.y0 + inset],
    [block.x0 + inset, block.cy + 4],
    [block.cx + 4, block.cy + 4],
  ];
  for (const [qx, qy] of corners) buckets.buildings.push(makeBuilding(rng, qx, qy, qw, qh));
}

/**
 * Fill one block: a park (with trees), a parking lot, or one, two or
 * four buildings, depending on the seeded rolls.
 */
function fillBlock(rng, block, buckets) {
  const w = block.x1 - block.x0;
  const h = block.y1 - block.y0;
  if (rng.chance(PARK_ODDS)) {
    buckets.parks.push({ x: block.x0, y: block.y0, w, h });
    const treeCount = rng.int(4, 9);
    for (let i = 0; i < treeCount; i += 1) {
      buckets.trees.push({
        x: rng.range(block.x0 + 20, block.x1 - 20),
        y: rng.range(block.y0 + 20, block.y1 - 20),
        r: rng.range(9, 15),
      });
    }
    return;
  }
  if (rng.chance(LOT_ODDS)) {
    buckets.lots.push({ x: block.x0, y: block.y0, w, h });
    return;
  }
  const inset = rng.range(14, 26);
  const layout = rng.pick(['single', 'pair', 'quad']);
  if (layout === 'single') {
    buckets.buildings.push(makeBuilding(rng, block.x0 + inset, block.y0 + inset, w - inset * 2, h - inset * 2));
  } else if (layout === 'pair') {
    splitPair(rng, block, inset, buckets);
  } else {
    splitQuad(rng, block, inset, buckets);
  }
}

/**
 * The traffic graph: one node per road crossing, each linked to its
 * four orthogonal neighbours (fewer on the edges).
 */
function linkIntersections(xs, ys) {
  const nodes = [];
  const lookup = new Map();
  for (let ix = 0; ix < xs.length; ix += 1) {
    for (let iy = 0; iy < ys.length; iy += 1) {
      const id = iy * xs.length + ix;
      nodes.push({ id, x: xs[ix], y: ys[iy], ix, iy });
      lookup.set(`${ix},${iy}`, id);
    }
  }
  const neighbours = nodes.map((node) => {
    const links = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const id = lookup.get(`${node.ix + dx},${node.iy + dy}`);
      if (id !== undefined) links.push(id);
    }
    return links;
  });
  return { nodes, neighbours };
}

/**
 * The beachfront district, laid along the south shore. A promenade
 * avenue runs the full width just above the sand; low huts and palms
 * dot the beach itself; a pier juts south from the sand into the sea,
 * ending in a wider fishing platform. Returns the promenade line, the
 * pier geometry (deck, platform, pilings), and the huts to add to the
 * building list.
 */
function buildBeachfront(rng, xs, beachTop, waterTop) {
  const promenadeY = beachTop - TILE;
  const pierX = xs[2];
  // The deck runs from the sand to just short of the island's south edge.
  const deck = { x: pierX - PIER_HALF_W, y: beachTop, w: PIER_HALF_W * 2, h: WORLD_H - beachTop - TILE / 4 };
  const platform = {
    x: pierX - 60,
    y: deck.y + deck.h - TILE,
    w: 120,
    h: TILE,
  };
  const pilings = [];
  for (let y = deck.y + 12; y < deck.y + deck.h; y += PIER_PILING_GAP) {
    pilings.push({ x: deck.x - 4, y });
    pilings.push({ x: deck.x + deck.w - 4, y });
  }
  // Huts sit on the sand in a loose row, leaving gaps to walk between.
  const huts = [];
  const hutPalette = ['#d9a05b', '#c96f4a', '#7ba07a', '#8fa8bf'];
  for (let i = 0; i < HUT_COUNT; i += 1) {
    const hx = TILE * 4 + i * ((WORLD_W - TILE * 8) / HUT_COUNT) + rng.range(-30, 30);
    // Keep the pier's approach clear of huts.
    if (Math.abs(hx - pierX) < TILE * 2) continue;
    huts.push({
      x: hx,
      y: beachTop + rng.range(8, 26),
      w: rng.range(52, 76),
      h: rng.range(40, 54),
      color: rng.pick(hutPalette),
      roof: rng.pick(PAL.roof),
      height: rng.range(10, 18),
      kind: 'hut',
    });
  }
  // Palms along the sand, north of the huts, for shade.
  const palms = [];
  for (let i = 0; i < 14; i += 1) {
    const px = TILE * 2 + i * ((WORLD_W - TILE * 4) / 14) + rng.range(-24, 24);
    if (Math.abs(px - pierX) < TILE) continue;
    palms.push({ x: px, y: beachTop + rng.range(4, 18), r: rng.range(11, 16) });
  }
  return { promenadeY, pier: { deck, platform, pilings }, huts, palms };
}

/** Named places, pinned to intersections (and the pier) so they are reachable. */
function placeMarkers(xs, ys, pier) {
  const at = (ix, iy, dx = 0, dy = 0) => ({ x: xs[ix] + dx, y: ys[iy] + dy });
  return {
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
    beachfront: { ...at(5, 7, 0, 40), label: 'Solmar Beachfront' },
    pier: { x: pier.deck.x + pier.deck.w / 2, y: pier.platform.y + pier.platform.h / 2, label: 'Sunset Pier' },
  };
}

/** Parked-car spots along road edges, facing along their road. */
function parkedSpots(rng, xs, ys, halfRoad, promenadeY) {
  const spots = [];
  for (let i = 0; i < 90; i += 1) {
    const vertical = rng.chance(0.5);
    const line = rng.pick(vertical ? xs : ys);
    const along = rng.range(TILE * 3, WORLD_W - TILE * 3);
    const side = rng.pick([-1, 1]) * (halfRoad - 14);
    // A parked car faces ALONG its road: north/south on a vertical road,
    // east/west on a horizontal one. Facing across the road would point
    // every parked car straight at the building opposite it.
    spots.push({
      x: vertical ? line + side : along,
      y: vertical ? along : line + side,
      angle: vertical ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2),
    });
  }
  // A few more cars nose-in along the promenade, facing the sea.
  for (let i = 0; i < PROMENADE_SPOTS; i += 1) {
    spots.push({
      x: TILE * 4 + i * ((WORLD_W - TILE * 8) / PROMENADE_SPOTS),
      y: promenadeY - halfRoad + 16,
      angle: Math.PI / 2,
    });
  }
  return spots;
}

/** The city Solmar, built once from a seed. */
export function buildCity(seedText) {
  const rng = rngKit(seedFromText(seedText));
  const roadX = roadCentres(CITY_COLS / ROAD_EVERY);
  const gridY = roadCentres(CITY_ROWS / ROAD_EVERY);
  const halfRoad = ROAD_W / 2;
  const beachTop = BEACH_ROW * TILE;
  const waterTop = SEA_ROW * TILE;

  // The beachfront district comes first: its promenade is a real road,
  // so it joins the grid before the traffic graph is linked.
  const beachfront = buildBeachfront(rng, roadX, beachTop, waterTop);
  const roadY = [...gridY, beachfront.promenadeY];

  // Fill the blocks, skipping the strip the promenade and beach occupy.
  const buckets = { buildings: [], parks: [], trees: [], lots: [] };
  for (const block of blockRects(roadX, gridY)) {
    if (block.y0 >= beachTop - TILE * 3) continue;
    fillBlock(rng, block, buckets);
  }
  buckets.buildings.push(...beachfront.huts);
  buckets.trees.push(...beachfront.palms);

  const { nodes, neighbours } = linkIntersections(roadX, roadY);
  const markers = placeMarkers(roadX, gridY, beachfront.pier);
  const spots = parkedSpots(rng, roadX, gridY, halfRoad, beachfront.promenadeY);

  const city = {
    seed: seedText,
    roadX,
    roadY,
    buildings: buckets.buildings,
    parks: buckets.parks,
    trees: buckets.trees,
    lots: buckets.lots,
    nodes,
    neighbours,
    markers,
    beachTop,
    waterTop,
    promenadeY: beachfront.promenadeY,
    pier: beachfront.pier,
    spawn: { x: markers.marina.x, y: markers.marina.y + 30 },
    parkedSpots: spots,
  };

  /** True when the point is on the pier deck or its end platform. */
  const onPier = (x, y, r) => {
    const { deck, platform } = beachfront.pier;
    const deckHit = x + r > deck.x && x - r < deck.x + deck.w && y + r > deck.y && y - r < deck.y + deck.h;
    const platHit = x + r > platform.x && x - r < platform.x + platform.w && y + r > platform.y && y - r < platform.y + platform.h;
    return deckHit || platHit;
  };

  // --- Collision -----------------------------------------------------------
  city.pointSolid = (x, y, r = 0) => {
    if (x < r || y < r || x > WORLD_W - r || y > WORLD_H - r) return true;
    // The sea blocks movement — except on the pier, which stands over it.
    if (y > waterTop - r && !onPier(x, y, r)) return true;
    for (let i = 0; i < buckets.buildings.length; i += 1) {
      const b = buckets.buildings[i];
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
      for (let j = 0; j < buckets.buildings.length; j += 1) {
        const b = buckets.buildings[j];
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
