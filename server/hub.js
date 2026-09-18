import { randomUUID } from 'node:crypto';
import { HubRoomManager } from './hub-rooms.js';
import { GameError, BETWEEN } from './rooms.js';
import { digest, secret, username, nickname, requestId, cents, note, validHash } from './security.js';
import { createMines, minesView, revealMine, cashMines, diceGame, plinkoGame, plinkoMultipliers } from './minigames.js';

export const START_BALANCE = 100000; // 1 000,00 EUR fictifs. Every amount is an integer number of cents.
const MAX_BALANCE = 1000000000000;
export const emptyState = () => ({ schema:2, users:{}, sessions:{}, escrows:{}, mines:{}, requests:{}, ledger:[], audit:[], settings:{ maintenance:false, banner:'' }, lastCommit:null });
const gameNames={poker:'Poker',blackjack:'Blackjack',roulette:'Roulette',mines:'Cristaux',dice:'Dice',plinko:'Plinko'};
const fail=(message,status=400)=>{throw new GameError(message,status);};

export class CasinoHub {
  constructor(store,options={}) {
    this.store=store;this.options=options;this.manager=new HubRoomManager(options);this.queue=Promise.resolve();
    this.online=new Map();this.onCommit=()=>{};this.dirty=false;this.pending=false;
    this.manager.onChange=()=>{this.pending=true;};
  }
  async init(){
    this.data=await this.store.open(emptyState());
    const base=emptyState();
    this.data={...base,...this.data,settings:{...base.settings,...(this.data.settings||{})}};
    if(!this.data.escrows)this.data.escrows={};
    if(!this.data.mines)this.data.mines={};
    if(!this.data.requests)this.data.requests={};
    if(!this.data.ledger)this.data.ledger=[];
    if(!this.data.audit)this.data.audit=[];
    if(!this.data.users)this.data.users={};
    if(!this.data.sessions)this.data.sessions={};
    const {adminUser,adminPasswordHash}=this.options;
    await this.run(()=>{
      // A restart cancels unfinished TABLE hands. Baseline escrows are the most recent
      // fully settled stacks; thus an interrupted hand cannot destroy a user's buy-in.
      for(const e of Object.values(this.data.escrows))this.release(e,'Reprise serveur · tapis restitué');
      if(adminUser&&adminPasswordHash){
        const un=username(adminUser);if(!validHash(adminPasswordHash))throw new Error('ADMIN_PASSWORD_HASH invalide. Utilise npm run admin:hash.');
        const existing=this.byUsername(un);
        if(existing&&existing.role!=='admin')throw new Error('Le nom administrateur appartient déjà à un joueur. Intervention manuelle nécessaire.');
        if(!existing)this.addUser(un,un,adminPasswordHash,'admin');
      }
      if(this.options.production&&!Object.values(this.data.users).some(u=>u.role==='admin'))throw new Error('Configure ADMIN_USER et ADMIN_PASSWORD_HASH avant la première publication.');
      this.cleanupSessions();
    });
    return this;
  }
  /** All mutation and read access is serialized; clients only see a committed state. */
  run(fn){
    const task=this.queue.then(async()=>{
      if(this.store.lost)fail('Cette instance est en cours de remplacement. Actualise le site.',503);
      const backup=structuredClone({data:this.data,rooms:this.manager.rooms,tokens:this.manager.tokens});
      this.dirty=false;this.pending=false;this.manager.removed=[];this.manager.closed=[];
      try{
        const result=await fn();this.reconcile();
        if(this.dirty)await this.store.save(this.data);
        if(this.pending||this.dirty){try{this.onCommit();}catch{/* Notification failure never rolls back a committed balance. */}}
        return result;
      }catch(error){
        this.data=backup.data;this.manager.rooms=backup.rooms;this.manager.tokens=backup.tokens;
        this.manager.removed=[];this.manager.closed=[];this.pending=false;this.dirty=false;
        throw error;
      }
    });
    this.queue=task.catch(()=>{});return task;
  }
  read(fn){
    const task=this.queue.then(()=>{if(this.store.lost)fail('Le service redémarre. Réessaie dans un instant.',503);return fn();});
    this.queue=task.catch(()=>{});return task;
  }
  byUsername(name){return Object.values(this.data.users).find(u=>u.username===name);}
  addUser(un,name,hash,role='player'){
    if(this.byUsername(un))fail('Cet identifiant est déjà utilisé.',409);
    if(Object.keys(this.data.users).length>=500)fail('La capacité de comptes de ce serveur de classe est atteinte.',409);
    const u={id:randomUUID(),username:un,name,hash,role,disabled:false,balance:START_BALANCE,createdAt:Date.now(),lastSeen:Date.now(),refillAt:0,mustChangePassword:false};
    this.data.users[u.id]=u;this.log(u,{kind:'welcome',walletDelta:START_BALANCE,label:'Bienvenue · crédit fictif offert'});this.dirty=true;return u;
  }
  register(msg,hash){
    if(this.data.settings.maintenance)fail('Les inscriptions sont temporairement fermées.',503);
    return this.addUser(username(msg.username),nickname(msg.name||msg.username),hash);
  }
  log(u,{kind,game=null,walletDelta=0,tableDelta=0,label,reference=null,actor=null,details=null}){
    this.data.ledger.push({id:randomUUID(),userId:u.id,kind,game,walletDelta,tableDelta,balance:u.balance,label,reference,actor,details,at:Date.now()});this.dirty=true;
  }
  audit(actor,action,target,reason,details={}){
    this.data.audit.push({id:randomUUID(),actorId:actor.id,actorName:actor.name,action,target,reason,details,at:Date.now()});this.dirty=true;
  }
  session(u){
    const raw=secret(),key=digest(raw),session={userId:u.id,csrf:secret(),expires:Date.now()+7*86400000,createdAt:Date.now()};
    for(const [id,s]of Object.entries(this.data.sessions).filter(([,s])=>s.userId===u.id).sort((a,b)=>b[1].createdAt-a[1].createdAt).slice(4))delete this.data.sessions[id];
    this.data.sessions[key]=session;u.lastSeen=Date.now();this.dirty=true;return {raw,csrf:session.csrf};
  }
  authenticate(raw){
    const s=this.data.sessions[digest(raw||'')];
    if(!s||s.expires<Date.now())fail('Connecte-toi pour continuer.',401);
    const u=this.data.users[s.userId];
    if(!u||u.disabled)fail('Ce compte est suspendu. Contacte l’administrateur.',401);
    return {u,s,key:digest(raw)};
  }
  requireAdmin(u){if(u.role!=='admin')fail('Accès administrateur requis.',403);}
  requirePlay(u){
    if(u.mustChangePassword)fail('Choisis d’abord un nouveau mot de passe depuis ton profil.',403);
    if(this.data.settings.maintenance)fail('Les nouvelles parties sont momentanément fermées. Les mains en cours peuvent se terminer.',503);
  }
  cleanupSessions(){
    for(const [key,s]of Object.entries(this.data.sessions))if(s.expires<Date.now()){delete this.data.sessions[key];this.dirty=true;}
  }
  wallet(u){
    const table=Object.values(this.data.escrows).filter(e=>e.userId===u.id).reduce((n,e)=>n+e.balance,0);
    const m=this.data.mines[u.id],mines=m?.status==='playing'?m.stake:0;
    return {available:u.balance,inPlay:table+mines,total:u.balance+table+mines,currency:'EUR_FUN'};
  }
  findPlayer(uid,includeLeaving=false){
    for(const r of this.manager.rooms.values())for(const p of r.players)if(p.userId===uid&&(includeLeaving||!p.leaving))return {r,p};
    return null;
  }
  me(u,s=null){
    const entry=this.findPlayer(u.id);
    return {id:u.id,username:u.username,name:u.name,role:u.role,disabled:u.disabled,mustChangePassword:u.mustChangePassword,
      wallet:this.wallet(u),activeRoom:entry?{code:entry.r.code,game:entry.r.game,phase:entry.r.phase}:null,
      mines:minesView(this.data.mines[u.id]),csrf:s?.csrf,
      banner:this.data.settings.banner,maintenance:this.data.settings.maintenance,
      canRefill:this.wallet(u).total<500&&Date.now()-u.refillAt>86400000};
  }
  currentState(u){const entry=this.findPlayer(u.id);return entry?this.manager.view(entry.r,entry.p):null;}
  touch(u){if(Date.now()-u.lastSeen>60000){u.lastSeen=Date.now();this.dirty=true;}}
  idempotent(u,msg,scope,fn){
    const id=requestId(msg.actionId),key=`${u.id}:${id}`,fingerprint=digest(JSON.stringify({scope,msg}));
    const cached=this.data.requests[key];
    if(cached){if(cached.fingerprint!==fingerprint)fail('Cet identifiant a déjà servi pour une autre action.',409);return structuredClone(cached.reply);}
    const reply=fn();this.data.requests[key]={fingerprint,reply:structuredClone(reply),at:Date.now()};this.dirty=true;return reply;
  }
  debit(u,n){cents(n,0);if(n>u.balance)fail('Ton solde disponible est insuffisant.');u.balance-=n;this.dirty=true;}
  credit(u,n){cents(n,0);cents(u.balance+n,0,MAX_BALANCE);u.balance+=n;this.dirty=true;}
  createRoom(u,msg){
    this.requirePlay(u);
    return this.idempotent(u,msg,'create',()=>{
      if(Object.values(this.data.escrows).some(e=>e.userId===u.id))fail('Ton tapis est encore à une table. Attends sa restitution avant de changer de table.');
      if(typeof(msg.solo??false)!=='boolean')fail('Mode invalide.');
      const buyIn=cents(msg.buyIn??20000,2000,200000);if(buyIn%100)fail('Choisis un tapis en euros entiers.');
      if(!Number.isInteger(msg.bots??3)||(msg.bots??3)<1||(msg.bots??3)>5)fail('Choisis 1 à 5 robots.');
      this.debit(u,buyIn);
      this.manager.entering={userId:u.id,buyIn,pokerMode:msg.pokerMode??'boost'};
      let out;try{out=this.manager.create({name:u.name,game:msg.game,solo:msg.solo??false,bots:msg.bots??3,pokerMode:msg.pokerMode??'boost'});}finally{this.manager.entering=null;}
      const e={id:out.id,userId:u.id,roomCode:out.code,game:msg.game,balance:buyIn};this.data.escrows[e.id]=e;
      this.log(u,{kind:'buyin',game:e.game,walletDelta:-buyIn,tableDelta:buyIn,label:'Transfert vers le tapis',reference:out.code});
      return {id:out.id,code:out.code};
    });
  }
  roomInfo(code){
    const r=this.manager.rooms.get(String(code||'').trim().toUpperCase());
    if(!r||r.solo)fail('Cette table privée n’existe plus. Demande un nouveau lien.',404);
    return {code:r.code,game:r.game,players:r.players.filter(p=>!p.leaving).length,capacity:6,pokerMode:r.pokerMode,buyIn:r.buyIn,phase:r.phase};
  }
  joinRoom(u,msg){
    this.requirePlay(u);
    return this.idempotent(u,msg,'join',()=>{
      if(Object.values(this.data.escrows).some(e=>e.userId===u.id))fail('Tu as déjà un tapis engagé dans une table.');
      const info=this.roomInfo(msg.code),buyIn=cents(msg.buyIn??info.buyIn,2000,200000);if(buyIn%100)fail('Choisis un tapis en euros entiers.');
      this.debit(u,buyIn);this.manager.entering={userId:u.id,buyIn,pokerMode:info.pokerMode};
      let out;try{out=this.manager.join({name:u.name,code:msg.code,acceptBoost:msg.acceptBoost});}finally{this.manager.entering=null;}
      this.data.escrows[out.id]={id:out.id,userId:u.id,roomCode:out.code,game:info.game,balance:buyIn};
      this.log(u,{kind:'buyin',game:info.game,walletDelta:-buyIn,tableDelta:buyIn,label:'Transfert vers le tapis',reference:out.code});
      return {id:out.id,code:out.code};
    });
  }
  tableAction(u,msg){
    return this.idempotent(u,msg,'table-action',()=>{
      const entry=this.findPlayer(u.id);if(!entry)fail('Tu n’es plus à cette table.',404);const{r,p}=entry;
      if(msg.type==='start')this.requirePlay(u);
      p.lastRequest=Date.now();return this.manager.act(p.token,msg);
    });
  }
  topUp(u,msg){
    this.requirePlay(u);
    return this.idempotent(u,msg,'topup',()=>{
      const entry=this.findPlayer(u.id);if(!entry)fail('Aucune table active.');const{r,p}=entry;
      if(!BETWEEN.includes(r.phase))fail('Le tapis se recharge entre deux mains.');
      const n=cents(msg.amount,1000,200000);if(n%100)fail('Choisis des euros entiers.');this.debit(u,n);
      p.stack+=n;this.data.escrows[p.id].balance+=n;
      this.log(u,{kind:'topup',game:r.game,walletDelta:-n,tableDelta:n,label:'Ajout au tapis',reference:r.code});this.manager.changed(r);return {ok:true};
    });
  }
  leave(u,msg){
    return this.idempotent(u,msg,'leave',()=>{
      const entry=this.findPlayer(u.id);if(entry)this.manager.leave(entry.p.token);return {ok:true};
    });
  }
  release(e,label){
    if(!this.data.escrows[e.id])return;
    const u=this.data.users[e.userId];this.credit(u,e.balance);
    this.log(u,{kind:'cashout',game:e.game,walletDelta:e.balance,tableDelta:-e.balance,label,reference:e.roomCode});delete this.data.escrows[e.id];this.dirty=true;
  }
  reconcile(){
    const seen=new Set([...this.manager.rooms.values(),...this.manager.closed.map(x=>x.r),...this.manager.removed.map(x=>x.r)]);
    for(const r of seen){
      if(r.phase==='results'&&r.accountedHand!==r.handId){
        const all=[...r.players,...this.manager.removed.filter(x=>x.r===r).map(x=>x.p)];
        for(const p of new Map(all.map(p=>[p.id,p])).values()){
          const e=this.data.escrows[p.id];if(!e||!p.inHand)continue;
          cents(p.stack,0,MAX_BALANCE);const delta=p.stack-e.balance;e.balance=p.stack;
          this.log(this.data.users[e.userId],{kind:'round',game:r.game,tableDelta:delta,label:`${gameNames[r.game]} · ${p.result||'Fin de main'}`,reference:`${r.code}/${r.handId}`,details:{stake:p.totalBet,payout:p.payout,net:delta}});
        }
        r.accountedHand=r.handId;
      }
    }
    for(const {p}of this.manager.removed){const e=this.data.escrows[p.id];if(e)this.release(e,'Retour du tapis au portefeuille');}
    for(const {r,reason}of this.manager.closed){for(const e of Object.values(this.data.escrows))if(e.roomCode===r.code)this.release(e,reason);}
    this.manager.removed=[];this.manager.closed=[];
  }
  instant(u,msg){
    this.requirePlay(u);
    return this.idempotent(u,msg,'instant',()=>{
      const stake=cents(msg.stake,100,20000);this.debit(u,stake);
      const result=msg.game==='dice'?diceGame(stake,msg.chance):msg.game==='plinko'?plinkoGame(stake):fail('Mini-jeu inconnu.');
      this.credit(u,result.payout);result.id=randomUUID();result.net=result.payout-stake;
      this.log(u,{kind:'mini',game:msg.game,walletDelta:result.net,label:`${gameNames[msg.game]} · ${result.net>0?'Gagné':result.net===0?'Mise rendue':'Tour terminé'}`,reference:result.id,details:{stake,payout:result.payout,net:result.net}});
      return result;
    });
  }
  mines(u,msg){
    return this.idempotent(u,msg,'mines',()=>{
      let m=this.data.mines[u.id];
      if(msg.type==='start'){
        this.requirePlay(u);if(m?.status==='playing')fail('Termine d’abord ton exploration en cours.');
        m=createMines(msg.stake,msg.mineCount);this.debit(u,m.stake);this.data.mines[u.id]=m;
        this.log(u,{kind:'mines-bet',game:'mines',walletDelta:-m.stake,tableDelta:m.stake,label:'Cristaux · mise engagée',reference:m.id});
      }else{
        if(!m||m.id!==msg.gameId||m.status!=='playing')fail('Cette exploration n’est plus active.');
        if(msg.type==='reveal')revealMine(m,msg.cell);
        else if(msg.type==='cashout')cashMines(m);
        else if(msg.type==='cancel'&&m.revealed.length===0){m.status='cancelled';m.payout=m.stake;}
        else fail('Action invalide.');
        if(m.status!=='playing'){
          this.credit(u,m.payout);
          this.log(u,{kind:'mines-result',game:'mines',walletDelta:m.payout,tableDelta:-m.stake,label:m.status==='won'?'Cristaux · gain récupéré':m.status==='cancelled'?'Cristaux · mise restituée':'Cristaux · mine touchée',reference:m.id,details:{stake:m.stake,payout:m.payout,net:m.payout-m.stake}});
        }
      }
      this.dirty=true;return minesView(m);
    });
  }
  refill(u,msg){
    return this.idempotent(u,msg,'refill',()=>{
      if(this.wallet(u).total>=500||Date.now()-u.refillAt<86400000)fail('Le crédit de secours est réservé aux soldes sous 5 €, une fois par 24 h.');
      this.credit(u,START_BALANCE);u.refillAt=Date.now();this.log(u,{kind:'refill',walletDelta:START_BALANCE,label:'Crédit fictif de secours'});return {ok:true};
    });
  }
  history(u,offset=0){return this.data.ledger.filter(x=>x.userId===u.id).reverse().slice(offset,offset+50);}
  profile(u,msg,newHash=null){
    if(msg.name!==undefined){u.name=nickname(msg.name);const e=this.findPlayer(u.id);if(e){e.p.name=u.name;this.manager.changed(e.r);}}
    if(newHash){u.hash=newHash;u.mustChangePassword=false;for(const[k,s]of Object.entries(this.data.sessions))if(s.userId===u.id)delete this.data.sessions[k];}
    this.dirty=true;return {ok:true,passwordChanged:Boolean(newHash)};
  }
  adminOverview(u,query=''){
    this.requireAdmin(u);const q=String(query).toLowerCase().slice(0,50);
    const users=Object.values(this.data.users).filter(x=>`${x.name} ${x.username}`.toLowerCase().includes(q)).map(x=>({id:x.id,name:x.name,username:x.username,role:x.role,disabled:x.disabled,mustChangePassword:x.mustChangePassword,createdAt:x.createdAt,lastSeen:x.lastSeen,online:(this.online.get(x.id)??0)>0,wallet:this.wallet(x)}));
    const rooms=[...this.manager.rooms.values()].map(r=>({code:r.code,game:r.game,phase:r.phase,players:r.players.filter(p=>!p.leaving).map(p=>({name:p.name,bot:p.bot})),pokerMode:r.pokerMode,createdAt:r.createdAt}));
    return {users,rooms,settings:this.data.settings,audit:this.data.audit.slice(-100).reverse(),stats:{users:Object.keys(this.data.users).length,online:[...this.online.values()].filter(x=>x>0).length,rooms:rooms.length,transactions:this.data.ledger.length},storage:this.store.mode};
  }
  adminAction(actor,msg,passwordHash=null){
    this.requireAdmin(actor);
    // Never cache a plaintext password, not even inside a fingerprint's source object.
    const safeMsg={...msg};delete safeMsg.password;
    return this.idempotent(actor,safeMsg,'admin',()=>{
      const reason=note(msg.reason);
      if(msg.type==='settings'){
        if(typeof msg.maintenance!=='boolean'||typeof msg.banner!=='string'||msg.banner.length>180)fail('Paramètres invalides.');
        this.data.settings={maintenance:msg.maintenance,banner:msg.banner.replace(/[\u0000-\u001f\u007f]/g,'')};
        this.audit(actor,'settings','site',reason,this.data.settings);this.pending=true;return {ok:true};
      }
      if(msg.type==='closeRoom'){
        const r=this.manager.rooms.get(msg.code);if(!r)fail('La table est déjà fermée.',404);
        this.manager.closeRoom(r,'Table annulée par l’administrateur · tapis restitué');
        this.audit(actor,'close-room',r.code,reason,{phase:r.phase,game:r.game});return {ok:true};
      }
      const target=this.data.users[msg.userId];if(!target)fail('Utilisateur introuvable.',404);
      if(msg.type==='balance'){
        const amount=cents(msg.amount,0,100000000),before=target.balance;
        let after=msg.mode==='set'?amount:msg.mode==='add'?before+amount:msg.mode==='subtract'?before-amount:NaN;
        cents(after,0,MAX_BALANCE);target.balance=after;
        this.log(target,{kind:'admin',walletDelta:after-before,label:`Administration · ${reason}`,actor:actor.id});
        this.audit(actor,'balance',target.id,reason,{mode:msg.mode,amount,before,after});
      }else if(msg.type==='suspend'){
        if(target.role==='admin')fail('Le compte administrateur ne peut pas être suspendu.');
        if(typeof msg.disabled!=='boolean')fail('Statut invalide.');target.disabled=msg.disabled;
        if(target.disabled){
          for(const[k,s]of Object.entries(this.data.sessions))if(s.userId===target.id)delete this.data.sessions[k];
          const entry=this.findPlayer(target.id);if(entry)this.manager.leave(entry.p.token);
          this.abortMines(target,'Exploration annulée · compte suspendu');
        }
        this.audit(actor,'suspend',target.id,reason,{disabled:target.disabled});
      }else if(msg.type==='revokeSessions'){
        if(target.id===actor.id)fail('Utilise « Déconnexion » pour ta propre session.');
        for(const[k,s]of Object.entries(this.data.sessions))if(s.userId===target.id)delete this.data.sessions[k];
        this.audit(actor,'revoke-sessions',target.id,reason);
      }else if(msg.type==='resetPassword'){
        if(target.id===actor.id)fail('Change ton mot de passe depuis ton profil.');
        if(!validHash(passwordHash))fail('Nouveau mot de passe invalide.');target.hash=passwordHash;target.mustChangePassword=true;
        for(const[k,s]of Object.entries(this.data.sessions))if(s.userId===target.id)delete this.data.sessions[k];
        this.audit(actor,'reset-password',target.id,reason);
      }else if(msg.type==='cancelMines'){
        this.abortMines(target,'Exploration annulée par l’administrateur');this.audit(actor,'cancel-mines',target.id,reason);
      }else fail('Action administrateur inconnue.');
      this.dirty=true;this.pending=true;return {ok:true};
    });
  }
  abortMines(u,label){
    const m=this.data.mines[u.id];if(!m||m.status!=='playing')return;
    m.status='cancelled';m.payout=m.stake;this.credit(u,m.stake);
    this.log(u,{kind:'mines-result',game:'mines',walletDelta:m.stake,tableDelta:-m.stake,label,reference:m.id});
  }
  tick(now=Date.now()){
    for(const r of this.manager.rooms.values())for(const p of r.players)if(!p.bot&&!p.leaving&&p.connected&&!(this.online.get(p.userId)>0)&&now-(p.lastRequest??p.joinedAt)>30000)this.manager.disconnect(p.token);
    this.manager.tick(now);
  }
  connect(u){this.online.set(u.id,(this.online.get(u.id)||0)+1);this.touch(u);const e=this.findPlayer(u.id);if(e)this.manager.connect(e.p.token);}
  disconnect(uid){
    const count=Math.max(0,(this.online.get(uid)||0)-1);this.online.set(uid,count);
    if(!count){const e=this.findPlayer(uid);if(e)this.manager.disconnect(e.p.token);}
  }
  config(){return {version:'2.0.0',games:Object.keys(gameNames),startingBalance:START_BALANCE,plinkoMultipliers:plinkoMultipliers(),pokerSamples:24};}
}
