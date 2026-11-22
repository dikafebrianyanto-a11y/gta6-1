// Solmar story engine — Dex Marlowe's rise from cab driver to the man
// Mara Solano trusts with the jobs nobody else will touch.
//
// The file owns three things and keeps them separate:
//   1. the story scripts — seven missions, each a chain of small steps
//      (walk somewhere, take a car, grab a package, lose the cops);
//   2. the free-roam economy around the story — taxi fares, hidden sun
//      coins, and the new Courier side activity;
//   3. the per-frame tick that watches Dex, advances steps, and pays out.
//
// A step only ever asks one question ("is Dex there yet?", "are the
// thugs all down?", "is the heat gone?"), so every step kind has its own
// small handler below instead of one long if/else ladder.
//
// Imports stay the same as before: story payouts from config, floating
// score text from effects, thug spawns from combat, car factory from
// vehicles. Nothing in this file touches the save format directly —
// main.js reads missions.index / missions.done / missions.scripts.
import { DEFAULT_DIFFICULTY, DIFFICULTY, MISSIONS } from './config.js';
import { floatText } from './effects.js';
import { spawnThugs } from './combat.js';
import { makeCar } from './vehicles.js';

// ---------------------------------------------------------------------------
// Story catalogue
// ---------------------------------------------------------------------------

// Titles in story order. The first five are the original arc; the last
// two are the new finale — the Meridian vault job, then Dex's last fare.
export const STORY_TITLES = [
  'First Fare',
  'Hot Wheels',
  'The Pickup',
  'Heat Wave',
  'Payday',
  'The Meridian Job',
  'The Last Fare',
];

// Payout per mission, in story order. The config table only lists the
// first five, so anything past its end falls back to this table.
const STORY_REWARDS = [150, 400, 600, 500, 1500, 2500, 4000];

// Courier pay: a flat pickup fee plus a per-metre delivery rate.
const COURIER_BASE_PAY = 90;
const COURIER_PAY_PER_METRE = 0.15;

// How long a courier run allows, in seconds: a base allowance plus
// one second per 25 metres of delivery distance.
const COURIER_BASE_SECONDS = 40;
const COURIER_SECONDS_PER_METRE = 1 / 25;

// ---------------------------------------------------------------------------
// Script builders — one tiny factory per concept, so each mission below
// reads like a shot list instead of a wall of object literals.
// ---------------------------------------------------------------------------

/** One objective inside a mission. `extra` carries kind-specific data. */
function buildStep(kind, text, place = null, extra = {}) {
  return { kind, text, ...(place ? { at: place } : {}), ...extra };
}

/** One whole mission: a title, Mara's briefing line, and its steps. */
function buildMission(title, intro, steps) {
  return { title, intro, steps };
}

/**
 * The seven-mission arc. Markers are city place names ('marina',
 * 'casino', 'docks' ...) resolved against g.city.markers at run time.
 */
function storyScripts() {
  const firstFare = buildMission(
    'First Fare',
    "Mara: a client waits at the Marina. Drive him to the hotel, Dex.",
    [
      buildStep('goto', 'Pick up the client at the Marina', 'marina'),
      buildStep('enterCar', 'Get in a car'),
      buildStep('driveTo', 'Drive the client to the Grand Solmar Hotel', 'hotel'),
    ],
  );

  const hotWheels = buildMission(
    'Hot Wheels',
    "Mara: a Comet GT sits at Casino Luna. Bring it to Ray's Garage.",
    [
      buildStep('goto', 'Head to Casino Luna', 'casino'),
      buildStep('steal', 'Take the Comet GT', 'casino'),
      buildStep('driveTo', "Deliver the Comet GT to Ray's Garage", 'garage'),
    ],
  );

  const thePickup = buildMission(
    'The Pickup',
    'Mara: a package waits in Palm Park. Rivals want it too.',
    [
      buildStep('goto', 'Meet the contact at Palm Park', 'park'),
      buildStep('pickup', 'Grab the package', 'park'),
      buildStep('kill', 'Rivals! Deal with them', null, { count: 3 }),
      buildStep('deliver', 'Deliver the package to the Harbor Docks', 'docks'),
    ],
  );

  const heatWave = buildMission(
    'Heat Wave',
    'Mara: the cops made you, Dex. Three stars. Lose them.',
    [
      buildStep('heat', 'Lose the 3-star heat', null, { stars: 3 }),
      buildStep('goto', 'Reach the Safehouse', 'safehouse'),
    ],
  );

  const payday = buildMission(
    'Payday',
    'Mara: the courier cash is at the bank. Take it and vanish.',
    [
      buildStep('goto', 'Get to Solmar National Bank', 'bank'),
      buildStep('pickup', 'Grab the courier cash', 'bank'),
      buildStep('heat', 'Lose the 4-star heat', null, { stars: 4 }),
      buildStep('goto', 'Get the cash to the Safehouse', 'safehouse'),
    ],
  );

  // New mission 6 — The Meridian Job. Mara's biggest score yet: the
  // Meridian Archive vault under Casino Luna. Dex tools up at the gun
  // shop, lifts the vault case from the casino floor, fights off the
  // Archive's own security crew, and runs the case to the docks.
  const meridianJob = buildMission(
    'The Meridian Job',
    'Mara: the Meridian vault case is under Casino Luna. This one makes us, Dex.',
    [
      buildStep('goto', 'Tool up at Ammo & Iron', 'gunshop'),
      buildStep('goto', 'Get inside Casino Luna', 'casino'),
      buildStep('pickup', 'Lift the Meridian vault case', 'casino'),
      buildStep('kill', 'Archive security! Hold them off', null, { count: 4 }),
      buildStep('deliver', 'Run the case to the Harbor Docks', 'docks'),
    ],
  );

  // New mission 7 — The Last Fare. The finale: one last bank grab, the
  // whole Solmar PD on Dex at five stars, and a boat waiting at the
  // Marina. Survive the heat, reach the water, and Dex is gone clean.
  const lastFare = buildMission(
    'The Last Fare',
    'Mara: one last grab, Dex — then the boat at the Marina, and we are ghosts.',
    [
      buildStep('goto', 'Get to Solmar National Bank', 'bank'),
      buildStep('pickup', 'Grab the last payout', 'bank'),
      buildStep('heat', 'Lose the 5-star heat', null, { stars: 5 }),
      buildStep('goto', 'Reach the boat at the Marina', 'marina'),
    ],
  );

  return [firstFare, hotWheels, thePickup, heatWave, payday, meridianJob, lastFare];
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** A tiny seeded generator (mulberry-style LCG) for coin placement. */
function makeSeededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Scatter the eight hidden sun coins near random road nodes. Seeded, so
 * the same world seed always hides them in the same places.
 */
function scatterSunCoins(city, seed) {
  const draw = makeSeededRng(seed + 303);
  const coins = [];
  for (let placed = 0; placed < 8; placed += 1) {
    const node = city.nodes[Math.floor(draw() * city.nodes.length)];
    const jitterX = (draw() - 0.5) * 160;
    const jitterY = (draw() - 0.5) * 160;
    coins.push({ x: node.x + jitterX, y: node.y + jitterY, taken: false });
  }
  return coins;
}

/**
 * The active difficulty preset, read off the game state the same tolerant
 * way the HUD reads it: a plain string on g, inside settings/options, or
 * a { label } object. Unknown or missing values fall back to the default
 * preset, so payouts stay sane before difficulty is wired up anywhere.
 * The save stores the lowercase name ('normal'), the HUD prints a
 * capitalised one ('Normal') — lowercasing here accepts both.
 */
function difficultyPreset(g) {
  const raw = g.difficulty ?? g.settings?.difficulty ?? g.options?.difficulty;
  const name = typeof raw === 'string' ? raw : raw?.label ?? raw?.name;
  const key = typeof name === 'string' ? name.toLowerCase() : DEFAULT_DIFFICULTY;
  return DIFFICULTY[key] ?? DIFFICULTY[DEFAULT_DIFFICULTY];
}

/**
 * Scale a base cash payout by the active difficulty's payout multiplier:
 * easy pays 1.25x, normal 1.0x, hard 0.85x. Every payout in this file —
 * story missions, courier runs, taxi fares — goes through here.
 */
function scaledPayout(g, base) {
  return Math.round(base * difficultyPreset(g).payoutMultiplier);
}

/** Payout for a mission index: config first, fallback table second, then scaled. */
function payoutFor(g, index) {
  const configured = MISSIONS.rewards[index];
  const base = configured !== undefined ? configured : STORY_REWARDS[index];
  return scaledPayout(g, base);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Fresh mission state for a new game (or a world reset).
 *
 * Fields other modules rely on — shots.js pokes step / killsNeeded /
 * killsDone / hasPackage / targetCar directly, main.js reads index /
 * done / scripts — are all kept with exactly these names.
 */
export function createMissions(city, seed) {
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
    courier: null,
    courierTimer: 12,
    coins: scatterSunCoins(city, seed),
    banner: null,
    bannerTimer: 0,
  };
}

// ---------------------------------------------------------------------------
// Queries the HUD / minimap use
// ---------------------------------------------------------------------------

/** Where the player should be heading right now, or null. */
export function missionMarker(g) {
  const m = g.missions;
  if (m.done) {
    const courierMark = courierMarker(g);
    if (courierMark) return courierMark;
    if (m.fare) {
      return m.fare.phase === 'pickup'
        ? { x: m.fare.x, y: m.fare.y, label: 'Fare' }
        : { x: m.fare.destX, y: m.fare.destY, label: 'Drop-off' };
    }
    return null;
  }
  const script = m.scripts[m.index];
  const step = script.steps[m.step];
  if (!step) return null;
  if (step.kind === 'steal' && m.targetCar) {
    return { x: m.targetCar.x, y: m.targetCar.y, label: 'Comet GT' };
  }
  if (step.at) {
    const mark = g.city.markers[step.at];
    return { x: mark.x, y: mark.y, label: mark.label };
  }
  const courierMark = courierMarker(g);
  if (courierMark) return courierMark;
  if (m.fare && m.fare.phase === 'pickup') return { x: m.fare.x, y: m.fare.y, label: 'Fare' };
  if (m.fare && m.fare.phase === 'dropoff') return { x: m.fare.destX, y: m.fare.destY, label: 'Drop-off' };
  return null;
}

/** The objective line the HUD shows for the current step. */
export function objectiveText(g) {
  const m = g.missions;
  if (m.done) {
    if (m.courier) return `Courier: ${courierObjective(g)}`;
    if (m.fare) return 'Fare: drive to the marker';
    return 'Story complete — Solmar is yours. Take fares, run courier jobs, find coins.';
  }
  const script = m.scripts[m.index];
  const step = script.steps[m.step];
  if (!step) return `${script.title}: done`;
  return `${script.title}: ${step.text}`;
}

/** Marker for the active courier run, or null when none is running. */
export function courierMarker(g) {
  const run = g.missions.courier;
  if (!run) return null;
  if (run.phase === 'pickup') return { x: run.pickupX, y: run.pickupY, label: 'Courier pickup' };
  return { x: run.destX, y: run.destY, label: 'Courier delivery' };
}

/** Objective line for the active courier run. */
function courierObjective(g) {
  const run = g.missions.courier;
  const secondsLeft = Math.max(0, Math.ceil(run.timeLeft));
  if (run.phase === 'pickup') return `pick up the package (${secondsLeft}s)`;
  return `deliver the package — ${secondsLeft}s left, $${run.reward}`;
}

// ---------------------------------------------------------------------------
// Courier side activity
// ---------------------------------------------------------------------------

/**
 * Start a courier run: a package waiting at a random road node, a
 * delivery point somewhere else in the city, and a clock that starts
 * the moment the run is offered. Pays COURIER_BASE_PAY plus a per-metre
 * rate on the delivery distance, scaled by the difficulty multiplier.
 * active, true when a fresh run was created.
 */
export function startCourierRun(g) {
  const m = g.missions;
  if (m.courier) return false;
  const nodes = g.city.nodes;
  const pickupNode = nodes[Math.floor(Math.random() * nodes.length)];
  const dropNode = nodes[Math.floor(Math.random() * nodes.length)];
  const distance = Math.hypot(pickupNode.x - dropNode.x, pickupNode.y - dropNode.y);
  m.courier = {
    phase: 'pickup',
    pickupX: pickupNode.x,
    pickupY: pickupNode.y,
    destX: dropNode.x,
    destY: dropNode.y,
    reward: scaledPayout(g, Math.round(COURIER_BASE_PAY + distance * COURIER_PAY_PER_METRE)),
    timeLeft: COURIER_BASE_SECONDS + distance * COURIER_SECONDS_PER_METRE,
  };
  floatText(g.fx, g.player.x, g.player.y - 40, 'Courier job: grab the package!', '#ffd94d');
  return true;
}

/**
 * Complete the active courier run: bank the reward, count the delivery,
 * clear the run so the next one can be offered. Returns the cash paid,
 * or 0 when no run was active.
 */
export function completeCourierRun(g) {
  const m = g.missions;
  const run = m.courier;
  if (!run) return 0;
  const paid = run.reward;
  g.money += paid;
  g.packages += 1;
  m.courier = null;
  m.courierTimer = 20 + Math.random() * 12;
  floatText(g.fx, g.player.x, g.player.y - 40, `Courier +$${paid}`, '#7ddb6a');
  g.audio.coin();
  g.saveNow = true;
  return paid;
}

/** Drop a courier run without paying (timer ran out). */
function failCourierRun(g) {
  const m = g.missions;
  m.courier = null;
  m.courierTimer = 20 + Math.random() * 12;
  floatText(g.fx, g.player.x, g.player.y - 40, 'Courier job expired', '#ff5a3c');
}

// ---------------------------------------------------------------------------
// Mission lifecycle
// ---------------------------------------------------------------------------

/** Flash a title card (mission intro, ambush warning, story complete). */
function showBanner(g, title, sub) {
  g.missions.banner = { title, sub };
  g.missions.bannerTimer = 3.5;
  g.audio.jingle();
}

/** Begin a mission: reset its step counters, plant its props, show its card. */
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
    const getaway = makeCar('sports', spot.x - 60, spot.y + 40, Math.PI / 2, '#e8c33a');
    g.cars.push(getaway);
    m.targetCar = getaway;
  }
}

/** Pay out for the finished mission, then start the next or close the story. */
function completeMission(g) {
  const m = g.missions;
  const reward = payoutFor(g, m.index);
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

/** Move to the next step; finishing the last step completes the mission. */
function advanceStep(g) {
  const m = g.missions;
  const script = m.scripts[m.index];
  m.step += 1;
  m.stepTimer = 0;
  if (m.step >= script.steps.length) completeMission(g);
}

// ---------------------------------------------------------------------------
// Step handlers — one per step kind
// ---------------------------------------------------------------------------

/** Dex's position, in the car when driving, on foot otherwise. */
function dexPosition(g) {
  const p = g.player;
  const ride = p.inCar;
  return { x: ride ? ride.x : p.x, y: ride ? ride.y : p.y };
}

/** True when Dex (or his car) is within `radius` of a point. */
function dexNear(g, x, y, radius) {
  const pos = dexPosition(g);
  return Math.hypot(pos.x - x, pos.y - y) < radius;
}

/** goto / driveTo / deliver: arrive at the named marker to advance. */
function handleArrivalStep(g, step) {
  const mark = g.city.markers[step.at];
  const radius = step.kind === 'deliver' ? 70 : 64;
  if (!dexNear(g, mark.x, mark.y, radius)) return;
  if (step.kind === 'deliver') g.missions.hasPackage = false;
  advanceStep(g);
}

/** enterCar: Dex just needs to be behind the wheel. */
function handleEnterCarStep(g) {
  if (g.player.inCar) advanceStep(g);
}

/**
 * pickup: stand on the marker for a beat so the grab feels deliberate,
 * then pocket the item and move on.
 */
function handlePickupStep(g, step, dt) {
  const m = g.missions;
  const mark = g.city.markers[step.at];
  if (!dexNear(g, mark.x, mark.y, 60)) {
    m.stepTimer = 0;
    return;
  }
  m.stepTimer += dt;
  if (m.stepTimer <= 0.6) return;
  m.hasPackage = true;
  g.audio.pickup();
  const grabbed = step.at === 'bank' ? 'Cash grabbed!' : 'Package secured';
  floatText(g.fx, g.player.x, g.player.y - 30, grabbed, '#7ddb6a');
  advanceStep(g);
}

/** steal: climbing into the target car trips the alarm and advances. */
function handleStealStep(g) {
  const m = g.missions;
  if (m.targetCar && g.player.inCar === m.targetCar) {
    g.wanted = Math.max(g.wanted, 1);
    floatText(g.fx, g.player.x, g.player.y - 30, 'The valet saw that!', '#ff5a3c');
    advanceStep(g);
  }
}

/**
 * kill: the first tick spawns the ambush, then the step clears once
 * every spawned thug is down.
 */
function handleFightStep(g, step) {
  const m = g.missions;
  if (m.killsNeeded === 0) {
    m.killsNeeded = step.count;
    m.killsDone = 0;
    spawnThugs(g, g.player.x + 120, g.player.y - 80, step.count, true);
    showBanner(g, 'Ambush!', 'Rivals are coming for the package.');
    return;
  }
  const stillStanding = g.enemies.filter((e) => e.kind === 'thug' && e.alive).length;
  m.killsDone = m.killsNeeded - stillStanding;
  if (stillStanding === 0 && m.killsDone >= m.killsNeeded) advanceStep(g);
}

/**
 * heat: the wanted level is forced up to the step's stars, then Dex
 * must shake the cops down to zero.
 */
function handleHeatStep(g, step) {
  if (g.wanted < step.stars) {
    g.wanted = step.stars;
    g.wantedTimer = 0;
  }
  if (g.wanted === 0) advanceStep(g);
}

/** Dispatch the current step to its handler. */
const STEP_HANDLERS = {
  goto: (g, step) => handleArrivalStep(g, step),
  driveTo: (g, step) => handleArrivalStep(g, step),
  deliver: (g, step) => handleArrivalStep(g, step),
  enterCar: (g) => handleEnterCarStep(g),
  pickup: (g, step, dt) => handlePickupStep(g, step, dt),
  steal: (g) => handleStealStep(g),
  kill: (g, step) => handleFightStep(g, step),
  heat: (g, step) => handleHeatStep(g, step),
};

// ---------------------------------------------------------------------------
// Free-roam economy ticks
// ---------------------------------------------------------------------------

/** Offer a taxi fare: a waiting rider, then a destination, with a tip clock. */
function offerFare(g) {
  const m = g.missions;
  if (m.fare) return;
  if (!m.done && m.index < 1) return;
  const nodes = g.city.nodes;
  const pickupNode = nodes[Math.floor(Math.random() * nodes.length)];
  const dropNode = nodes[Math.floor(Math.random() * nodes.length)];
  const distance = Math.hypot(pickupNode.x - dropNode.x, pickupNode.y - dropNode.y);
  m.fare = {
    phase: 'pickup',
    x: pickupNode.x,
    y: pickupNode.y,
    destX: dropNode.x,
    destY: dropNode.y,
    reward: scaledPayout(g, Math.round(MISSIONS.fareBase + distance * MISSIONS.farePerMetre)),
    timer: MISSIONS.tipTime,
  };
  floatText(g.fx, g.player.x, g.player.y - 40, 'New fare nearby!', '#ffd94d');
}

/** Taxi fare lifecycle: pickup, timed drive, payout (plus tip) or walk-away. */
function tickFare(g, dt) {
  const m = g.missions;
  const fare = m.fare;
  if (fare) {
    if (fare.phase === 'pickup' && g.player.inCar && dexNear(g, fare.x, fare.y, 70)) {
      fare.phase = 'dropoff';
      fare.timer = MISSIONS.tipTime;
      g.audio.pickup();
      floatText(g.fx, g.player.x, g.player.y - 30, 'Rider aboard — drive!', '#ffd94d');
      return;
    }
    if (fare.phase === 'dropoff') {
      fare.timer -= dt;
      if (g.player.inCar && dexNear(g, fare.destX, fare.destY, 70)) {
        const tip = fare.timer > 0 ? Math.round(fare.reward * 0.5) : 0;
        g.money += fare.reward + tip;
        g.faresDone += 1;
        floatText(g.fx, g.player.x, g.player.y - 40, `Fare +$${fare.reward + tip}`, '#7ddb6a');
        g.audio.coin();
        m.fare = null;
        g.saveNow = true;
      } else if (fare.timer <= -30) {
        m.fare = null;
        floatText(g.fx, g.player.x, g.player.y - 40, 'Fare gave up waiting', '#ff5a3c');
      }
    }
    return;
  }
  if (!m.done && m.index >= 1) {
    m.fareTimer -= dt;
    if (m.fareTimer <= 0) {
      m.fareTimer = 18 + Math.random() * 14;
      offerFare(g);
    }
  }
}

/**
 * Courier lifecycle: tick the clock, collect the package at the pickup
 * point, pay out at the delivery point, or fail the run when time dies.
 */
function tickCourier(g, dt) {
  const m = g.missions;
  const run = m.courier;
  if (run) {
    run.timeLeft -= dt;
    if (run.timeLeft <= 0) {
      failCourierRun(g);
      return;
    }
    if (run.phase === 'pickup' && dexNear(g, run.pickupX, run.pickupY, 70)) {
      run.phase = 'deliver';
      g.audio.pickup();
      floatText(g.fx, g.player.x, g.player.y - 30, 'Package aboard — deliver it fast!', '#ffd94d');
      return;
    }
    if (run.phase === 'deliver' && dexNear(g, run.destX, run.destY, 70)) {
      completeCourierRun(g);
    }
    return;
  }
  const storyOpen = m.done || m.index >= 1;
  if (!storyOpen) return;
  m.courierTimer -= dt;
  if (m.courierTimer <= 0) {
    m.courierTimer = 25 + Math.random() * 15;
    startCourierRun(g);
  }
}

/** Hidden sun coins: walk over one to pocket $25. */
function collectSunCoins(g) {
  const m = g.missions;
  const p = g.player;
  for (const coin of m.coins) {
    if (coin.taken) continue;
    if (Math.hypot(p.x - coin.x, p.y - coin.y) >= 30) continue;
    coin.taken = true;
    g.money += 25;
    g.packages += 1;
    g.audio.coin();
    floatText(g.fx, coin.x, coin.y - 20, '+$25 sun coin', '#ffd94d');
  }
}

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

/** One mission step per frame: run the story, the fare, the courier, the coins. */
export function updateMissions(g, dt) {
  const m = g.missions;
  if (m.bannerTimer > 0) m.bannerTimer -= dt;
  if (m.done) {
    offerFare(g);
    tickFare(g, dt);
    tickCourier(g, dt);
    collectSunCoins(g);
    return;
  }
  const script = m.scripts[m.index];
  const step = script.steps[m.step];
  if (step) {
    const handler = STEP_HANDLERS[step.kind];
    if (handler) handler(g, step, dt);
  }
  tickFare(g, dt);
  tickCourier(g, dt);
  collectSunCoins(g);
}
