import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {validHash,verifyPassword} from '../server/security.js';
import {harness} from './v2-helpers.js';
const root=path.resolve(import.meta.dirname,'..');
const run=(args,env={})=>spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:12000,env:{...process.env,...env}});
test('Bootstrap : génération du propriétaire dans un fichier extérieur sans secret dans la sortie',async t=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'club-owner-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));const dest=path.join(folder,'owner.json');
  const child=run(['scripts/admin-hash.mjs','--generate','--username','owner-generated','--out',dest]);assert.equal(child.status,0,child.stderr);const result=JSON.parse(readFileSync(dest,'utf8'));assert.equal(result.username,'owner-generated');assert.ok(validHash(result.hash));assert.ok(await verifyPassword(result.password,result.hash));assert.ok(!(child.stdout+child.stderr).includes(result.password));assert.ok(!(child.stdout+child.stderr).includes(result.hash));
  const before=readFileSync(dest,'utf8'),again=run(['scripts/admin-hash.mjs','--generate','--out',dest]);assert.notEqual(again.status,0);assert.equal(readFileSync(dest,'utf8'),before);
});
test('Bootstrap : refus du fichier de credentials dans le projet et de la saisie non interactive',()=>{
  const dest=path.join(root,'owner-never-write.json');const child=run(['scripts/admin-hash.mjs','--generate','--out',dest]);assert.notEqual(child.status,0);assert.equal(existsSync(dest),false);assert.notEqual(run(['scripts/admin-hash.mjs']).status,0);
});
test('Production : refus du stockage éphémère et de PUBLIC_BASE_URL sans HTTPS',()=>{
  const blank={NODE_ENV:'production',PUBLIC_BASE_URL:'https://example.invalid',TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',PERSISTENT_STORAGE:'0',ADMIN_USER:'',ADMIN_PASSWORD_HASH:'',RENDER:''};
  const noStorage=run(['server/index.js'],blank);assert.notEqual(noStorage.status,0);assert.match(noStorage.stderr,/Comptes persistants/);
  const noHttps=run(['server/index.js'],{...blank,PUBLIC_BASE_URL:'http://example.invalid'});assert.notEqual(noHttps.status,0);assert.match(noHttps.stderr,/HTTPS est obligatoire/);
});
test('Production : aucune inscription possible sans compte propriétaire configuré',t=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'club-production-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const child=run(['server/index.js'],{NODE_ENV:'production',PUBLIC_BASE_URL:'https://example.invalid',TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',DATA_FILE:path.join(folder,'new.sqlite'),PERSISTENT_STORAGE:'1',ADMIN_USER:'',ADMIN_PASSWORD_HASH:'',RENDER:''});assert.notEqual(child.status,0);assert.match(child.stderr,/Configure ADMIN_USER/);
});
test('Production : cookie Secure, adresses LAN masquées et origine erronée refusée',async t=>{
  const{client,base}=await harness(t,{production:true,publicBaseUrl:'https://example.invalid'});const a=client();const created=await a.req('/api/auth/register',{username:'secure-cookie',name:'Secure cookie',password:'Tests-Only-Password-67890'});assert.equal(created.status,200);assert.match(created.headers.get('set-cookie'),/; Secure/);assert.match(created.headers.get('set-cookie'),/HttpOnly/);const info=await(await fetch(base+'/api/info')).json();assert.deepEqual(info.lan,[]);assert.equal(info.publicBaseUrl,'https://example.invalid');assert.equal((await fetch(base+'/api/config',{headers:{Origin:'https://evil.invalid'}})).status,403);
});
