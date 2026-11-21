// Solmar city tuning: every number the game balances on lives here, so a
// tweak to feel or difficulty is one edit, never a hunt through the systems.
export const TILE = 48;
export const CITY_COLS = 64;
export const CITY_ROWS = 64;
export const WORLD_W = CITY_COLS * TILE;
export const WORLD_H = CITY_ROWS * TILE;

// Roads sit on this grid spacing (in tiles). Two tiles wide, with a sidewalk
// strip drawn on each edge.
export const ROAD_EVERY = 8;
export const ROAD_W = 2 * TILE;

// Sun-soaked palette for the whole city. Warm asphalt, pale sidewalks, sand
// on the south shore and teal water past it.
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

// Arcade car physics: quick to pick up, slides when pushed.
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

// Car models the city spawns. Sports is rare and fast; the truck is slow
// and heavy; the taxi earns fares.
export const CAR_TYPES = {
  sedan: { w: 34, h: 62, top: 430, accel: 1.0, weight: 1.0, price: 0 },
  taxi: { w: 34, h: 62, top: 430, accel: 1.0, weight: 1.0, price: 0 },
  sports: { w: 32, h: 60, top: 560, accel: 1.35, weight: 0.85, price: 0 },
  truck: { w: 40, h: 84, top: 330, accel: 0.8, weight: 1.8, price: 0 },
  police: { w: 34, h: 62, top: 500, accel: 1.15, weight: 1.1, price: 0 },
};

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

export const WANTED = {
  max: 5,
  // Seconds with no cop in sight before one star fades.
  decaySeconds: 14,
  // Cop counts by star level.
  carsPerStar: [0, 1, 2, 2, 3, 4],
  footPerStar: [0, 0, 1, 2, 3, 4],
  sightRange: 520,
  bustRange: 26,
  bustSpeed: 60,
};

// What raises heat, and by how much.
export const HEAT = {
  stealOccupied: 1,
  hitPedestrian: 1,
  shoot: 1,
  killCop: 2,
  killCivilian: 1,
  crashCop: 1,
};

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
  // Cash the story pays out, in order.
  rewards: [150, 400, 600, 500, 1500],
  fareBase: 60,
  farePerMetre: 0.12,
  tipTime: 45,
};

export const SAVE_KEY = 'solmar-save-v1';

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
