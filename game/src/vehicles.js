// Cars: arcade physics, models, spawning and the enter/exit dance. A car is
// a heading, a speed along it, and a little sideways slide; steering bites
// harder the faster the car goes, and the handbrake throws the tail out.
import { CAR, CAR_TYPES } from './config.js';

let nextCarId = 1;

/** A car of the given model, parked or rolling at a heading. */
export function makeCar(type, x, y, angle, color) {
  const spec = CAR_TYPES[type] ?? CAR_TYPES.sedan;
  return {
    id: nextCarId,
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
    color: color ?? CAR.colors[(nextCarId * 7 + 3) % CAR.colors.length],
    hp: CAR.hp,
    occupied: false,
    driver: null,
    smoke: 0,
    skid: 0,
  };
}

/**
 * One physics step. throttle is -1..1 (forward is positive), steer is
 * -1..1, handbrake true throws the tail out. Returns nothing; the car moves.
 */
export function driveCar(car, dt, throttle, steer, handbrake) {
  const spec = CAR_TYPES[car.type] ?? CAR_TYPES.sedan;
  const forward = Math.abs(car.speed) < 1 ? 1 : Math.sign(car.speed);
  if (throttle > 0) car.speed += CAR.accel * spec.accel * throttle * dt;
  else if (throttle < 0) {
    if (car.speed > 5) car.speed -= CAR.brake * dt;
    else car.speed += CAR.reverseAccel * spec.accel * throttle * dt;
  }
  const top = car.speed >= 0 ? spec.top : CAR.maxReverse;
  car.speed = Math.max(-CAR.maxReverse, Math.min(top, car.speed));
  // Drag and rolling resistance, then the turn: faster cars steer sharper,
  // handbrake cars barely grip.
  car.speed -= car.speed * CAR.drag * dt;
  if (Math.abs(car.speed) < 2 && throttle === 0) car.speed = 0;
  const grip = handbrake ? CAR.handbrakeGrip : CAR.grip;
  const turnRate = CAR.steer * steer * Math.min(1, Math.abs(car.speed) / 140) * (handbrake ? 1.5 : 1);
  car.angle += turnRate * forward * dt;
  const fx = Math.sin(car.angle);
  const fy = -Math.cos(car.angle);
  car.x += fx * car.speed * dt;
  car.y += fy * car.speed * dt;
  car.steer = steer;
  car.skid = handbrake && Math.abs(car.speed) > 120 ? 1 : Math.max(0, car.skid - dt * 3);
}

/** Axis-aligned bounding box of the car, for building and car collisions. */
export function carBox(car) {
  const c = Math.abs(Math.cos(car.angle));
  const s = Math.abs(Math.sin(car.angle));
  const w = car.w * c + car.h * s;
  const h = car.w * s + car.h * c;
  return { x: car.x - w / 2, y: car.y - h / 2, w, h };
}

/** True when two cars' boxes overlap. */
export function carsOverlap(a, b) {
  const ab = carBox(a);
  const bb = carBox(b);
  return ab.x < bb.x + bb.w && ab.x + ab.w > bb.x && ab.y < bb.y + bb.h && ab.y + ab.h > bb.y;
}

/**
 * Push two overlapping cars apart along the line between their centres.
 * Positional only: it never touches speed, so a car leaning on another
 * one is shoved aside instead of braked to a standstill. Hard hits are
 * the callers' job (they gate damage on a cooldown).
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
