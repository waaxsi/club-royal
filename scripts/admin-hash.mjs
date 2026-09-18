/** Owner bootstrap helper. No passwords in command-line arguments or logs. */
import {randomBytes} from 'node:crypto';
import {writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {hashPassword,username} from '../server/security.js';
const root=await realpath(path.resolve(import.meta.dirname,'..'));
const args=process.argv.slice(2);
function option(name){const i=args.indexOf(name);return i<0?null:args[i+1];}
async function hidden(question){
  if(!process.stdin.isTTY)throw new Error('Terminal interactif requis. Pour automatiser, utilise --generate --out dans un dossier privé extérieur au projet.');
  process.stderr.write(question);process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    function stop(){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',read);process.stderr.write('\n');}
    function read(text){for(const char of text){
      if(char==='\u0003'){stop();reject(new Error('Annulé.'));return;}
      if(char==='\r'||char==='\n'){stop();resolve(value);return;}
      if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue;}
      if(char>=' '&&value.length<128)value+=char;
    }}
    process.stdin.on('data',read);
  });
}
try{
  if(args.includes('--help')){
    console.log('node scripts/admin-hash.mjs\n  Demande deux fois un mot de passe masqué et affiche seulement son hash scrypt.\n\nnode scripts/admin-hash.mjs --generate --username waaxsi --out CHEMIN_PRIVE_EXTERIEUR_AU_PROJET.json\n  Crée un fichier privé contenant identifiant, mot de passe aléatoire et hash.\n  Aucun secret n’est affiché. Le fichier ne doit pas être publié ni commité.');
  }else if(args.includes('--generate')){
    const output=option('--out');if(!output||!path.isAbsolute(output))throw new Error('--out doit être un chemin absolu dans un dossier privé existant.');
    const parent=await realpath(path.dirname(output));const destination=path.join(parent,path.basename(output));
    const relative=path.relative(root,destination);if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('Le fichier de secrets doit rester HORS du projet.');
    const user=username(option('--username')||'waaxsi'),password=randomBytes(24).toString('base64url'),hash=await hashPassword(password);
    await writeFile(destination,JSON.stringify({username:user,password,hash,notice:'SECRET PRIVÉ — ne pas publier, envoyer dans un chat ou commiter. Configurer ADMIN_USER et ADMIN_PASSWORD_HASH côté serveur uniquement.'},null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
    console.log('Fichier privé créé (aucune valeur secrète affichée) : '+destination);
  }else{
    const password=await hidden('Mot de passe administrateur (10 à 128 caractères, saisie masquée) : ');
    const confirmation=await hidden('Confirme le mot de passe : ');
    if(password!==confirmation)throw new Error('Les deux saisies ne correspondent pas.');
    const hash=await hashPassword(password);console.log(hash);
    process.stderr.write('Hash uniquement. À placer dans ADMIN_PASSWORD_HASH. Ne publie pas le mot de passe.\n');
  }
}catch(error){console.error(error.code==='EEXIST'?'Le fichier privé existe déjà. Aucun remplacement effectué.':error.message);process.exitCode=1;}
