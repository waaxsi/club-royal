import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CasinoHub} from '../server/hub.js';
import {SnapshotStore,StorageError} from '../server/storage.js';
import {HASH,actionId} from './v2-helpers.js';
async function harness(t,filename=':memory:'){
  const store=new SnapshotStore({filename}),h=await new CasinoHub(store,{adminUser:'owner-test',adminPasswordHash:HASH}).init();t.after(()=>store.close());
  const uid=(await h.run(()=>h.register({username:'alice-wallet',name:'Alice'},HASH))).id;const u=()=>h.data.users[uid],admin=()=>h.byUsername('owner-test');return {h,store,u,admin,uid};
}
const msg=x=>({actionId:actionId(),...x});
test('Portefeuille : tapis commun, topup et sortie restituent exactement les mêmes euros',async t=>{
  const{h,u}=await harness(t);await h.run(()=>h.createRoom(u(),msg({game:'poker',buyIn:20000,pokerMode:'classic'})));assert.deepEqual(h.wallet(u()),{available:80000,inPlay:20000,total:100000,currency:'EUR_FUN'});
  await h.run(()=>h.topUp(u(),msg({amount:10000})));assert.equal(h.wallet(u()).total,100000);assert.equal(h.wallet(u()).available,70000);await h.run(()=>h.leave(u(),msg({})));assert.equal(h.wallet(u()).available,100000);assert.equal(h.wallet(u()).inPlay,0);
});
test('Portefeuille : soldes serveur, doubles tables, fonds insuffisants et décimales invalides',async t=>{
  const{h,u}=await harness(t);await assert.rejects(h.run(()=>h.createRoom(u(),msg({game:'poker',buyIn:150000}))),/insuffisant/);assert.equal(u().balance,100000);await h.run(()=>h.createRoom(u(),msg({game:'poker',buyIn:20000})));await assert.rejects(h.run(()=>h.createRoom(u(),msg({game:'roulette'}))),/tapis/);await assert.rejects(h.run(()=>h.topUp(u(),msg({amount:1000.1}))));assert.equal(h.wallet(u()).total,100000);
});
test('Portefeuille : les gains des mini-jeux se retrouvent directement au même endroit',async t=>{
  const{h,u}=await harness(t);const first=await h.run(()=>h.instant(u(),msg({game:'dice',chance:50,stake:1000})));const second=await h.run(()=>h.instant(u(),msg({game:'plinko',stake:1000})));assert.equal(u().balance,100000+first.net+second.net);assert.equal(h.history(u()).filter(x=>x.kind==='mini').length,2);
});
test('Portefeuille : une commande admin ne modifie pas les fonds déjà engagés',async t=>{
  const{h,u,admin,uid}=await harness(t);await h.run(()=>h.createRoom(u(),msg({game:'blackjack',buyIn:20000})));await h.run(()=>h.adminAction(admin(),msg({type:'balance',userId:uid,mode:'set',amount:50000,reason:'Réglage du disponible'})));assert.equal(h.wallet(u()).inPlay,20000);assert.equal(h.wallet(u()).total,70000);await h.run(()=>h.leave(u(),msg({})));assert.equal(u().balance,70000);
});
test('Portefeuille : quitter pendant une main ne permet pas de fuir une mise',async t=>{
  const{h,u}=await harness(t);await h.run(()=>h.createRoom(u(),msg({game:'poker',buyIn:20000,solo:true,bots:1,pokerMode:'classic'})));await h.run(()=>h.leave(u(),msg({})));assert.equal(u().balance,80000);assert.equal(h.wallet(u()).inPlay,20000);await h.run(()=>h.tick(Date.now()+60000));await h.run(()=>h.tick(Date.now()+120000));assert.equal(h.wallet(u()).inPlay,0);assert.ok(u().balance<=100000);
});
test('Portefeuille : annulation admin rembourse le tapis de référence avant la main',async t=>{
  const{h,u,admin}=await harness(t);const room=await h.run(()=>h.createRoom(u(),msg({game:'poker',solo:true,bots:1})));await h.run(()=>h.adminAction(admin(),msg({type:'closeRoom',code:room.code,reason:'Annulation de test'})));assert.equal(u().balance,100000);assert.equal(h.wallet(u()).inPlay,0);assert.equal(h.data.audit.at(-1).action,'close-room');
});
test('Cristaux : stake réservé, cashout unique, anciennes requêtes et reprise inchangée',async t=>{
  const{h,u,uid}=await harness(t);const start=msg({type:'start',stake:1000,mineCount:3});const first=await h.run(()=>h.mines(u(),start));assert.equal(u().balance,99000);assert.equal(h.wallet(u()).total,100000);assert.ok(!Object.hasOwn(first,'mines'));const safe=Array.from({length:25},(_,i)=>i).find(i=>!h.data.mines[uid].mines.includes(i));await h.run(()=>h.mines(u(),msg({type:'reveal',gameId:first.id,cell:safe})));const cached=await h.run(()=>h.mines(u(),start));assert.deepEqual(cached.revealed,[],'cached reply is immutable');const cash=msg({type:'cashout',gameId:first.id});const won=await h.run(()=>h.mines(u(),cash));await h.run(()=>h.mines(u(),cash));assert.equal(u().balance,99000+won.payout);assert.equal(h.wallet(u()).inPlay,0);await assert.rejects(h.run(()=>h.mines(u(),msg({type:'cashout',gameId:first.id}))));
});
test('Portefeuille : stockage indisponible annule le débit ET la création de table',async t=>{
  const{h,u,store}=await harness(t);const save=store.save.bind(store);store.save=async()=>{throw new StorageError();};await assert.rejects(h.run(()=>h.createRoom(u(),msg({game:'poker'}))),/stockage/);assert.equal(u().balance,100000);assert.equal(h.manager.rooms.size,0);assert.equal(Object.keys(h.data.escrows).length,0);store.save=save;
});
test('Portefeuille : doublon durable après redémarrage, restitution des tables, Cristaux persistant',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'club-wallet-'));const filename=path.join(dir,'test.sqlite');
  const s1=new SnapshotStore({filename}),h1=await new CasinoHub(s1,{adminUser:'owner-test',adminPasswordHash:HASH}).init();const uid=(await h1.run(()=>h1.register({username:'durable-alice',name:'Alice'},HASH))).id,u1=()=>h1.data.users[uid];const dice=msg({game:'dice',chance:50,stake:1000});const result=await h1.run(()=>h1.instant(u1(),dice));await h1.run(()=>h1.createRoom(u1(),msg({game:'poker',solo:true,bots:1})));const mines=await h1.run(()=>h1.mines(u1(),msg({type:'start',stake:1000,mineCount:3})));const rawSession=(await h1.run(()=>h1.session(u1()))).raw;s1.close();
  const s2=new SnapshotStore({filename});t.after(()=>{s2.close();try{rmSync(dir,{recursive:true,force:true});}catch{}});const h2=await new CasinoHub(s2,{}).init(),u2=()=>h2.data.users[uid];assert.equal(u2().balance,99000+result.net);assert.equal(h2.wallet(u2()).inPlay,1000);assert.equal(h2.manager.rooms.size,0);assert.equal(h2.me(u2()).mines.id,mines.id);assert.equal(h2.authenticate(rawSession).u.id,uid);const again=await h2.run(()=>h2.instant(u2(),dice));assert.equal(again.id,result.id);assert.equal(u2().balance,99000+result.net);
});
test('Portefeuille : secours plafonné, raison admin obligatoire et suspension du propriétaire refusée',async t=>{
  const{h,u,admin,uid}=await harness(t);await assert.rejects(h.run(()=>h.refill(u(),msg({}))));await h.run(()=>h.adminAction(admin(),msg({type:'balance',userId:uid,mode:'set',amount:100,reason:'Tester le secours'})));await h.run(()=>h.refill(u(),msg({})));assert.equal(u().balance,100100);await h.run(()=>h.adminAction(admin(),msg({type:'balance',userId:uid,mode:'set',amount:0,reason:'Tester le délai'})));await assert.rejects(h.run(()=>h.refill(u(),msg({}))));await assert.rejects(h.run(()=>h.adminAction(admin(),msg({type:'balance',userId:uid,mode:'add',amount:100,reason:'x'}))));await assert.rejects(h.run(()=>h.adminAction(admin(),msg({type:'suspend',userId:admin().id,disabled:true,reason:'Propriétaire'}))));
});
test('Administration : premier visiteur jamais administrateur et bootstrap refusant une usurpation existante',async t=>{
  const store=new SnapshotStore({filename:':memory:'});t.after(()=>store.close());const h=await new CasinoHub(store).init();const user=await h.run(()=>h.register({username:'owner-later',name:'Owner'},HASH));assert.equal(user.role,'player');assert.ok(!Object.values(h.data.users).some(u=>u.role==='admin'));
});
