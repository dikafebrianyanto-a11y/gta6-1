// The law: a wanted level, police cars that hunt the player down, and foot
// cops who try to make the arrest. Stars climb when Dex is seen doing wrong
// and fade when he stays out of sight; a cop's touch at low speed is a bust.
import { WANTED } from './config.js';
import { makeCar, separateCars } from './vehicles.js';
import { burst, floatText, shake } from './effects.js';
import { collideCarWithCity, hurtPlayer } from './player.js';

/** A fresh police force: no heat, no cops on the street. */
export function createPolice() {
  return {
    cars: [],
    foot: [],
    spawnTimer: 0,
    sirenNear: false,
  };
}

/** How many cars and foot cops the current stars call for. */
function wantedCounts(stars) {
  return {
    cars: WANTED.carsPerStar[Math.min(stars, WANTED.max)],
    foot: WANTED.footPerStar[Math.min(stars, WANTED.max)],
  };
}

/** A police car rolling in from the edge of the player's view. */
function spawnCopCar(g) {
  const p = g.player;
  const angle = Math.random() * Math.PI * 2;
  const dist = 700 + Math.random() * 300;
  let x = p.x + Math.cos(angle) * dist;
  let y = p.y + Math.sin(angle) * dist;
  x = Math.max(60, Math.min(3072 - 60, x));
  y = Math.max(60, Math.min(3072 - 60, y));
  const spot = g.city.nearestRoad(x, y);
  const car = makeCar('police', spot.x, spot.y, Math.atan2(p.x - spot.x, -(p.y - spot.y)), '#22252a');
  car.occupied = true;
  car.driver = { kind: 'cop' };
  car.cruise = 320;
  car.blocked = 0;
  g.police.cars.push(car);
  g.cars.push(car);
  return car;
}

/** A foot cop appearing a block away, running in. */
function spawnFootCop(g) {
  const p = g.player;
  const angle = Math.random() * Math.PI * 2;
  const x = p.x + Math.cos(angle) * 420;
  const y = p.y + Math.sin(angle) * 420;
  const cop = {
    kind: 'cop',
    x,
    y,
    hp: 60,
    alive: true,
    speed: 185,
    punchTimer: 0,
    angle: 0,
  };
  g.police.foot.push(cop);
  g.enemies.push(cop);
  return cop;
}

/** One police step: spawn to quota, chase, ram, arrest, fade. */
export function updatePolice(g, dt) {
  const pol = g.police;
  const p = g.player;
  const px = p.inCar ? p.inCar.x : p.x;
  const py = p.inCar ? p.inCar.y : p.y;
  const counts = wantedCounts(g.wanted);

  // Spawn toward the quota, a little at a time so they arrive in waves.
  pol.spawnTimer -= dt;
  if (g.wanted > 0 && pol.spawnTimer <= 0) {
    pol.spawnTimer = 1.6;
    if (pol.cars.length < counts.cars) spawnCopCar(g);
    else if (pol.foot.length < counts.foot && !p.inCar) spawnFootCop(g);
  }

  // Heat fades when no cop can see Dex.
  let seen = false;
  for (const car of pol.cars) {
    if (Math.hypot(car.x - px, car.y - py) < WANTED.sightRange && !g.city.sightBlocked(car.x, car.y, px, py)) seen = true;
  }
  for (const cop of pol.foot) {
    if (Math.hypot(cop.x - px, cop.y - py) < WANTED.sightRange && !g.city.sightBlocked(cop.x, cop.y, px, py)) seen = true;
  }
  pol.sirenNear = seen || pol.cars.length > 0;
  if (g.wanted > 0) {
    if (seen) g.wantedTimer = 0;
    else {
      g.wantedTimer += dt;
      if (g.wantedTimer >= WANTED.decaySeconds) {
        g.wantedTimer = 0;
        g.wanted -= 1;
        floatText(g.fx, px, py - 30, 'Heat cooling…', '#9fd6ff');
      }
    }
  }

  // Police cars: steer at Dex, ram to stop him. A wall in the way sends
  // the car to the nearest junction first, so the chase goes around the
  // block instead of through the building on it.
  for (let i = pol.cars.length - 1; i >= 0; i -= 1) {
    const car = pol.cars[i];
    const dx = px - car.x;
    const dy = py - car.y;
    const dist = Math.hypot(dx, dy);
    let tx = px;
    let ty = py;
    if (car.blocked > 0) {
      car.blocked -= dt;
      const node = g.city.nearestRoad(car.x, car.y);
      tx = node.x;
      ty = node.y;
    }
    const wantAngle = Math.atan2(tx - car.x, -(ty - car.y));
    let diff = wantAngle - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.angle += Math.max(-3.4 * dt, Math.min(3.4 * dt, diff));
    const cruise = Math.min(520, Math.max(300 + g.wanted * 45, car.cruise || 0));
    car.speed += Math.max(-500 * dt, Math.min(420 * dt, cruise - car.speed));
    car.x += Math.sin(car.angle) * car.speed * dt;
    car.y += -Math.cos(car.angle) * car.speed * dt;
    // Corners, not just the centre: a cop car is as wide as any other.
    if (collideCarWithCity(g, car)) car.blocked = 1.2;
    // A hard ram hurts Dex's car and shakes the camera — but one hit only
    // counts once, so a cop leaning on the door cannot shred it in a second.
    if (car.ramTimer > 0) car.ramTimer -= dt;
    if (dist < 46 && Math.abs(car.speed) > 120 && car.ramTimer <= 0) {
      car.ramTimer = 0.8;
      const target = p.inCar ?? null;
      if (target) {
        target.hp -= 6;
        target.speed *= 0.55;
        shake(g.fx, 5);
        g.audio.crash();
        burst(g.fx, car.x, car.y, { count: 8, color: '#ffb347', speed: 160, life: 0.4, size: 3 });
        car.speed *= 0.4;
      } else if (dist < WANTED.bustRange && Math.abs(car.speed) < WANTED.bustSpeed) {
        g.events.push('busted');
      }
    }
    // A wrecked or far-off cop car gives up and leaves.
    if (car.hp <= 0 || dist > 1600) {
      car.occupied = false;
      const idx = g.cars.indexOf(car);
      if (idx !== -1) g.cars.splice(idx, 1);
      pol.cars.splice(i, 1);
    }
  }
  for (let i = 0; i < pol.cars.length; i += 1) {
    for (let j = i + 1; j < pol.cars.length; j += 1) {
      if (Math.abs(pol.cars[i].x - pol.cars[j].x) < 44 && Math.abs(pol.cars[i].y - pol.cars[j].y) < 44) {
        separateCars(pol.cars[i], pol.cars[j]);
      }
    }
  }

  // Foot cops: run Dex down and try to cuff him.
  for (let i = pol.foot.length - 1; i >= 0; i -= 1) {
    const cop = pol.foot[i];
    if (!cop.alive) {
      pol.foot.splice(i, 1);
      continue;
    }
    const dx = p.x - cop.x;
    const dy = p.y - cop.y;
    const dist = Math.hypot(dx, dy);
    cop.angle = Math.atan2(dy, dx);
    const pos = g.city.slide(cop.x, cop.y, 12, (dx / (dist || 1)) * cop.speed * dt, (dy / (dist || 1)) * cop.speed * dt);
    cop.x = pos.x;
    cop.y = pos.y;
    if (cop.punchTimer > 0) cop.punchTimer -= dt;
    if (dist < 30 && cop.punchTimer <= 0) {
      cop.punchTimer = 0.9;
      hurtPlayer(g, 12, 'cop');
      floatText(g.fx, p.x, p.y - 26, 'Stop right there!', '#ff5a3c');
    }
    if (!p.inCar && dist < WANTED.bustRange && p.speed < WANTED.bustSpeed) {
      g.events.push('busted');
    }
    if (dist > 1500) {
      cop.alive = false;
      pol.foot.splice(i, 1);
    }
  }

  // When the heat is gone, the street empties.
  if (g.wanted === 0) {
    for (const car of pol.cars) {
      const idx = g.cars.indexOf(car);
      if (idx !== -1) g.cars.splice(idx, 1);
    }
    pol.cars = [];
    for (const cop of pol.foot) cop.alive = false;
    pol.foot = [];
  }
}
