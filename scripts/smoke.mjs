/** Isolated smoke test. No public-site access, no persistent database, no secret printed. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../server/index.js';
const app=await createApp();
let cookie='',csrf='';
try{
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  async function req(route,msg){
    const res=await fetch(base+route,{method:msg?'POST':'GET',headers:{Cookie:cookie,...(msg?{'Content-Type':'application/json','X-CR-Request':'1','X-CSRF-Token':csrf}:{})},body:msg?JSON.stringify({actionId:randomUUID(),...msg}):undefined});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));if(data.me)csrf=data.me.csrf;return data;
  }
  assert.equal((await fetch(base)).status,200);assert.equal((await req('/api/health')).version,'2.0.0');
  const created=await req('/api/auth/register',{username:'smoke-user',name:'Test local',password:randomBytes(24).toString('base64url')});assert.equal(created.me.wallet.available,100000);
  for(const game of ['dice','plinko']){const play=await req('/api/instant',{game,stake:100,chance:50});assert.ok(Number.isSafeInteger(play.net));}
  for(const game of ['poker','blackjack','roulette']){
    const room=await req('/api/create',{game,solo:false,bots:1,pokerMode:'classic',buyIn:10000});assert.equal(room.state.game,game);
    await req('/api/leave',{});
  }
  const mine=await req('/api/mines',{type:'start',stake:100,mineCount:3});
  await req('/api/mines',{type:'cancel',gameId:mine.me.mines.id});
  assert.ok(Array.isArray(await req('/api/history')));
  console.log('Smoke réussi : page, santé, compte, six jeux, portefeuille et annulation. Serveur de test isolé uniquement.');
}finally{await app.stop();}
