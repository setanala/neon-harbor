import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const projectDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(projectDir, 'game'), join(outputDir, 'game'), { recursive: true });

const sourceShots = join(projectDir, 'screenshots');
const outputShots = join(outputDir, 'screenshots');
mkdirSync(outputShots, { recursive: true });
if (existsSync(sourceShots)) cpSync(sourceShots, outputShots, { recursive: true });

const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
