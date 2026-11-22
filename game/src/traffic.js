// Solmar street life: the cars that cruise the road graph, the buses that
// run straight routes through it, and the pedestrians who stroll the
// sidewalks until something scares them. Traffic never needs the player's
// attention — it just has to feel like a city that was already moving
// before Dex arrived, and keeps moving after he leaves.
//
// Two behaviours worth knowing about:
// - Buses follow fixed routes: at every junction they keep going as
//   straight as the grid allows instead of picking a random turn, so the
//   same yellow bus keeps reappearing along the same avenues.
// - Yielding: when a police chase is on, nearby drivers brake to a halt
//   and wait for the sirens to pass. Taxis and buses yield from further
//   away than ordinary sedans — they are the ones with passengers to
//   protect and schedules to keep.
import { DEFAULT_DIFFICULTY, DIFFICULTY, PEDS, TRAFFIC } from './config.js';
import { makeCar, separateCars } from './vehicles.js';
import { rngKit } from './random.js';
import { raiseHeat } from './player.js';

// How far away a siren has to be before a driver decides to pull over and
// wait. Working vehicles (taxis, buses) are more cautious than commuters.
const YIELD_RADIUS_WORKING = 320;
const YIELD_RADIUS_NORMAL = 220;
const YIELD_CLEAR_RADIUS = 360;

// A bus is a truck body painted school-bus yellow, slow, and route-bound.
const BUS_COLOR = '#e8c33a';
const BUS_EVERY_NTH = 8;
const BUS_CRUISE_MIN = 95;
const BUS_CRUISE_MAX = 130;

const PAINT_JOBS = ['#c23b2e', '#2e6fc2', '#e8c33a', '#e8e4da', '#3aa655', '#7a4fc2', '#d97b2b'];
const PED_SHIRTS = ['#e8e4da', '#3a6ea5', '#c25b7a', '#4a7a3a', '#d9a05b', '#7a4fc2'];

/**
 * Resolve the difficulty preset for a game state, falling back to the
 * default preset when nothing usable is set. Accepts the same places the
 * HUD looks: g.difficulty, then g.settings / g.options.
 */
function presetForDifficulty(name) {
  const key = typeof name === 'string' ? name.toLowerCase() : '';
  return DIFFICULTY[key] ?? DIFFICULTY[DEFAULT_DIFFICULTY];
}

/** Wrap any angle difference into the -PI..PI range. */
function wrapAngle(diff) {
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** The unit vector a car with this heading actually travels along. */
function headingOf(angle) {
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

/**
 * Pick the next junction for a car arriving at `nodeId`. Route vehicles
 * (buses) take the exit that keeps them going straightest; everyone else
 * takes a random exit, which is what makes ordinary traffic feel aimless.
 */
function chooseNextNode(city, car, nodeId) {
  const exits = city.neighbours[nodeId];
  if (!car.route) return exits[Math.floor(Math.random() * exits.length)];
  const forward = headingOf(car.angle);
  let best = exits[0];
  let bestTurn = Infinity;
  for (const id of exits) {
    const node = city.nodes[id];
    const leg = Math.hypot(node.x - car.x, node.y - car.y) || 1;
    const along = ((node.x - car.x) / leg) * forward.x + ((node.y - car.y) / leg) * forward.y;
    // `along` near 1 means straight ahead; near -1 means a U-turn.
    const turn = 1 - along;
    if (turn < bestTurn) {
      bestTurn = turn;
      best = id;
    }
  }
  return best;
}

/** Roll one traffic car onto a random junction, heading for a neighbour. */
function dealTrafficCar(rng, city, index) {
  const isBus = index % BUS_EVERY_NTH === 3;
  const node = city.nodes[rng.int(0, city.nodes.length - 1)];
  const exits = city.neighbours[node.id];
  const next = exits[rng.int(0, exits.length - 1)];
  let type = 'sedan';
  if (isBus) type = 'truck';
  else if (rng.chance(0.08)) type = 'truck';
  else if (rng.chance(0.12)) type = 'taxi';
  const color = isBus ? BUS_COLOR : rng.pick(PAINT_JOBS);
  const car = makeCar(type, node.x, node.y, 0, color);
  car.node = node.id;
  car.next = next;
  car.cruise = isBus
    ? rng.range(BUS_CRUISE_MIN, BUS_CRUISE_MAX)
    : rng.range(TRAFFIC.cruiseMin, TRAFFIC.cruiseMax);
  car.speed = car.cruise;
  car.blocked = 0;
  car.occupied = true;
  car.driver = { kind: 'driver' };
  // Buses are route vehicles; taxis and buses both yield early to sirens.
  car.route = isBus;
  car.yielding = false;
  car.yieldTimer = 0;
  return car;
}

/** Roll one pedestrian onto a sidewalk near a random junction. */
function dealPedestrian(rng, city) {
  const node = city.nodes[rng.int(0, city.nodes.length - 1)];
  return {
    x: node.x + rng.range(-80, 80),
    y: node.y + rng.range(-80, 80),
    angle: rng.range(0, Math.PI * 2),
    speed: rng.range(PEDS.walkMin, PEDS.walkMax),
    color: rng.pick(PED_SHIRTS),
    fleeing: false,
    fleeTimer: 0,
    down: false,
    downTimer: 0,
    wander: rng.range(2, 6),
  };
}

/**
 * Traffic and pedestrian crowds, seeded with the city.
 *
 * `difficulty` is the difficulty preset name (easy / normal / hard) and
 * scales how many cars spawn, via its trafficDensity. Defaults to the
 * normal preset; pass g.difficulty when the game state is available.
 */
export function createTraffic(city, seed, difficulty = DEFAULT_DIFFICULTY) {
  const preset = presetForDifficulty(difficulty);
  const rng = rngKit(seed + 101);
  const carCount = Math.max(8, Math.round(TRAFFIC.count * preset.trafficDensity));
  const cars = [];
  for (let i = 0; i < carCount; i += 1) cars.push(dealTrafficCar(rng, city, i));
  const peds = [];
  for (let i = 0; i < PEDS.count; i += 1) peds.push(dealPedestrian(rng, city));
  return { cars, peds, rng };
}

/** Parked cars along the shoulders, from the city's spots. */
export function spawnParked(city, seed, count = 34) {
  const rng = rngKit(seed + 202);
  const out = [];
  const placed = [];
  for (const spot of rng.shuffle(city.parkedSpots)) {
    if (out.length >= count) break;
    // Spots are random, so two can land on each other: keep a gap between
    // the cars that are actually placed, or they spawn stacked.
    if (placed.some((p) => Math.hypot(p.x - spot.x, p.y - spot.y) < 70)) continue;
    placed.push(spot);
    const type = rng.chance(0.06) ? 'sports' : rng.chance(0.1) ? 'truck' : 'sedan';
    const car = makeCar(type, spot.x, spot.y, spot.angle, rng.pick(PAINT_JOBS));
    out.push(car);
  }
  return out;
}

/**
 * The traffic cars currently pulled over waiting for a police chase to
 * pass. A HUD or mission script can read this without digging into the
 * crowd itself.
 */
export function yieldingCars(traffic) {
  return traffic.cars.filter((car) => car.yielding);
}

/**
 * How close the nearest police car is to this traffic car, or Infinity
 * when no chase is running at all. Yielding only matters while wanted.
 */
function nearestSirenDistance(g, car) {
  if (!g.police || g.wanted <= 0) return Infinity;
  let closest = Infinity;
  for (const cop of g.police.cars) {
    const d = Math.hypot(cop.x - car.x, cop.y - car.y);
    if (d < closest) closest = d;
  }
  return closest;
}

/**
 * The gap to the car directly ahead of this one, in the direction it is
 * facing. Infinity when the road ahead is clear.
 */
function gapAhead(g, car) {
  let gap = Infinity;
  const forward = headingOf(car.angle);
  for (const other of g.traffic.cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const ahead = dx * forward.x + dy * forward.y;
    if (ahead <= 0) continue;
    const d = Math.hypot(dx, dy);
    if (d < gap) gap = d;
  }
  return gap;
}

/** Steer one traffic car one step along the road graph. */
function stepTrafficCar(g, car, dt) {
  const { city } = g;
  const destination = city.nodes[car.next];
  const dx = destination.x - car.x;
  const dy = destination.y - car.y;
  const dist = Math.hypot(dx, dy);
  const wantAngle = Math.atan2(dx, -dy);
  const diff = wrapAngle(wantAngle - car.angle);
  car.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));

  // Yielding: a chase rolling past makes drivers brake to a halt and sit
  // it out. Working vehicles react from further away; once the sirens are
  // well clear, the driver pulls back into the flow.
  const siren = nearestSirenDistance(g, car);
  const yieldAt = car.route || car.type === 'taxi' ? YIELD_RADIUS_WORKING : YIELD_RADIUS_NORMAL;
  if (siren < yieldAt) {
    car.yielding = true;
    car.yieldTimer = 0;
  } else if (car.yielding && siren > YIELD_CLEAR_RADIUS) {
    car.yielding = false;
  }
  if (car.yielding) car.yieldTimer += dt;

  // Slow for a hard turn: at full speed the car swings wide and clips the
  // building on the corner of the crossing.
  const turnSlow = 1 - Math.min(1, Math.abs(diff) / 2.5) * 0.6;
  // Slow for the car ahead, so traffic bunches instead of overlapping.
  const gap = gapAhead(g, car);
  let want = gap < TRAFFIC.followGap ? 0 : car.cruise * turnSlow;
  if (car.yielding) want = 0;
  // A car stopped behind another for a while creeps forward: without it,
  // two cars waiting on each other at a crossing wait forever.
  if (want === 0 && car.speed < 5) car.blocked += dt;
  else car.blocked = 0;
  const targetSpeed = car.blocked > 1.5 ? 40 : want;
  car.speed += Math.max(-300 * dt, Math.min(200 * dt, targetSpeed - car.speed));
  const forward = headingOf(car.angle);
  car.x += forward.x * car.speed * dt;
  car.y += forward.y * car.speed * dt;
  if (Math.hypot(destination.x - car.x, destination.y - car.y) < 26 || dist < 26) {
    car.node = car.next;
    car.next = chooseNextNode(city, car, car.node);
  }
}

/** Push apart any two cars whose boxes overlap. */
function unstackCars(cars) {
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i];
      const b = cars[j];
      if (Math.abs(a.x - b.x) < 40 && Math.abs(a.y - b.y) < 40) separateCars(a, b);
    }
  }
}

/** One pedestrian's step: stroll, flee, or lie where they fell. */
function stepPedestrian(g, ped, dt) {
  const { city, player } = g;
  if (ped.down) {
    ped.downTimer -= dt;
    if (ped.downTimer > 0) return;
    // Back on their feet somewhere else in the city, good as new.
    const node = city.nodes[Math.floor(Math.random() * city.nodes.length)];
    ped.down = false;
    ped.x = node.x;
    ped.y = node.y;
    return;
  }
  // Flee the player's car, gunfire, or a cop chase nearby.
  const threatX = player.inCar ? player.inCar.x : player.x;
  const threatY = player.inCar ? player.inCar.y : player.y;
  const threatD = Math.hypot(ped.x - threatX, ped.y - threatY);
  const playerSpeed = player.inCar ? Math.abs(player.inCar.speed) : player.speed;
  if ((threatD < PEDS.fleeRadius && playerSpeed > 120) || g.gunshotTimer > 0) {
    ped.fleeing = true;
    ped.fleeTimer = 2;
  }
  if (ped.fleeing) {
    ped.fleeTimer -= dt;
    if (ped.fleeTimer <= 0) ped.fleeing = false;
    const away = Math.atan2(ped.y - threatY, ped.x - threatX);
    ped.angle = away;
    const pos = city.slide(ped.x, ped.y, 10, Math.cos(away) * PEDS.fleeSpeed * dt, Math.sin(away) * PEDS.fleeSpeed * dt);
    ped.x = pos.x;
    ped.y = pos.y;
    return;
  }
  ped.wander -= dt;
  if (ped.wander <= 0) {
    ped.wander = Math.random() * 4 + 2;
    ped.angle += (Math.random() - 0.5) * 2.2;
  }
  const pos = city.slide(ped.x, ped.y, 10, Math.cos(ped.angle) * ped.speed * dt, Math.sin(ped.angle) * ped.speed * dt);
  ped.x = pos.x;
  ped.y = pos.y;
}

/** One traffic step: cars cruise their graph, peds stroll and flee. */
export function updateTraffic(g, dt) {
  for (const car of g.traffic.cars) stepTrafficCar(g, car, dt);
  // Keep traffic cars from piling into each other at intersections.
  unstackCars(g.traffic.cars);
  // And off the parked cars on the shoulder: the follow-gap above only
  // watches traffic, so a turning car would otherwise sit on a parked one.
  for (const car of g.traffic.cars) {
    for (const parked of g.cars) {
      if (parked.occupied || parked === car) continue;
      if (Math.abs(car.x - parked.x) < 40 && Math.abs(car.y - parked.y) < 40) separateCars(car, parked);
    }
  }
  for (const ped of g.traffic.peds) stepPedestrian(g, ped, dt);
}

/** A pedestrian hit by a car: down they go, and the law notices. */
export function knockPed(g, ped) {
  if (ped.down) return;
  ped.down = true;
  ped.downTimer = 6;
  raiseHeat(g, 1, 'hit pedestrian');
}
