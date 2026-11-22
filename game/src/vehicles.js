// Vehicles: the machines of Solmar. Every ride is the same shape — a
// position, a heading, a speed along that heading — but each model tunes
// the numbers underneath: how hard it accelerates, how fast it tops out,
// how much it weighs when it shoves another car aside.
//
// Bikes live here too. A motorcycle is not a small car: it is quicker off
// the line and faster flat out, turns on a coin, grips less in a slide,
// and crumples where a sedan would shrug — 45 hit points against a car's
// 100 — so riding one is a trade of safety for speed.
import { CAR, CAR_TYPES } from './config.js';

let nextCarId = 1;

// The motorcycle's own tuning. It is defined here, next to the code that
// rides it, because config.js only lists the four-wheeled models and this
// file owns everything about how a bike behaves.
export const BIKE_TYPE = 'bike';
export const BIKE = {
  w: 20,
  h: 58,
  top: 620,
  accel: 1.5,
  weight: 0.45,
  hp: 45,
  price: 0,
};

// How a bike differs from a car once it is moving: it leans into turns
// instead of gripping through them, and it slides further with the brake.
const BIKE_HANDLING = {
  steerMul: 1.45,
  dragMul: 0.8,
  slideMul: 1.6,
};

/** Look up the tuning for a model, falling back to the sedan. */
function specFor(type) {
  if (type === BIKE_TYPE) return BIKE;
  return CAR_TYPES[type] ?? CAR_TYPES.sedan;
}

/** True when the ride is a motorcycle rather than a car. */
export function isBike(car) {
  return car.type === BIKE_TYPE;
}

/**
 * Build a ride of the given model at a spot, facing a heading. Colours
 * cycle through the palette when none is given, so parked rows look varied.
 */
export function makeCar(type, x, y, angle, color) {
  const spec = specFor(type);
  const id = nextCarId;
  nextCarId += 1;
  const ride = {
    id,
    type,
    x,
    y,
    angle,
    speed: 0,
    steer: 0,
    w: spec.w,
    h: spec.h,
    top: spec.top,
    accelMul: spec.accel,
    weight: spec.weight,
    color: color ?? CAR.colors[(id * 7 + 3) % CAR.colors.length],
    hp: type === BIKE_TYPE ? BIKE.hp : CAR.hp,
    occupied: false,
    driver: null,
    smoke: 0,
    skid: 0,
    lean: 0,
  };
  return ride;
}

/**
 * Put a fresh motorcycle on the street. Same shape as makeCar, but the
 * caller never has to spell the type string or remember the bike's tuning.
 */
export function spawnBike(x, y, angle = 0, color) {
  return makeCar(BIKE_TYPE, x, y, angle, color);
}

/**
 * One physics step. throttle runs -1..1 (forward is positive), steer
 * -1..1, handbrake true throws the tail out. The ride moves in place;
 * nothing is returned.
 *
 * The order matters: power first, then the speed cap, then drag, then the
 * turn (which bites harder the faster the ride goes), then the move.
 */
export function driveCar(car, dt, throttle, steer, handbrake) {
  const spec = specFor(car.type);
  const bike = isBike(car);
  const forward = Math.abs(car.speed) < 1 ? 1 : Math.sign(car.speed);

  // Power: throttle adds speed, braking sheds it, and rolling backwards
  // past a crawl switches to the weaker reverse gear instead.
  if (throttle > 0) {
    car.speed += CAR.accel * spec.accel * throttle * dt;
  } else if (throttle < 0) {
    if (car.speed > 5) car.speed -= CAR.brake * dt;
    else car.speed += CAR.reverseAccel * spec.accel * throttle * dt;
  }

  // Cap the speed, then bleed a little to drag and rolling resistance.
  const top = car.speed >= 0 ? spec.top : CAR.maxReverse;
  const drag = CAR.drag * (bike ? BIKE_HANDLING.dragMul : 1);
  car.speed = Math.max(-CAR.maxReverse, Math.min(top, car.speed));
  car.speed -= car.speed * drag * dt;
  if (Math.abs(car.speed) < 2 && throttle === 0) car.speed = 0;

  // Steering: speed gives the turn its bite, the handbrake loosens the
  // grip and sharpens the swing, and a bike leans further than a car.
  const speedBite = Math.min(1, Math.abs(car.speed) / 140);
  const swing = handbrake ? 1.5 : 1;
  const bikeSwing = bike ? BIKE_HANDLING.steerMul : 1;
  car.angle += CAR.steer * steer * speedBite * swing * bikeSwing * forward * dt;
  const leanTarget = bike ? steer * speedBite * 0.45 : 0;
  car.lean += (leanTarget - car.lean) * Math.min(1, dt * 8);

  // Finally, roll along the heading we now face.
  const fx = Math.sin(car.angle);
  const fy = -Math.cos(car.angle);
  car.x += fx * car.speed * dt;
  car.y += fy * car.speed * dt;
  car.steer = steer;
  const sliding = handbrake && Math.abs(car.speed) > 120;
  const slideRate = bike ? BIKE_HANDLING.slideMul : 1;
  car.skid = sliding ? 1 : Math.max(0, car.skid - dt * 3 * slideRate);
}

/** Axis-aligned bounding box of a ride, for building and ride collisions. */
export function carBox(car) {
  const c = Math.abs(Math.cos(car.angle));
  const s = Math.abs(Math.sin(car.angle));
  const w = car.w * c + car.h * s;
  const h = car.w * s + car.h * c;
  return { x: car.x - w / 2, y: car.y - h / 2, w, h };
}

/** True when the two rides' boxes overlap. */
export function carsOverlap(a, b) {
  const boxA = carBox(a);
  const boxB = carBox(b);
  const separated =
    boxA.x + boxA.w <= boxB.x ||
    boxB.x + boxB.w <= boxA.x ||
    boxA.y + boxA.h <= boxB.y ||
    boxB.y + boxB.h <= boxA.y;
  return !separated;
}

/**
 * Shove two overlapping rides apart along the line between their centres.
 * Position only: speed is never touched here, so a car leaning on another
 * is pushed aside instead of braked to a standstill. Hard hits — and any
 * damage from them — are the callers' job, gated on a cooldown.
 */
export function separateCars(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const overlap = (a.w + b.w) / 2 - dist;
  if (overlap <= 0) return;
  // Exactly on top of each other: pick a direction instead of stalling.
  const nx = dist > 0.01 ? dx / dist : 1;
  const ny = dist > 0.01 ? dy / dist : 0;
  const push = overlap / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
}
