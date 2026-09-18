import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
let count = 0;
for (const folder of ['server', 'public', 'tests', 'scripts']) {
  for (const file of await readdir(path.join(root, folder))) {
    if (!/\.(js|mjs)$/.test(file)) continue;
    const check = spawnSync(process.execPath, ['--check', path.join(root, folder, file)], { stdio: 'inherit' });
    if (check.status !== 0) process.exit(check.status || 1);
    count++;
  }
}
console.log(`${count} fichiers JavaScript vérifiés. Aucun bundler ni téléchargement nécessaire.`);
