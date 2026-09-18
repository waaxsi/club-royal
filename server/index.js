import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { SnapshotStore, StorageError } from './storage.js';
import { CasinoHub } from './hub.js';
import { GameError } from './rooms.js';
import { digest, secureEqual, username, hashPassword, verifyPassword, validHash } from './security.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],
  ...['app','cards-ui','effects','art'].map(n=>[`/${n}.js`,[`${n}.js`,'text/javascript; charset=utf-8']]),
  ['/styles.css',['styles.css','text/css; charset=utf-8']],['/favicon.svg',['favicon.svg','image/svg+xml']]
]);
const headers={
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function json(res,code,data,extra={}){
  if(res.headersSent)return;res.writeHead(code,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(data));
}
async function body(req){
  if(!(req.headers['content-type']||'').startsWith('application/json'))throw new GameError('JSON requis.',415);
  const chunks=[];let size=0;
  for await(const part of req){size+=part.length;if(size>16384)throw new GameError('Requête trop volumineuse.',413);chunks.push(part);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new GameError('JSON invalide.');}
}
export function lanAddresses(port){return Object.values(networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal).map(x=>`http://${x.address}:${port}`);}
function cookieValue(req){return String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('cr_session='))?.slice(11)||'';}
const sessionCookie=(token,secure,clear=false)=>`cr_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:604800}${secure?'; Secure':''}`;
function clientIp(req,trustedHops=0){
  if(!trustedHops)return req.socket.remoteAddress||'unknown';
  const fwd=String(req.headers['x-forwarded-for']||'').split(',').map(x=>x.trim()).filter(x=>isIP(x));
  const chain=[...fwd,req.socket.remoteAddress];return chain[Math.max(0,chain.length-1-trustedHops)]||req.socket.remoteAddress;
}
let cryptoActive=0;const cryptoWaiters=[];
async function passwordWork(fn){
  if(cryptoWaiters.length>=40)throw new GameError('Beaucoup de connexions en cours. Réessaie dans quelques secondes.',429);
  if(cryptoActive>=2)await new Promise(r=>cryptoWaiters.push(r));
  cryptoActive++;try{return await fn();}finally{cryptoActive--;cryptoWaiters.shift()?.();}
}
const DUMMY_HASH=`scrypt$32768$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;

export async function createApp(options={}){
  const production=Boolean(options.production),secureCookie=production||String(options.publicBaseUrl||'').startsWith('https://');
  if(options.adminPasswordHash&&!validHash(options.adminPasswordHash))throw new Error('ADMIN_PASSWORD_HASH invalide.');
  const store=options.store||new SnapshotStore({filename:options.dataFile||':memory:',remoteUrl:options.remoteUrl,remoteToken:options.remoteToken});
  const hub=await new CasinoHub(store,{...options,production}).init();
  const streams=new Set(),limits=new Map();let stopping=false,ticking=false,checking=false;
  function limit(key,max,window=60000){
    const now=Date.now();let b=limits.get(key);
    if(!b||now-b.start>window){b={start:now,n:0,window};limits.set(key,b);}
    if(++b.n>max)throw new GameError('Trop de tentatives. Patiente un instant avant de réessayer.',429);
  }
  function send(stream,event,payload){if(stream.res.destroyed)return;if(stream.res.writableLength>256000){stream.res.destroy();return;}stream.res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);}
  function broadcast(){
    for(const stream of streams){
      const s=hub.data.sessions[stream.sessionKey],u=hub.data.users[stream.userId];
      if(!s||!u||u.disabled||s.expires<Date.now()){send(stream,'auth-expired',{});stream.res.end();continue;}
      send(stream,'account',hub.me(u,s));send(stream,'state',hub.currentState(u));
    }
  }
  hub.onCommit=broadcast;
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),raw=cookieValue(req),ip=clientIp(req,options.trustProxyHops??0);
      if(req.headers.origin){
        let origin;try{origin=new URL(req.headers.origin).origin;}catch{throw new GameError('Origine invalide.',403);}
        const allowed=options.publicBaseUrl?new URL(options.publicBaseUrl).origin:`${secureCookie?'https':'http'}://${req.headers.host}`;
        if(origin!==allowed)throw new GameError('Origine non autorisée.',403);
      }
      if(req.headers['sec-fetch-site']==='cross-site'&&url.pathname.startsWith('/api/'))throw new GameError('Requête externe refusée.',403);
      if(req.method==='GET'&&url.pathname==='/api/health')return json(res,store.lost?503:200,{ok:!store.lost,version:'2.0.0'});
      if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,await hub.read(()=>({...hub.config(),banner:hub.data.settings.banner,maintenance:hub.data.settings.maintenance})));
      if(req.method==='GET'&&url.pathname==='/api/info')return json(res,200,{lan:production||options.publicBaseUrl?[]:lanAddresses(server.address()?.port??3000),publicBaseUrl:options.publicBaseUrl||null,version:'2.0.0'});
      if(url.pathname.startsWith('/api/')){
        limit(`global:${ip}`,2400);
        if(req.method==='GET'&&url.pathname==='/api/room')return json(res,200,await hub.read(()=>hub.roomInfo(url.searchParams.get('code'))));
        const msg=req.method==='POST'?await body(req):null;
        if(req.method==='POST'&&req.headers['x-cr-request']!=='1')throw new GameError('En-tête de sécurité manquant.',403);
        if(req.method==='POST'&&['/api/auth/register','/api/auth/login'].includes(url.pathname)){
          limit(`auth-ip:${ip}`,120,300000);
          const un=username(msg.username);limit(`auth-user:${un}`,8,300000);
          let hash=null,matched=null;
          if(url.pathname.endsWith('register')){
            limit(`registration:${ip}`,120,600000);hash=await passwordWork(()=>hashPassword(msg.password));
          }else{
            matched=await hub.read(()=>{const u=hub.byUsername(un);return u?{id:u.id,hash:u.hash}:null;});
            const valid=await passwordWork(()=>verifyPassword(msg.password,matched?.hash||DUMMY_HASH));
            if(!valid||!matched)throw new GameError('Identifiant ou mot de passe incorrect.',401);
          }
          const result=await hub.run(()=>{
            const u=hash?hub.register(msg,hash):hub.data.users[matched.id];
            if(!u||u.disabled||(!hash&&u.hash!==matched.hash))throw new GameError('Identifiant ou mot de passe incorrect.',401);
            const s=hub.session(u);return {raw:s.raw};
          });
          const me=await hub.read(()=>{const{u,s}=hub.authenticate(result.raw);return hub.me(u,s);});
          return json(res,200,{me},{'Set-Cookie':sessionCookie(result.raw,secureCookie)});
        }
        const identity=await hub.read(()=>hub.authenticate(raw));limit(`user:${identity.u.id}`,300);
        if(req.method==='GET'&&url.pathname==='/api/events'){
          if([...streams].filter(s=>s.userId===identity.u.id).length>=5)throw new GameError('Ferme un autre onglet du site avant de continuer.',429);
          res.writeHead(200,{...headers,'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();req.socket.setTimeout(0);
          const stream={res,userId:identity.u.id,sessionKey:identity.key};streams.add(stream);
          res.on('close',()=>{if(streams.delete(stream)&&!stopping)hub.run(()=>hub.disconnect(stream.userId)).catch(()=>{});});
          await hub.run(()=>{const{u}=hub.authenticate(raw);hub.connect(u);});
          // connect may not change a table or a lastSeen timestamp; always send a snapshot.
          await hub.read(()=>{const{u,s}=hub.authenticate(raw);send(stream,'account',hub.me(u,s));send(stream,'state',hub.currentState(u));});return;
        }
        if(req.method==='GET'){
          const output=await hub.read(()=>{
            const{u,s}=hub.authenticate(raw);
            if(url.pathname==='/api/me')return hub.me(u,s);
            if(url.pathname==='/api/state')return hub.currentState(u);
            if(url.pathname==='/api/history')return hub.history(u,Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0)));
            if(url.pathname==='/api/admin')return hub.adminOverview(u,url.searchParams.get('q')||'');
            if(url.pathname==='/api/admin/history'){hub.requireAdmin(u);const target=hub.data.users[url.searchParams.get('user')];if(!target)throw new GameError('Utilisateur introuvable.',404);return hub.history(target,Math.max(0,Number(url.searchParams.get('offset'))||0));}
            if(url.pathname==='/api/admin/export'){hub.requireAdmin(u);return {exportedAt:new Date().toISOString(),users:hub.adminOverview(u).users,ledger:hub.data.ledger,audit:hub.data.audit};}
            throw new GameError('Route inconnue.',404);
          });
          return json(res,200,output,url.pathname==='/api/admin/export'?{'Content-Disposition':'attachment; filename="club-royal-export.json"'}:{});
        }
        if(req.method==='POST'){
          if(!secureEqual(req.headers['x-csrf-token'],identity.s.csrf))throw new GameError('Actualise la page avant de continuer (session de sécurité).',403);
          let newHash=null;const checkedHash=identity.u.hash;
          if(url.pathname==='/api/profile'&&msg.newPassword!==undefined){
            const valid=await passwordWork(()=>verifyPassword(msg.currentPassword,checkedHash));if(!valid)throw new GameError('Mot de passe actuel incorrect.',401);
            newHash=await passwordWork(()=>hashPassword(msg.newPassword));
          }
          if(url.pathname==='/api/admin/action'&&msg.type==='resetPassword'){
            hub.requireAdmin(identity.u);newHash=await passwordWork(()=>hashPassword(msg.password));
          }
          if(['/api/instant','/api/mines'].includes(url.pathname))limit(`mini:${identity.u.id}`,120);
          const result=await hub.run(()=>{
            const{u,s,key}=hub.authenticate(raw);
            if(!secureEqual(req.headers['x-csrf-token'],s.csrf))throw new GameError('Session modifiée. Actualise.',403);
            hub.touch(u);
            if(url.pathname==='/api/create')return hub.createRoom(u,msg);
            if(url.pathname==='/api/join')return hub.joinRoom(u,msg);
            if(url.pathname==='/api/action')return hub.tableAction(u,msg);
            if(url.pathname==='/api/leave')return hub.leave(u,msg);
            if(url.pathname==='/api/topup')return hub.topUp(u,msg);
            if(url.pathname==='/api/instant')return hub.instant(u,msg);
            if(url.pathname==='/api/mines')return hub.mines(u,msg);
            if(url.pathname==='/api/refill')return hub.refill(u,msg);
            if(url.pathname==='/api/admin/action')return hub.adminAction(u,msg,newHash);
            if(url.pathname==='/api/profile'){
              if(newHash&&u.hash!==checkedHash)throw new GameError('Le mot de passe a changé. Reconnecte-toi.',401);
              return hub.profile(u,msg,newHash);
            }
            if(url.pathname==='/api/auth/logout'){delete hub.data.sessions[key];hub.dirty=true;hub.pending=true;return {ok:true};}
            throw new GameError('Route inconnue.',404);
          });
          const logout=url.pathname==='/api/auth/logout'||Boolean(result?.passwordChanged);
          const current=logout?{me:null,state:null}:await hub.read(()=>{const{u,s}=hub.authenticate(raw);return{me:hub.me(u,s),state:hub.currentState(u)};});
          return json(res,200,{...result,...current},logout?{'Set-Cookie':sessionCookie('',secureCookie,true)}:{});
        }
        throw new GameError('Méthode non autorisée.',405);
      }
      if((req.method==='GET'||req.method==='HEAD')&&assets.has(url.pathname)){
        const[name,mime]=assets.get(url.pathname),file=path.join(root,'public',name),metadata=await stat(file);
        res.writeHead(200,{...headers,'Content-Type':mime,'Content-Length':metadata.size});return res.end(req.method==='HEAD'?undefined:await readFile(file));
      }
      json(res,404,{error:'Page introuvable.'});
    }catch(error){
      if(res.headersSent){try{res.write('event: service-error\ndata: {}\n\n');res.end();}catch{}return;}
      const status=error.status??400;
      const message=error instanceof StorageError?error.message:error.code?'Action impossible. Réessaie dans un instant.':error.message||'Action impossible.';
      json(res,status,{error:message},status===429?{'Retry-After':'60'}:{});
    }
  });
  server.requestTimeout=20000;server.headersTimeout=15000;server.keepAliveTimeout=65000;
  const clock=setInterval(()=>{
    if(ticking||stopping||store.lost)return;ticking=true;
    hub.run(()=>hub.tick()).catch(()=>{}).finally(()=>{ticking=false;});
  },options.tickMs??200);clock.unref();
  const heartbeat=setInterval(()=>{
    for(const stream of streams){if(stream.res.writableLength>256000)stream.res.destroy();else stream.res.write(': heartbeat\n\n');}
    for(const[k,v]of limits)if(Date.now()-v.start>v.window)limits.delete(k);
    if(!checking&&!stopping){checking=true;hub.read(()=>store.checkOwner()).then(owned=>{if(!owned)for(const s of streams){send(s,'service-error',{});s.res.end();}}).catch(()=>{}).finally(()=>{checking=false;});}
  },options.heartbeatMs??10000);heartbeat.unref();
  async function stop(){
    if(stopping)return;stopping=true;clearInterval(clock);clearInterval(heartbeat);
    for(const stream of streams)stream.res.end();streams.clear();
    if(!store.lost)await hub.run(()=>{for(const r of [...hub.manager.rooms.values()])hub.manager.closeRoom(r,'Arrêt du serveur · tapis restitué');}).catch(()=>{});
    await hub.queue;
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});store.close();
  }
  return {server,hub,manager:hub.manager,store,stop};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
  const port=Number(process.env.PORT||3000),production=process.env.NODE_ENV==='production'||Boolean(process.env.RENDER);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT doit être compris entre 1 et 65535.');
  let publicBaseUrl=process.env.PUBLIC_BASE_URL||'';
  if(publicBaseUrl){const u=new URL(publicBaseUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('PUBLIC_BASE_URL invalide.');publicBaseUrl=u.origin;}
  if(production&&!publicBaseUrl.startsWith('https://'))throw new Error('PUBLIC_BASE_URL HTTPS est obligatoire en production.');
  if(production&&!process.env.TURSO_DATABASE_URL&&process.env.PERSISTENT_STORAGE!=='1')throw new Error('Comptes persistants : configure TURSO_DATABASE_URL/TURSO_AUTH_TOKEN, ou DATA_FILE sur un vrai disque persistant + PERSISTENT_STORAGE=1. Aucun stockage éphémère en production.');
  const app=await createApp({production,publicBaseUrl,dataFile:process.env.DATA_FILE||path.join(root,'data','club-royal.sqlite'),remoteUrl:process.env.TURSO_DATABASE_URL,remoteToken:process.env.TURSO_AUTH_TOKEN,adminUser:process.env.ADMIN_USER,adminPasswordHash:process.env.ADMIN_PASSWORD_HASH,trustProxyHops:Number(process.env.TRUST_PROXY_HOPS||0)});
  app.server.on('error',async error=>{console.error(error.code==='EADDRINUSE'?`Le port ${port} est déjà occupé. Aucun autre programme n’a été arrêté.`:'Démarrage impossible. Vérifie la configuration.');await app.stop();process.exitCode=1;});
  app.server.listen(port,'0.0.0.0',()=>{
    console.log('\n  CLUB ROYAL v2 — Six jeux, euros fictifs & comptes\n');
    console.log(`  Sur ce PC : http://localhost:${port}`);
    if(publicBaseUrl)console.log(`  Adresse publique : ${publicBaseUrl}`);else for(const a of lanAddresses(port))console.log(`  Adresse réseau candidate : ${a}`);
    console.log(`  Stockage : ${app.store.mode}. Un seul processus de jeu.`);
    console.log('  100 % fictif. Aucun dépôt, retrait ou argent réel.\n');
  });
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{await app.stop();process.exit(0);});
}
