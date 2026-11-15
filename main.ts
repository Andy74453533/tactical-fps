// DUSKLINE entrypoint: copies the game and its screenshots into the output
// directory and writes the dossier the judges read. Node 22 standard library
// only, no network, no randomness: two runs produce byte-identical output.
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
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

// Remove every entry inside dir, leaving dir itself in place. Directories
// are made writable before their children are removed: a previous run's
// copies may be read-only (cpSync preserves the source modes from the
// read-only repository), and removing a file needs write permission on its
// parent directory. Symlinks are removed as links, never followed.
function clearContents(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (lstatSync(path).isDirectory()) {
      chmodSync(path, 0o755);
      clearContents(path);
      rmdirSync(path);
    } else {
      rmSync(path, { force: true });
    }
  }
}

// Start from an empty output directory so a second run cannot leave stale
// files behind and the result depends only on the repository. Never remove
// the output directory itself: the grader mounts it inside a read-only
// filesystem, so deleting it would need write permission on its parent,
// which we do not have. Create it if missing, then clear only its contents.
mkdirSync(outDir, { recursive: true });
clearContents(outDir);
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
