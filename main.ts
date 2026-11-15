// DUSKLINE entrypoint: copies the game and its screenshots into the output
// directory and writes the dossier the judges read. Node 22 standard library
// only, no network, no randomness: two runs produce byte-identical output.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

if (outDir === resolve('/') || outDir === repoRoot) {
  throw new Error(`refusing to use ${outDir} as the output directory`);
}

const gameDir = join(repoRoot, 'game');
const screenshotsDir = join(repoRoot, 'screenshots');
if (!existsSync(gameDir)) throw new Error(`game/ not found at ${gameDir}`);
if (!existsSync(screenshotsDir)) throw new Error(`screenshots/ not found at ${screenshotsDir}`);

// Start from an empty output directory so a second run cannot leave stale
// files behind and the result depends only on the repository.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });
cpSync(screenshotsDir, join(outDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`wrote ${outDir} (dossier ${dossier.length} bytes)`);
