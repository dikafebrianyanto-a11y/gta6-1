// The city's other life: traffic cars that follow the road graph, and
// pedestrians who stroll the sidewalks and run from trouble. Both keep the
// streets feeling full without ever needing the player's attention.
import { CAR_TYPES, PEDS, TRAFFIC } from './config.js';
import { makeCar, separateCars } from './vehicles.js';
import { rngKit } from './random.js';
import { raiseHeat } from './player.js';

/** Traffic and pedestrian crowds, seeded with the city. */
export function createTraffic(city, seed) {
  const rng = rngKit(seed + 101);
  const cars = [];
  for (let i = 0; i < TRAFFIC.count; i += 1) {
    const node = city.nodes[rng.int(0, city.nodes.length - 1)];
    const next = city.neighbours[node.id][rng.int(0, city.neighbours[node.id].length - 1)];
    const type = rng.chance(0.08) ? 'truck' : rng.chance(0.12) ? 'taxi' : 'sedan';
    const car = makeCar(type, node.x, node.y, 0, rng.pick(['#c23b2e', '#2e6fc2', '#e8c33a', '#e8e4da', '#3aa655', '#7a4fc2', '#d97b2b']));
    car.node = node.id;
    car.next = next;
    car.cruise = rng.range(TRAFFIC.cruiseMin, TRAFFIC.cruiseMax);
    car.speed = car.cruise;
    car.blocked = 0;
    car.occupied = true;
    car.driver = { kind: 'driver' };
    cars.push(car);
  }
  const peds = [];
  for (let i = 0; i < PEDS.count; i += 1) {
    const node = city.nodes[rng.int(0, city.nodes.length - 1)];
    peds.push({
      x: node.x + rng.range(-80, 80),
      y: node.y + rng.range(-80, 80),
      angle: rng.range(0, Math.PI * 2),
      speed: rng.range(PEDS.walkMin, PEDS.walkMax),
      color: rng.pick(['#e8e4da', '#3a6ea5', '#c25b7a', '#4a7a3a', '#d9a05b', '#7a4fc2']),
      fleeing: false,
      fleeTimer: 0,
      down: false,
      downTimer: 0,
      wander: rng.range(2, 6),
    });
  }
  return { cars, peds, rng };
}

/** Parked cars along the shoulders, from the city's spots. */
export function spawnParked(city, seed, count = 34) {
  const rng = rngKit(seed + 202);
  const out = [];
  // Spots are random, so two can land on each other: keep a gap between
  // the cars that are actually placed, or they spawn stacked.
  const placed = [];
  for (const s of rng.shuffle(city.parkedSpots)) {
    if (out.length >= count) break;
    if (placed.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 70)) continue;
    placed.push(s);
    const type = rng.chance(0.06) ? 'sports' : rng.chance(0.1) ? 'truck' : 'sedan';
    const car = makeCar(type, s.x, s.y, s.angle, rng.pick(['#c23b2e', '#2e6fc2', '#e8c33a', '#e8e4da', '#3aa655', '#7a4fc2', '#22252a', '#d97b2b']));
    out.push(car);
  }
  return out;
}

/** One traffic step: cars cruise their graph, peds stroll and flee. */
export function updateTraffic(g, dt) {
  const { city, player } = g;
  for (const car of g.traffic.cars) {
    const target = city.nodes[car.next];
    const dx = target.x - car.x;
    const dy = target.y - car.y;
    const dist = Math.hypot(dx, dy);
    const wantAngle = Math.atan2(dx, -dy);
    // Steer toward the next intersection, easing into the turn.
    let diff = wantAngle - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
    // Slow for a hard turn: at full speed the car swings wide and clips
    // the building on the corner of the crossing.
    const turnSlow = 1 - Math.min(1, Math.abs(diff) / 2.5) * 0.6;
    // Slow for the car ahead, so traffic bunches instead of overlapping.
    let gap = Infinity;
    for (const other of g.traffic.cars) {
      if (other === car) continue;
      const d = Math.hypot(other.x - car.x, other.y - car.y);
      if (d < gap) {
        const ahead = (other.x - car.x) * Math.sin(car.angle) + (other.y - car.y) * -Math.cos(car.angle);
        if (ahead > 0) gap = d;
      }
    }
    const want = gap < TRAFFIC.followGap ? 0 : car.cruise * turnSlow;
    // A car stopped behind another for a while creeps forward: without it,
    // two cars waiting on each other at a crossing wait forever.
    if (want === 0 && car.speed < 5) car.blocked += dt;
    else car.blocked = 0;
    const targetSpeed = car.blocked > 1.5 ? 40 : want;
    car.speed += Math.max(-300 * dt, Math.min(200 * dt, targetSpeed - car.speed));
    car.x += Math.sin(car.angle) * car.speed * dt;
    car.y += -Math.cos(car.angle) * car.speed * dt;
    if (dist < 26) {
      car.node = car.next;
      const options = city.neighbours[car.node];
      car.next = options[Math.floor(Math.random() * options.length)];
    }
  }
  // Keep traffic cars from piling into each other at intersections.
  for (let i = 0; i < g.traffic.cars.length; i += 1) {
    for (let j = i + 1; j < g.traffic.cars.length; j += 1) {
      const a = g.traffic.cars[i];
      const b = g.traffic.cars[j];
      if (Math.abs(a.x - b.x) < 40 && Math.abs(a.y - b.y) < 40) separateCars(a, b);
    }
  }
  // And off the parked cars on the shoulder: the follow-gap above only
  // watches traffic, so a turning car would otherwise sit on a parked one.
  for (const car of g.traffic.cars) {
    for (const parked of g.cars) {
      if (parked.occupied || parked === car) continue;
      if (Math.abs(car.x - parked.x) < 40 && Math.abs(car.y - parked.y) < 40) separateCars(car, parked);
    }
  }
  for (const ped of g.traffic.peds) {
    if (ped.down) {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        ped.down = false;
        ped.x = city.nodes[Math.floor(Math.random() * city.nodes.length)].x;
        ped.y = city.nodes[Math.floor(Math.random() * city.nodes.length)].y;
      }
      continue;
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
      continue;
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
}

/** A pedestrian hit by a car: down they go, and the law notices. */
export function knockPed(g, ped) {
  if (ped.down) return;
  ped.down = true;
  ped.downTimer = 6;
  raiseHeat(g, 1, 'hit pedestrian');
}
