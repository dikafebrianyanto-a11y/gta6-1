// Solmar — Streets of the Sun: entry build script.
//
// Copies the static game and its screenshots into the output directory and
// writes the dossier the scorer reads. Runs under Node 22 with stdlib only.
//
// The output directory is treated as borrowed, never owned: the grader may
// mount it as a volume, so this script never deletes the directory itself.
// It only clears the three things it owns inside it (game/, screenshots/,
// dossier.json) and rebuilds them, which is safe on a mount point.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The folder holding this file is the entry root (game/ and screenshots/
// live beside it); the working directory is irrelevant.
const entryRoot = dirname(fileURLToPath(import.meta.url));

// Where the finished entry goes. The grader sets MAKEFUN_OUTPUT_DIR; the
// plain /output path is only the local fallback. An empty value counts as
// unset, so a stray empty variable cannot point the build at the root.
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// The scorer's limits for this bounty, passed straight to buildDossier.
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

/** The paths this script owns inside the output directory. */
const ownedPaths = ['game', 'screenshots', 'dossier.json'];

/**
 * Empty the output directory without touching the directory itself: make
 * sure it exists, then remove only the entries this script owns. Deleting
 * the directory would fail with EBUSY when it is a mount point.
 */
function clearOwned(out: string): void {
  mkdirSync(out, { recursive: true });
  for (const name of ownedPaths) {
    rmSync(join(out, name), { recursive: true, force: true });
  }
}

/** Mirror a source tree into the output directory, replacing what was there. */
function mirrorInto(out: string, name: string): void {
  cpSync(join(entryRoot, name), join(out, name), { recursive: true });
}

function main(): void {
  clearOwned(outDir);
  mirrorInto(outDir, 'game');
  mirrorInto(outDir, 'screenshots');
  const dossier = buildDossier(outDir, dossierCaps);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
}

main();
