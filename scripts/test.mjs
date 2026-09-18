// Run only real test suites, not helper modules; works in Windows without shell globbing.
import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const files=(await readdir(path.join(root,'tests'))).filter(n=>n.endsWith('.test.js')).sort().map(n=>path.join(root,'tests',n));
if(!files.length)throw new Error('Aucun fichier de test trouvé.');
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',cwd:root});
if(result.error)throw result.error;
process.exitCode=result.status??1;
