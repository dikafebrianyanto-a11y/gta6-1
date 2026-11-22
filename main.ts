// Solmar packer: copies the game and its screenshots into the output
// directory, then writes the make.fun dossier for the GTA 6 bounty.
// Node 22, standard library only; run with `node main.ts`, no flags.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** The directory this file lives in: the entry root, holding game/ and screenshots/. */
const ENTRY_ROOT = dirname(fileURLToPath(import.meta.url));
/** Where the packed entry goes; the harness sets MAKEFUN_OUTPUT_DIR, else /output. */
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The bounty gate's caps, exactly as the scorer hands them to buildDossier. */
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
} as const;

/** Copy one directory tree, entries in sorted order so the walk is deterministic. */
function mirrorTree(fromDir: string, toDir: string): number {
  mkdirSync(toDir, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(fromDir).sort()) {
    const from = join(fromDir, name);
    const to = join(toDir, name);
    if (statSync(from).isDirectory()) {
      copied += mirrorTree(from, to);
    } else {
      writeFileSync(to, readFileSync(from));
      copied++;
    }
  }
  return copied;
}

/** Pack the entry: fresh output dir, game/ and screenshots/ mirrored in, dossier written. */
function packEntry(): void {
  // Fail before touching OUT_DIR when an input is missing, so a bad run
  // never wipes a previous good pack and then dies halfway.
  for (const needed of ['game', 'screenshots']) {
    if (!existsSync(join(ENTRY_ROOT, needed))) {
      throw new Error(`packEntry: ${join(ENTRY_ROOT, needed)} is missing, nothing to pack`);
    }
  }
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const gameFiles = mirrorTree(join(ENTRY_ROOT, 'game'), join(OUT_DIR, 'game'));
  const shotFiles = mirrorTree(join(ENTRY_ROOT, 'screenshots'), join(OUT_DIR, 'screenshots'));
  const dossier = buildDossier(OUT_DIR, DOSSIER_LIMITS);
  writeFileSync(join(OUT_DIR, 'dossier.json'), dossier);
  console.log(`packed ${gameFiles} game files, ${shotFiles} screenshots, dossier ${dossier.length} bytes -> ${OUT_DIR}`);
}

packEntry();
