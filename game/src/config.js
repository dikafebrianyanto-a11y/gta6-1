// Solmar tuning, all in one place.
//
// Every number the game balances on lives in this module: the size of the
// city, how the player and the cars move, how hot the police get, what a
// mission pays. Nothing in the systems below hard-codes a magic number;
// when the feel is wrong, the fix is a single edit here.
//
// Values are plain data on purpose. The systems read them, never mutate
// them, so a tuning pass cannot leak state from one play session into the
// next.

// ---------------------------------------------------------------------------
// The city grid
// ---------------------------------------------------------------------------

// One map tile, in pixels. The whole world is a square of these.
export const TILE = 48;

// The city is 64 tiles on a side.
export const CITY_COLS = 64;
export const CITY_ROWS = 64;

// Pixel size of the world, derived from the grid so the two never drift.
export const WORLD_W = CITY_COLS * TILE;
export const WORLD_H = CITY_ROWS * TILE;

// Roads repeat every eight tiles and are two tiles wide, with a sidewalk
// strip drawn along each edge.
export const ROAD_EVERY = 8;
export const ROAD_W = 2 * TILE;

// ---------------------------------------------------------------------------
// Look: a sun-bleached coastal palette
// ---------------------------------------------------------------------------

// Warm asphalt, pale sidewalks, sand on the south shore, teal water past it.
// Buildings and roofs each cycle through seven matching swatches.
export const PAL = {
  grass: '#7fae5a',
  grassDry: '#a8b565',
  asphalt: '#3d3a38',
  asphaltDark: '#33302e',
  lane: '#e8d98a',
  sidewalk: '#c9bfa9',
  curb: '#9d937c',
  sand: '#e6d3a3',
  sea: '#2e7f9e',
  seaDeep: '#1f5f7d',
  building: ['#c96f4a', '#d9a05b', '#8fa8bf', '#b5768a', '#7ba07a', '#a8896b', '#6f7f9e'],
  roof: ['#8a4f35', '#a87c42', '#6b7f95', '#8f5a6d', '#5f7d5c', '#857052', '#55627a'],
  park: '#5d9b4e',
  tree: '#3f7a34',
  treeLight: '#5da347',
};

// ---------------------------------------------------------------------------
// The player on foot
// ---------------------------------------------------------------------------

export const PLAYER = {
  radius: 13,
  walkSpeed: 170,
  sprintSpeed: 265,
  hp: 100,
  punchDamage: 18,
  punchRange: 34,
  punchArc: 1.1,
  shootCooldown: 0.22,
  startAmmo: 24,
  maxAmmo: 120,
};

// ---------------------------------------------------------------------------
// Cars: arcade handling, per-model tuning
// ---------------------------------------------------------------------------

// Base handling every car starts from: quick to pick up speed, willing to
// slide when pushed, grippy again once the slide settles.
export const CAR = {
  accel: 420,
  brake: 700,
  reverseAccel: 260,
  maxSpeed: 460,
  maxReverse: 140,
  steer: 2.6,
  grip: 6.5,
  drag: 0.55,
  handbrakeGrip: 2.2,
  hp: 100,
  colors: ['#c23b2e', '#2e6fc2', '#e8c33a', '#e8e4da', '#3aa655', '#7a4fc2', '#22252a', '#d97b2b'],
};

// The models the city spawns. The sports car is rare and fast, the truck is
// slow and heavy, the taxi is the one that earns fares. Each entry scales
// the base handling: top speed, acceleration and weight multipliers.
export const CAR_TYPES = {
  sedan: { w: 34, h: 62, top: 430, accel: 1.0, weight: 1.0, price: 0 },
  taxi: { w: 34, h: 62, top: 430, accel: 1.0, weight: 1.0, price: 0 },
  sports: { w: 32, h: 60, top: 560, accel: 1.35, weight: 0.85, price: 0 },
  truck: { w: 40, h: 84, top: 330, accel: 0.8, weight: 1.8, price: 0 },
  police: { w: 34, h: 62, top: 500, accel: 1.15, weight: 1.1, price: 0 },
};

// ---------------------------------------------------------------------------
// Ambient city life: traffic and pedestrians
// ---------------------------------------------------------------------------

export const TRAFFIC = {
  count: 26,
  cruiseMin: 120,
  cruiseMax: 190,
  followGap: 90,
  spawnMargin: 700,
};

export const PEDS = {
  count: 42,
  walkMin: 45,
  walkMax: 80,
  fleeSpeed: 150,
  fleeRadius: 220,
};

// ---------------------------------------------------------------------------
// Heat: the wanted system and what feeds it
// ---------------------------------------------------------------------------

export const WANTED = {
  max: 5,
  // Quiet seconds, with no cop in sight, before one star fades away.
  decaySeconds: 14,
  // How many cop cars and foot cops each star level brings out.
  carsPerStar: [0, 1, 2, 2, 3, 4],
  footPerStar: [0, 0, 1, 2, 3, 4],
  sightRange: 520,
  bustRange: 26,
  bustSpeed: 60,
};

// What raises the heat, and by how many stars each offence is worth.
export const HEAT = {
  stealOccupied: 1,
  hitPedestrian: 1,
  shoot: 1,
  killCop: 2,
  killCivilian: 1,
  crashCop: 1,
};

// ---------------------------------------------------------------------------
// Difficulty presets
// ---------------------------------------------------------------------------
//
// Three presets, one table. Each preset tunes the same four knobs:
//   policeAggression - multiplier on how hard the police chase and shoot.
//   wantedDecaySeconds - quiet seconds before one star fades (overrides
//     WANTED.decaySeconds while the preset is active).
//   payoutMultiplier - multiplier on mission and fare payouts.
//   trafficDensity - multiplier on how many traffic cars spawn.
//
// Easy is forgiving: lazy cops, fast-fading heat, generous pay, light
// traffic. Hard is the opposite: relentless cops, heat that lingers, lean
// pay, and a crowded road. Normal is the balanced game.
export const DIFFICULTY = {
  easy: {
    policeAggression: 0.7,
    wantedDecaySeconds: 9,
    payoutMultiplier: 1.25,
    trafficDensity: 0.7,
  },
  normal: {
    policeAggression: 1.0,
    wantedDecaySeconds: 14,
    payoutMultiplier: 1.0,
    trafficDensity: 1.0,
  },
  hard: {
    policeAggression: 1.4,
    wantedDecaySeconds: 22,
    payoutMultiplier: 0.85,
    trafficDensity: 1.3,
  },
};

// The preset a fresh game starts on.
export const DEFAULT_DIFFICULTY = 'normal';

// ---------------------------------------------------------------------------
// Combat, missions, saving, controls
// ---------------------------------------------------------------------------

export const COMBAT = {
  bulletSpeed: 780,
  bulletRange: 520,
  bulletDamage: 34,
  thugHp: 50,
  thugSpeed: 120,
  thugPunch: 10,
  thugShootChance: 0.25,
  ammoPrice: 40,
  healPrice: 60,
};

export const MISSIONS = {
  // Story payouts in mission order, then the taxi-fare formula.
  rewards: [150, 400, 600, 500, 1500],
  fareBase: 60,
  farePerMetre: 0.12,
  tipTime: 45,
};

// The localStorage key the save file lives under.
export const SAVE_KEY = 'solmar-save-v1';

// Keyboard bindings. Each action lists every key that triggers it, so the
// WASD and arrow-key players both work without a remapping screen.
export const CONTROLS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  enterCar: ['KeyE'],
  punch: ['Space'],
  shoot: ['KeyJ'],
  pause: ['KeyP', 'Escape'],
  mute: ['KeyM'],
  confirm: ['Enter'],
};
