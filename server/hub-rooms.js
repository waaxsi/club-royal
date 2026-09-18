import { randomInt } from 'node:crypto';
import { RoomManager, BETWEEN, GameError } from './rooms.js';
import { startPoker, actPoker, pokerLegal, pokerBot } from './poker.js';
import { startBlackjack, placeBlackjackBet, dealBlackjack, actBlackjack, blackjackBot } from './blackjack.js';
import { startRoulette, betRoulette, spinRoulette, settleRoulette } from './roulette.js';
import { favoredDeck } from './boost.js';

/** V2 orchestration. The original independently tested card engines remain in use. */
export class HubRoomManager extends RoomManager {
  constructor(options = {}) {
    super(options); this.entering = null; this.removed = []; this.closed = [];
    this.spinMs = options.spinMs ?? 4800;
  }
  addPlayer(r, name, bot=false) {
    const p = super.addPlayer(r,name,bot);
    r.currency = 'EUR_FUN'; r.smallBlind = 100; r.bigBlind = 200;
    r.betMin = 500; r.betMax = 20000; r.betStep = 500; r.spinMs = this.spinMs;
    if (!r.pokerMode) r.pokerMode = this.entering?.pokerMode ?? 'classic';
    p.stack = bot ? (r.buyIn ?? 20000) : (this.entering?.buyIn ?? r.buyIn ?? 20000);
    if (!bot) p.userId = this.entering?.userId;
    return p;
  }
  create(options) {
    if (!['poker','blackjack','roulette'].includes(options.game)) throw new GameError('Jeu inconnu.');
    if (!['classic','boost'].includes(options.pokerMode ?? 'boost')) throw new GameError('Mode poker invalide.');
    const result = super.create({ ...options, game: options.game === 'roulette' ? 'blackjack' : options.game, solo: false });
    const r = this.rooms.get(result.code);
    r.game = options.game; r.solo = Boolean(options.solo); r.buyIn = this.entering?.buyIn ?? 20000;
    r.pokerMode = options.pokerMode ?? 'boost'; r.rouletteHistory = [];
    if (r.solo && r.game === 'poker') {
      const names=['Nova','Luna','Milo','Charlie','Oscar'];
      for (let i=0;i<(options.bots ?? 3);i++) this.addPlayer(r,names[i],true);
    }
    if (r.solo) this.start(r);
    this.changed(r);
    return { id:result.id, code:result.code, state:this.view(r,r.players[0]) };
  }
  join(options) {
    const r = this.rooms.get(String(options.code || '').trim().toUpperCase());
    if (r?.game === 'poker' && r.pokerMode === 'boost' && options.acceptBoost !== true) throw new GameError('Cette table utilise le mode Mains favorisées. Accepte cette règle avant de rejoindre.');
    const result = super.join(options);
    return { id:result.id, code:result.code, state:result.state };
  }
  cleanBetween(r) {
    if (!BETWEEN.includes(r.phase) && r.phase !== 'error') return;
    const kept=[];
    for (const p of r.players) {
      const expired = p.leaving || (!p.bot && !p.connected && Date.now() - p.disconnectedAt > this.graceMs);
      if (expired) { this.tokens.delete(p.token); this.removed.push({r,p}); }
      else kept.push(p);
    }
    r.players=kept; this.transferOwner(r);
  }
  start(r) {
    this.cleanBetween(r);
    if (r.game === 'poker') {
      const count=r.players.filter(p=>!p.leaving&&(p.bot||p.connected)&&p.stack>0).length;
      if (count<2) throw new GameError('Il faut deux joueurs avec un tapis. Ajoute un robot.');
      startPoker(r,r.pokerMode==='boost'?favoredDeck(count):undefined);
    } else if (r.game==='blackjack') {
      startBlackjack(r);
      for (const p of r.players) if (p.bot && p.inHand) placeBlackjackBet(r,p,Math.min(10000,Math.floor(p.stack/500)*500));
    } else {
      startRoulette(r);
      for (const p of r.players) if (p.bot && p.inHand) betRoulette(r,p,[{type:randomInt(2)?'red':'black',amount:Math.min(1000,Math.floor(p.stack/100)*100)}]);
    }
    r.turnSeq++;
  }
  act(token,msg) {
    if (msg?.type==='refill') throw new GameError('Le tapis vient de ton portefeuille. Utilise « Ajouter au tapis » entre deux mains.');
    const {r,p}=this.auth(token);
    if (r.game==='roulette' && msg?.type==='rouletteBet') {
      if (typeof msg.actionId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(msg.actionId)) throw new GameError('Identifiant invalide.');
      if(p.requests.has(msg.actionId))return p.requests.get(msg.actionId);
      if(msg.handId!==r.handId)throw new GameError('Le tour a déjà changé.');
      betRoulette(r,p,msg.bets);r.turnSeq++;this.changed(r);
      const result={ok:true,version:r.version};p.requests.set(msg.actionId,result);return result;
    }
    return super.act(token,msg);
  }
  closeRoom(r,reason='Table fermée') {
    if (!this.rooms.has(r.code)) return;
    this.closed.push({r,reason});
    for(const p of r.players)this.tokens.delete(p.token);
    this.rooms.delete(r.code);this.onChange(r);
  }
  tick(now=Date.now()) {
    for(const r of [...this.rooms.values()]) {
      let changed=false;
      for(const p of r.players)if(!p.bot&&!p.leaving&&!p.connected&&p.disconnectedAt!==null&&now-p.disconnectedAt>this.graceMs){p.leaving=true;this.tokens.delete(p.token);changed=true;}
      if(changed){this.transferOwner(r);this.changed(r);}
      const humans=r.players.filter(p=>!p.bot&&!p.leaving&&(p.connected||now-(p.disconnectedAt??p.joinedAt)<this.graceMs));
      if ((BETWEEN.includes(r.phase)||r.phase==='error') && !humans.length) {this.closeRoom(r,r.phase==='error'?'Incident : main annulée':'Table terminée');continue;}
      if(now-r.createdAt>this.ttlMs){this.closeRoom(r,'Table expirée : main en cours annulée');continue;}
      try {
        const actor=r.players.find(p=>p.id===r.turn);
        if(r.phase==='betting'&&r.deadline&&now>=r.deadline){
          if(r.game==='roulette')spinRoulette(r,now);else dealBlackjack(r);
          r.turnSeq++;this.changed(r);
        } else if(r.game==='roulette'&&r.phase==='spinning'&&now>=r.spinEndsAt){settleRoulette(r);r.turnSeq++;this.changed(r);}
        else if(actor&&((actor.bot&&now>=r.botAt)||now>=r.deadline||actor.leaving)){
          const action=actor.bot?(r.game==='poker'?pokerBot(r,actor):blackjackBot(r,actor)):
            r.game==='poker'?{type:pokerLegal(r,actor).check?'check':'fold'}:{type:'stand'};
          if(r.game==='poker')actPoker(r,actor,action.type,action.amount);else actBlackjack(r,actor,action.type);
          r.turnSeq++;r.botAt=0;this.changed(r);
        }
      }catch{
        r.phase='error';r.turn=null;r.deadline=0;r.logs.push('Main interrompue : les fonds engagés seront rendus.');this.closeRoom(r,'Incident : main annulée');
      }
    }
  }
  view(r,p){
    const v=super.view(r,p);
    Object.assign(v,{currency:'EUR_FUN',pokerMode:r.pokerMode,buyIn:r.buyIn??20000,betMin:r.betMin,betMax:r.betMax,betStep:r.betStep});
    if(r.game==='roulette')Object.assign(v,{
      legal:null,pot:r.players.reduce((n,p)=>n+p.totalBet,0),rouletteHistory:r.rouletteHistory??[],
      winningNumber:r.phase==='results'?r.winningNumber:null,spinStartedAt:r.spinStartedAt??0,spinEndsAt:r.spinEndsAt??0,
      players:v.players.map(publicP=>({...publicP,rouletteBets:r.players.find(x=>x.id===publicP.id).rouletteBets??[]}))
    });
    return v;
  }
}
