// The story of Dex Marlowe and the money of Solmar: five missions with
// Mara Solano, plus taxi fares and hidden sun coins for the free roam
// between them. Each mission is a list of small steps; a step is done when
// Dex reaches its marker, takes its car, or survives its heat.
import { MISSIONS } from './config.js';
import { floatText } from './effects.js';
import { spawnThugs } from './combat.js';
import { makeCar } from './vehicles.js';

export const STORY_TITLES = [
  'First Fare',
  'Hot Wheels',
  'The Pickup',
  'Heat Wave',
  'Payday',
];

/** Mission scripts: markers are looked up from the city by name. */
function storyScripts() {
  return [
    {
      title: 'First Fare',
      intro: "Mara: a client waits at the Marina. Drive him to the hotel, Dex.",
      steps: [
        { kind: 'goto', at: 'marina', text: 'Pick up the client at the Marina' },
        { kind: 'enterCar', text: 'Get in a car' },
        { kind: 'driveTo', at: 'hotel', text: 'Drive the client to the Grand Solmar Hotel' },
      ],
    },
    {
      title: 'Hot Wheels',
      intro: "Mara: a Comet GT sits at Casino Luna. Bring it to Ray's Garage.",
      steps: [
        { kind: 'goto', at: 'casino', text: 'Head to Casino Luna' },
        { kind: 'steal', at: 'casino', text: 'Take the Comet GT' },
        { kind: 'driveTo', at: 'garage', text: "Deliver the Comet GT to Ray's Garage" },
      ],
    },
    {
      title: 'The Pickup',
      intro: 'Mara: a package waits in Palm Park. Rivals want it too.',
      steps: [
        { kind: 'goto', at: 'park', text: 'Meet the contact at Palm Park' },
        { kind: 'pickup', at: 'park', text: 'Grab the package' },
        { kind: 'kill', count: 3, text: 'Rivals! Deal with them' },
        { kind: 'deliver', at: 'docks', text: 'Deliver the package to the Harbor Docks' },
      ],
    },
    {
      title: 'Heat Wave',
      intro: 'Mara: the cops made you, Dex. Three stars. Lose them.',
      steps: [
        { kind: 'heat', stars: 3, text: 'Lose the 3-star heat' },
        { kind: 'goto', at: 'safehouse', text: 'Reach the Safehouse' },
      ],
    },
    {
      title: 'Payday',
      intro: 'Mara: the courier cash is at the bank. Take it and vanish.',
      steps: [
        { kind: 'goto', at: 'bank', text: 'Get to Solmar National Bank' },
        { kind: 'pickup', at: 'bank', text: 'Grab the courier cash' },
        { kind: 'heat', stars: 4, text: 'Lose the 4-star heat' },
        { kind: 'goto', at: 'safehouse', text: 'Get the cash to the Safehouse' },
      ],
    },
  ];
}

/** A fresh mission state: story at mission 0, no fare, coins hidden. */
export function createMissions(city, seed) {
  const coins = [];
  const rngState = { s: seed + 303 };
  const next = () => {
    rngState.s = (rngState.s * 1664525 + 1013904223) >>> 0;
    return rngState.s / 4294967296;
  };
  for (let i = 0; i < 8; i += 1) {
    const node = city.nodes[Math.floor(next() * city.nodes.length)];
    coins.push({ x: node.x + (next() - 0.5) * 160, y: node.y + (next() - 0.5) * 160, taken: false });
  }
  return {
    scripts: storyScripts(),
    index: 0,
    step: 0,
    stepTimer: 0,
    done: false,
    killsNeeded: 0,
    killsDone: 0,
    hasPackage: false,
    targetCar: null,
    fare: null,
    fareTimer: 0,
    coins,
    banner: null,
    bannerTimer: 0,
  };
}

/** The marker the HUD and minimap should point at, or null. */
export function missionMarker(g) {
  const m = g.missions;
  if (m.done) return null;
  const script = m.scripts[m.index];
  const step = script.steps[m.step];
  if (!step) return null;
  if (step.kind === 'steal' && m.targetCar) return { x: m.targetCar.x, y: m.targetCar.y, label: 'Comet GT' };
  if (step.at) {
    const mark = g.city.markers[step.at];
    return { x: mark.x, y: mark.y, label: mark.label };
  }
  if (m.fare && m.fare.phase === 'pickup') return { x: m.fare.x, y: m.fare.y, label: 'Fare' };
  if (m.fare && m.fare.phase === 'dropoff') return { x: m.fare.destX, y: m.fare.destY, label: 'Drop-off' };
  return null;
}

/** The objective line the HUD shows. */
export function objectiveText(g) {
  const m = g.missions;
  if (m.done) return 'Story complete — Solmar is yours. Take fares, find coins.';
  const script = m.scripts[m.index];
  const step = script.steps[m.step];
  if (m.fare && !step) return 'Fare: drive to the marker';
  return `${script.title}: ${step.text}`;
}

/** Show a mission title card for a few seconds. */
function showBanner(g, title, sub) {
  g.missions.banner = { title, sub };
  g.missions.bannerTimer = 3.5;
  g.audio.jingle();
}

/** Begin a mission: reset its steps, plant its props, show its card. */
export function startMission(g, index) {
  const m = g.missions;
  m.index = index;
  m.step = 0;
  m.stepTimer = 0;
  m.killsNeeded = 0;
  m.killsDone = 0;
  m.hasPackage = false;
  m.targetCar = null;
  const script = m.scripts[index];
  showBanner(g, `Mission ${index + 1}: ${script.title}`, script.intro);
  if (script.title === 'Hot Wheels') {
    const spot = g.city.markers.casino;
    const car = makeCar('sports', spot.x - 60, spot.y + 40, Math.PI / 2, '#e8c33a');
    g.cars.push(car);
    m.targetCar = car;
  }
}

/** Finish a mission: pay out, save, and start the next or close the story. */
function completeMission(g) {
  const m = g.missions;
  const reward = MISSIONS.rewards[m.index];
  g.money += reward;
  floatText(g.fx, g.player.x, g.player.y - 40, `+$${reward}`, '#7ddb6a');
  g.audio.jingle();
  g.saveNow = true;
  if (m.index + 1 >= m.scripts.length) {
    m.done = true;
    showBanner(g, 'Story Complete', 'Solmar is yours, Dex. The streets remember.');
    return;
  }
  startMission(g, m.index + 1);
}

/** Advance one step of the current mission. */
function nextStep(g) {
  const m = g.missions;
  const script = m.scripts[m.index];
  m.step += 1;
  m.stepTimer = 0;
  if (m.step >= script.steps.length) completeMission(g);
}

/** A taxi fare: a waiting rider, then a destination. */
function offerFare(g) {
  const m = g.missions;
  if (m.fare || m.done === false && m.index < 1) return;
  const nodes = g.city.nodes;
  const a = nodes[Math.floor(Math.random() * nodes.length)];
  const b = nodes[Math.floor(Math.random() * nodes.length)];
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  m.fare = {
    phase: 'pickup',
    x: a.x,
    y: a.y,
    destX: b.x,
    destY: b.y,
    reward: Math.round(MISSIONS.fareBase + dist * MISSIONS.farePerMetre),
    timer: MISSIONS.tipTime,
  };
  floatText(g.fx, g.player.x, g.player.y - 40, 'New fare nearby!', '#ffd94d');
}

/** One mission step: check the current step and run the story forward. */
export function updateMissions(g, dt) {
  const m = g.missions;
  const p = g.player;
  if (m.bannerTimer > 0) m.bannerTimer -= dt;
  const script = m.scripts[m.index];
  if (m.done) {
    offerFare(g);
    return;
  }
  const step = script.steps[m.step];
  if (!step) return;
  const px = p.inCar ? p.inCar.x : p.x;
  const py = p.inCar ? p.inCar.y : p.y;
  const near = (x, y, r) => Math.hypot(px - x, py - y) < r;

  if (step.kind === 'goto' || step.kind === 'driveTo' || step.kind === 'deliver') {
    const mark = g.city.markers[step.at];
    const radius = step.kind === 'deliver' ? 70 : 64;
    if (near(mark.x, mark.y, radius)) {
      if (step.kind === 'deliver') m.hasPackage = false;
      nextStep(g);
    }
  } else if (step.kind === 'enterCar') {
    if (p.inCar) nextStep(g);
  } else if (step.kind === 'pickup') {
    const mark = g.city.markers[step.at];
    if (near(mark.x, mark.y, 60)) {
      m.stepTimer += dt;
      if (m.stepTimer > 0.6) {
        m.hasPackage = true;
        g.audio.pickup();
        floatText(g.fx, p.x, p.y - 30, step.at === 'bank' ? 'Cash grabbed!' : 'Package secured', '#7ddb6a');
        nextStep(g);
      }
    } else {
      m.stepTimer = 0;
    }
  } else if (step.kind === 'steal') {
    if (m.targetCar && p.inCar === m.targetCar) {
      g.wanted = Math.max(g.wanted, 1);
      floatText(g.fx, p.x, p.y - 30, 'The valet saw that!', '#ff5a3c');
      nextStep(g);
    }
  } else if (step.kind === 'kill') {
    if (m.killsNeeded === 0) {
      m.killsNeeded = step.count;
      m.killsDone = 0;
      spawnThugs(g, p.x + 120, p.y - 80, step.count, true);
      showBanner(g, 'Ambush!', 'Rivals are coming for the package.');
    }
    const alive = g.enemies.filter((e) => e.kind === 'thug' && e.alive).length;
    m.killsDone = m.killsNeeded - alive;
    if (alive === 0 && m.killsDone >= m.killsNeeded) nextStep(g);
  } else if (step.kind === 'heat') {
    if (g.wanted < step.stars) {
      g.wanted = step.stars;
      g.wantedTimer = 0;
    }
    if (g.wanted === 0) nextStep(g);
  }

  // Taxi fare lifecycle, running beside the story.
  const fare = m.fare;
  if (fare) {
    if (fare.phase === 'pickup' && p.inCar && near(fare.x, fare.y, 70)) {
      fare.phase = 'dropoff';
      fare.timer = MISSIONS.tipTime;
      g.audio.pickup();
      floatText(g.fx, p.x, p.y - 30, 'Rider aboard — drive!', '#ffd94d');
    } else if (fare.phase === 'dropoff') {
      fare.timer -= dt;
      if (p.inCar && near(fare.destX, fare.destY, 70)) {
        const tip = fare.timer > 0 ? Math.round(fare.reward * 0.5) : 0;
        g.money += fare.reward + tip;
        g.faresDone += 1;
        floatText(g.fx, p.x, p.y - 40, `Fare +$${fare.reward + tip}`, '#7ddb6a');
        g.audio.coin();
        m.fare = null;
        g.saveNow = true;
      } else if (fare.timer <= -30) {
        m.fare = null;
        floatText(g.fx, p.x, p.y - 40, 'Fare gave up waiting', '#ff5a3c');
      }
    }
  } else if (!m.done && m.index >= 1) {
    m.fareTimer -= dt;
    if (m.fareTimer <= 0) {
      m.fareTimer = 18 + Math.random() * 14;
      offerFare(g);
    }
  }

  // Hidden sun coins: walk over one to pocket it.
  for (const coin of m.coins) {
    if (coin.taken) continue;
    if (Math.hypot(p.x - coin.x, p.y - coin.y) < 30) {
      coin.taken = true;
      g.money += 25;
      g.packages += 1;
      g.audio.coin();
      floatText(g.fx, coin.x, coin.y - 20, '+$25 sun coin', '#ffd94d');
    }
  }
}
