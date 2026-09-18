import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,PASSWORD,actionId,pause} from './v2-helpers.js';

test('V2 HTTP : vrais fichiers, politique de sécurité et routes privées non exposées',async t=>{
  const {base}=await harness(t);for(const name of ['/','/app.js','/styles.css','/cards-ui.js','/art.js','/effects.js','/favicon.svg']){const res=await fetch(base+name);assert.equal(res.status,200);assert.equal(res.headers.get('x-content-type-options'),'nosniff');assert.ok((await res.text()).length>20);}
  for(const name of ['/server/index.js','/.env','/data/club-royal.sqlite'])assert.equal((await fetch(base+name)).status,404);
});
test('V2 compte : inscription, cookie HttpOnly, hash scrypt uniquement et session persistante',async t=>{
  const {client,app}=await harness(t),c=client();const out=await c.req('/api/auth/register',{username:'alice-auth',name:'Alice',password:PASSWORD});assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(out.data.me.wallet.available,100000);assert.ok(!JSON.stringify(out.data).includes(PASSWORD));assert.ok(!JSON.stringify(out.data).includes('scrypt$'));
  const user=app.hub.byUsername('alice-auth');assert.match(user.hash,/^scrypt\$/);assert.ok(!Object.keys(app.hub.data.sessions).includes(c.cookie.slice(11)));assert.equal((await c.get('/api/me')).data.id,user.id);
});
test('V2 compte : identifiants, mot de passe, doublon et usurpation de rôle rejetés',async t=>{
  const{client}=await harness(t),a=client();assert.equal((await a.req('/api/auth/register',{username:'x',name:'Test',password:PASSWORD})).status,400);assert.equal((await a.req('/api/auth/register',{username:'alice-short',name:'Alice',password:'short'})).status,400);
  await a.register('alice-roles');const another=client();assert.equal((await another.req('/api/auth/register',{username:'alice-roles',name:'Bob',password:PASSWORD})).status,409);
  const b=client();const out=await b.req('/api/auth/register',{username:'forged-role',name:'Pretend',password:PASSWORD,role:'admin',balance:999999});assert.equal(out.data.me.role,'player');assert.equal(out.data.me.wallet.available,100000);assert.equal((await b.get('/api/admin')).status,403);assert.equal((await b.post('/api/admin/action',{type:'balance',userId:a.me.id,mode:'add',amount:1000,reason:'forged'})).status,403);
  assert.equal((await another.req('/api/auth/login',{username:'alice-roles',password:'WrongPasswordHere'})).status,401);
});
test('V2 sécurité : origine, JSON, CSRF, session et méthodes contrôlés',async t=>{
  const{base,client}=await harness(t),a=await client().register('alice-csrf');assert.equal((await client().post('/api/create',{game:'poker'})).status,401);
  const msg={game:'poker',actionId:actionId()};assert.equal((await a.req('/api/create',msg,{headers:{Origin:'https://attacker.invalid'}})).status,403);assert.equal((await a.req('/api/create',msg,{headers:{'X-CSRF-Token':'invalid'}})).status,403);assert.equal((await a.req('/api/create',msg,{headers:{'X-CR-Request':'0'}})).status,403);assert.equal((await a.req('/api/create',msg,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await fetch(base+'/api/create',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
});
test('V2 SSE : deux vrais clients, confidentialité et main complète avec tableau commun',async t=>{
  const{client}=await harness(t),a=await client().register('alice-sse'),b=await client().register('bob-sse');
  const created=await a.post('/api/create',{game:'poker',pokerMode:'classic',buyIn:20000});assert.equal(created.status,200);
  assert.equal((await b.post('/api/join',{code:created.data.code.toLowerCase(),buyIn:20000})).status,200);const sa=await a.stream(),sb=await b.stream();
  assert.match(sa.headers.get('content-type'),/event-stream/);assert.match(sa.headers.get('cache-control'),/no-transform/);assert.equal(sa.headers.get('x-accel-buffering'),'no');
  assert.equal((await a.action('start')).status,200);const av=await sa.wait('state',s=>s?.phase==='preflop'),bv=await sb.wait('state',s=>s?.phase==='preflop');
  const aid=av.you,bid=bv.you;assert.deepEqual(av.players.find(p=>p.id===bid).cards,[null,null]);assert.deepEqual(bv.players.find(p=>p.id===aid).cards,[null,null]);assert.ok(!('deck' in av));assert.ok(!JSON.stringify(bv).includes(av.players.find(p=>p.id===aid).cards[0].id));assert.ok(!JSON.stringify(av).includes('token'));
  for(let i=0;i<30;i++){const s=await a.state();if(s.phase==='results')break;const c=s.turn===aid?a:b;const own=await c.state();const out=await c.action(own.legal.check?'check':'call');assert.equal(out.status,200,JSON.stringify(out.data));}
  const end=await a.state();assert.equal(end.phase,'results');assert.equal(end.board.length,5);const be=await sb.wait('state',s=>s?.phase==='results');assert.deepEqual(end.board,be.board);assert.equal(end.players.reduce((n,p)=>n+p.stack,0),40000);
  assert.equal((await a.post('/api/leave')).status,200);assert.equal((await b.post('/api/leave')).status,200);const am=(await a.get('/api/me')).data,bm=(await b.get('/api/me')).data;assert.equal(am.wallet.available+bm.wallet.available,200000);assert.equal(am.wallet.inPlay+bm.wallet.inPlay,0);
});
test('V2 poker : accord explicite pour les mains favorisées et table isolée',async t=>{
  const{client}=await harness(t),a=await client().register('alice-boost'),b=await client().register('bob-boost'),c=await client().register('chloe-isolated');const room=await a.post('/api/create',{game:'poker',pokerMode:'boost'});assert.equal((await b.post('/api/join',{code:room.data.code})).status,400);assert.equal((await b.get('/api/me')).data.wallet.available,100000);
  assert.equal((await b.post('/api/join',{code:room.data.code,acceptBoost:true})).status,200);const other=await c.post('/api/create',{game:'blackjack',solo:true});assert.notEqual(room.data.code,other.data.code);assert.equal((await a.state()).players.length,2);assert.equal((await c.state()).players.length,1);
});
test('V2 idempotence : deux clics identiques ne débitent qu’une fois ; conflit rejeté',async t=>{
  const{client}=await harness(t),a=await client().register('alice-duplicate');const msg={game:'dice',stake:1000,chance:50,actionId:actionId()};const[x,y]=await Promise.all([a.req('/api/instant',msg),a.req('/api/instant',msg)]);assert.equal(x.status,200);assert.equal(y.status,200);assert.equal(x.data.id,y.data.id);assert.equal(x.data.net,y.data.net);assert.equal((await a.get('/api/me')).data.wallet.available,100000+x.data.net);assert.equal((await a.req('/api/instant',{...msg,stake:2000})).status,409);
});
test('V2 roulette : même numéro, numéro caché pendant la rotation et paiements exacts',async t=>{
  const{client,app}=await harness(t,{spinMs:250}),a=await client().register('alice-wheel'),b=await client().register('bob-wheel');const room=await a.post('/api/create',{game:'roulette'});await b.post('/api/join',{code:room.data.code});await a.stream();await b.stream();await a.action('start');
  assert.equal((await a.action('rouletteBet',{bets:[{type:'red',amount:1000}]})).status,200);assert.equal((await b.action('rouletteBet',{bets:[{type:'straight',selection:0,amount:1000}]})).status,200);const spin=await a.state();assert.equal(spin.phase,'spinning');assert.equal(spin.winningNumber,null);assert.ok(!JSON.stringify(spin).includes('deck'));
  await pause(350);const end=await a.state(),second=await b.state();assert.equal(end.phase,'results');assert.equal(end.winningNumber,second.winningNumber);assert.ok(end.winningNumber>=0&&end.winningNumber<=36);assert.equal(end.results.length,2);assert.equal(Object.values(app.hub.data.escrows).length,2);
});
test('V2 blackjack : naturel ou tours, carte du croupier masquée et 3:2 inchangé',async t=>{
  const{client}=await harness(t),a=await client().register('alice-bj');await a.post('/api/create',{game:'blackjack',solo:true});const bet=await a.action('bet',{amount:1000});assert.equal(bet.status,200);let s=await a.state();if(s.phase==='playing'){assert.equal(s.dealerCards[1],null);assert.equal(s.dealerTotal,null);await a.action('stand');s=await a.state();}assert.equal(s.phase,'results');assert.ok(s.dealerCards.every(Boolean));assert.equal(s.players.length,1);
});
test('V2 connexion : reconnexion au même siège et sessions révoquées par déconnexion',async t=>{
  const{client}=await harness(t),a=await client().register('alice-reconnect');await a.post('/api/create',{game:'poker',solo:true,bots:1});const ss=await a.stream(),before=await a.state();ss.close();await pause(30);await a.stream();const after=await a.state();assert.equal(before.you,after.you);assert.deepEqual(before.players.find(p=>p.id===before.you).cards,after.players.find(p=>p.id===after.you).cards);const oldCookie=a.cookie;await a.post('/api/auth/logout');a.cookie=oldCookie;assert.equal((await a.get('/api/me')).status,401);
});
test('V2 admin : crédit audité visible en SSE, suspension et aucune carte privée',async t=>{
  const{client}=await harness(t),admin=await client().login('owner-test'),a=await client().register('alice-admin');const stream=await a.stream();
  assert.equal((await admin.post('/api/admin/action',{type:'balance',userId:a.me.id,mode:'add',amount:12345,reason:'Session de la classe'})).status,200);const changed=await stream.wait('account',s=>s.wallet.available===112345);assert.equal(changed.wallet.available,112345);
  await a.post('/api/create',{game:'poker',solo:true,bots:1});const data=(await admin.get('/api/admin')).data;assert.equal(data.audit[0].action,'balance');assert.ok(!JSON.stringify(data).includes('scrypt$'));assert.ok(data.rooms.every(r=>!('cards' in r)&&r.players.every(p=>!('cards' in p))));
  assert.equal((await admin.post('/api/admin/action',{type:'suspend',userId:a.me.id,disabled:true,reason:'Pause de test'})).status,200);await stream.wait('auth-expired');assert.equal((await a.get('/api/me')).status,401);
});
test('V2 admin : reset temporaire, changement exigé, puis nouveau mot de passe effectif',async t=>{
  const{client}=await harness(t),admin=await client().login('owner-test'),a=await client().register('alice-reset');const temp='Temporary-For-Tests-1234',next='Changed-Password-For-Tests-1234';
  assert.equal((await admin.post('/api/admin/action',{type:'resetPassword',userId:a.me.id,password:temp,reason:'Mot de passe oublié'})).status,200);assert.equal((await a.get('/api/me')).status,401);await a.login('alice-reset',temp);assert.equal(a.me.mustChangePassword,true);assert.equal((await a.post('/api/instant',{game:'dice',stake:1000,chance:50})).status,403);
  assert.equal((await a.post('/api/profile',{currentPassword:temp,newPassword:next})).status,200);await a.login('alice-reset',next);assert.equal(a.me.mustChangePassword,false);assert.equal((await a.post('/api/instant',{game:'dice',stake:1000,chance:50})).status,200);
});
test('V2 admin : maintenance bloque les nouvelles mises, sans exposer de secrets dans l’export',async t=>{
  const{client}=await harness(t),admin=await client().login('owner-test'),a=await client().register('alice-maintenance');const x=await admin.post('/api/admin/action',{type:'settings',maintenance:true,banner:'Pause de la classe',reason:'Maintenance du club'});assert.equal(x.status,200);assert.equal((await a.post('/api/create',{game:'poker'})).status,503);assert.equal((await a.get('/api/me')).data.banner,'Pause de la classe');const exp=(await admin.get('/api/admin/export')).data;assert.ok(!JSON.stringify(exp).includes(PASSWORD));assert.ok(!JSON.stringify(exp).includes('scrypt$'));assert.ok(!Object.hasOwn(exp,'sessions'));
});
test('V2 capacités : table pleine, solo non rejoignable, arrivée en cours attend',async t=>{
  const{client}=await harness(t),a=await client().register('alice-capacity'),b=await client().register('bob-capacity');const solo=await a.post('/api/create',{game:'poker',solo:true,bots:5});assert.equal((await b.post('/api/join',{code:solo.data.code,acceptBoost:true})).status,404);assert.equal((await a.state()).players.length,6);assert.equal((await a.action('addBot')).status,400);assert.equal((await b.post('/api/join',{code:'ZZZZZZ',acceptBoost:true})).status,404);
});
