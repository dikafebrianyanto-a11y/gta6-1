// Screenshot scenes: each one stages the real game, then plays it forward
// for a few seconds with a scripted driver, so the frame is what a short
// game really looks like and the same seed always gives the same frame.
// cover: a chase in the Comet GT, wanted 3, mission marker on the HUD.
// street: Dex on foot at a busy downtown crossing. chase: foot cops on
// Dex's heels. mission: the Palm Park ambush, package in hand.
import { makeCar } from './vehicles.js';
import { startMission } from './missions.js';
import { spawnThugs } from './combat.js';

/** A scripted stand-in for the keyboard, steered by the scene. */
function scriptedInput() {
  const input = {
    held: new Set(),
    mouseDown: false,
    mouseX: 0,
    mouseY: 0,
    _drive: 0,
    _steer: 0,
    _walkX: 0,
    _walkY: 0,
    _sprint: false,
    _shoot: false,
    driveAxis() {
      return input._drive;
    },
    steerAxis() {
      return input._steer;
    },
    walkVector() {
      return { x: input._walkX, y: input._walkY };
    },
    get sprint() {
      return input._sprint;
    },
    /** Call form of the sprint check, matching the real keyboard input. */
    sprintHeld() {
      return input._sprint;
    },
    get shooting() {
      return input._shoot;
    },
    takeActions() {
      return 0;
    },
    requeue() {},
  };
  return input;
}

/** Run the simulation for `seconds` with the scripted input in place. */
function simulate(g, step, driver, seconds, tick) {
  const real = g.input;
  g.input = driver;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) {
    if (tick) tick(i);
    step(g, 1 / 60);
    if (g.mode === 'over') break;
  }
  g.input = real;
}

/** Put Dex in a car at (x, y), facing along the road. */
function putInCar(g, car) {
  const p = g.player;
  car.occupied = true;
  car.driver = p;
  p.inCar = car;
  p.x = car.x;
  p.y = car.y;
  p.angle = car.angle;
}

/** A police car joining the chase, a little behind the player. */
function addCopCar(g, x, y, angle) {
  const car = makeCar('police', x, y, angle, '#22252a');
  car.occupied = true;
  car.driver = { kind: 'cop' };
  car.cruise = 340;
  car.blocked = 0;
  g.police.cars.push(car);
  g.cars.push(car);
  return car;
}

/**
 * Stage the named scene on the live game and return the screen to draw.
 * `step` advances the simulation one fixed step; `reset` rebuilds the world.
 */
export function stageShot(g, name, step, reset) {
  reset();
  const p = g.player;
  p.invuln = 120;
  const driver = scriptedInput();

  if (name === 'street') {
    // Dex on foot downtown, traffic rolling past, mission 1 waiting.
    const cross = g.city.nodes[4 * 8 + 3];
    p.x = cross.x - 60;
    p.y = cross.y + 40;
    startMission(g, 0);
    simulate(g, step, driver, 4, (i) => {
      const mark = g.city.markers.marina;
      const dx = mark.x - p.x;
      const dy = mark.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      driver._walkX = dx / len;
      driver._walkY = dy / len;
      driver._sprint = i > 60;
    });
  } else if (name === 'chase') {
    // Foot cops on Dex's heels down a sidewalk, two stars up.
    const road = g.city.roadX[3];
    p.x = road + 30;
    p.y = g.city.roadY[4];
    g.wanted = 2;
    // Foot cops close enough to stay in frame while Dex sprints away.
    for (const [ox, oy] of [[-80, 55], [-110, -35]]) {
      g.enemies.push({ kind: 'cop', x: p.x + ox, y: p.y + oy, hp: 60, alive: true, speed: 235, punchTimer: 0, shootTimer: 0, armed: false, angle: 0 });
      g.police.foot.push(g.enemies[g.enemies.length - 1]);
    }
    simulate(g, step, driver, 4, () => {
      driver._walkX = 0;
      driver._walkY = -1;
      driver._sprint = true;
    });
  } else if (name === 'mission') {
    // The Palm Park ambush: package in hand, rivals closing in.
    startMission(g, 2);
    g.missions.step = 2;
    g.missions.killsNeeded = 3;
    g.missions.killsDone = 0;
    g.missions.hasPackage = true;
    const park = g.city.markers.park;
    p.x = park.x;
    p.y = park.y + 30;
    spawnThugs(g, park.x + 100, park.y - 60, 3, true);
    simulate(g, step, driver, 4, () => {
      const thug = g.enemies.find((e) => e.alive);
      if (thug) {
        driver._shoot = true;
        driver.mouseDown = true;
        driver.mouseX = thug.x - g.camera.x;
        driver.mouseY = thug.y - g.camera.y;
        const dx = g.city.markers.docks.x - p.x;
        const dy = g.city.markers.docks.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        driver._walkX = dx / len;
        driver._walkY = dy / len;
      }
    });
  } else {
    // cover: the Comet GT flat out down a straight avenue, three stars,
    // two cop cars on its tail, garage ahead. A straight road keeps the
    // chase fast — a route with turns stalls the car at the first corner.
    startMission(g, 1);
    g.missions.step = 2;
    const car = g.missions.targetCar;
    car.x = g.city.roadX[1];
    car.y = g.city.roadY[3];
    car.angle = Math.PI / 2;
    car.speed = 380;
    putInCar(g, car);
    g.wanted = 3;
    // Clear the avenue of traffic for the shot: the chase reads better
    // with the road to itself, and a crossing car would only slow the Comet.
    const avenueY = g.city.roadY[3];
    const cleared = g.traffic.cars.filter((c) => Math.abs(c.y - avenueY) < 130 && c.x > g.city.roadX[0] && c.x < g.city.roadX[6]);
    for (const c of cleared) {
      const i = g.cars.indexOf(c);
      if (i !== -1) g.cars.splice(i, 1);
    }
    g.traffic.cars = g.traffic.cars.filter((c) => !cleared.includes(c));
    // Cops on its tail, already at speed, so the chase stays in frame.
    const behind = car.angle + Math.PI;
    const cop1 = addCopCar(g, car.x + Math.sin(behind) * 150, car.y - Math.cos(behind) * 150, car.angle);
    cop1.speed = 470;
    cop1.cruise = 520;
    const cop2 = addCopCar(g, car.x + Math.sin(behind) * 300, car.y - Math.cos(behind) * 300, car.angle);
    cop2.speed = 470;
    cop2.cruise = 520;
    simulate(g, step, driver, 4, () => {
      driver._drive = 1;
      driver._steer = 0;
    });
  }

  p.invuln = 0;
  g.mode = 'play';
  return { screen: 'play' };
}
