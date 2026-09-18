import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { startPoker, actPoker, pokerLegal, pokerBot } from './poker.js';
import { startBlackjack, placeBlackjackBet, dealBlackjack, actBlackjack, blackjackLegal, blackjackBot } from './blackjack.js';
import { blackjackValue, evaluate } from './cards.js';

export class GameError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const botNames = ['Charlie', 'Nova', 'Oscar', 'Luna', 'Milo'];
export const BETWEEN = ['lobby', 'results'];

export class RoomManager {
  constructor({ turnMs = 25000, betMs = 30000, botMs = 950, graceMs = 90000, ttlMs = 7200000, maxRooms = 100 } = {}) {
    this.rooms = new Map(); this.tokens = new Map();
    Object.assign(this, { turnMs, betMs, botMs, graceMs, ttlMs, maxRooms });
    this.onChange = () => {};
  }
  code() {
    let code;
    do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (this.rooms.has(code));
    return code;
  }
  name(value) {
    if (typeof value !== 'string') throw new GameError('Choisis un pseudo.');
    const name = value.trim().replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 18);
    if (name.length < 2) throw new GameError('Ton pseudo doit contenir 2 à 18 caractères.');
    return name;
  }
  addPlayer(r, name, bot = false) {
    if (r.players.length >= 6) throw new GameError('Cette table est complète (6 places).');
    const seat = [0, 1, 2, 3, 4, 5].find(s => !r.players.some(p => p.seat === s));
    const p = {
      id: randomUUID(), token: randomBytes(32).toString('base64url'), name, bot, seat,
      connected: true, disconnectedAt: null, leaving: false, joinedAt: Date.now(),
      stack: r.game === 'poker' ? 2000 : 1000, refills: 0,
      inHand: false, cards: [], totalBet: 0, streetBet: 0, bjBet: 0, folded: false, allIn: false,
      lastAction: '', result: '', payout: 0, requests: new Map()
    };
    r.players.push(p);
    if (!bot) this.tokens.set(p.token, { r, p });
    return p;
  }
  create({ name, game, solo = false, bots = 3 }) {
    if (!['poker', 'blackjack'].includes(game)) throw new GameError('Jeu inconnu.');
    if (typeof solo !== 'boolean') throw new GameError('Mode invalide.');
    if (this.rooms.size >= this.maxRooms) throw new GameError('Le serveur a atteint sa capacité de tables.');
    name = this.name(name);
    if (!Number.isInteger(bots) || bots < 1 || bots > 5) throw new GameError('Choisis 1 à 5 robots.');
    const r = {
      code: this.code(), game, solo, players: [], ownerId: null, version: 1, handId: 0,
      turnSeq: 0, phase: 'lobby', turn: null, deadline: 0, timerKey: '',
      smallBlind: 10, bigBlind: 20, board: [], dealerCards: [], logs: [], results: [], pots: [],
      updatedAt: Date.now(), createdAt: Date.now(), dealerSeat: -1
    };
    this.rooms.set(r.code, r);
    const p = this.addPlayer(r, name); r.ownerId = p.id;
    if (solo && game === 'poker') for (let i = 0; i < bots; i++) this.addPlayer(r, botNames[i], true);
    if (solo) this.start(r);
    this.changed(r);
    return { token: p.token, id: p.id, code: r.code, state: this.view(r, p) };
  }
  join({ name, code }) {
    if (typeof code !== 'string') throw new GameError('Code invalide.');
    const r = this.rooms.get(code.trim().toUpperCase());
    if (!r) throw new GameError('Table introuvable. Vérifie le code ou le serveur.', 404);
    if (r.solo) throw new GameError('Cette table est une partie solo. Crée une table privée pour jouer à plusieurs.');
    this.cleanBetween(r);
    const p = this.addPlayer(r, this.name(name));
    this.changed(r);
    return { token: p.token, id: p.id, code: r.code, state: this.view(r, p) };
  }
  auth(token) {
    const identity = this.tokens.get(token);
    if (!identity || identity.p.leaving || !this.rooms.has(identity.r.code)) throw new GameError('Ta session a expiré. Rejoins la table à nouveau.', 401);
    return identity;
  }
  cleanBetween(r) {
    if (!BETWEEN.includes(r.phase)) return;
    r.players = r.players.filter(p => {
      const expired = p.leaving || (!p.bot && !p.connected && Date.now() - p.disconnectedAt > this.graceMs);
      if (expired) this.tokens.delete(p.token);
      return !expired;
    });
    this.transferOwner(r);
  }
  transferOwner(r) {
    const host = r.players.find(p => p.id === r.ownerId);
    if (!host || !host.connected || host.leaving) r.ownerId = r.players.find(p => !p.bot && p.connected && !p.leaving)?.id ?? null;
  }
  start(r) {
    this.cleanBetween(r);
    if (r.game === 'poker') startPoker(r);
    else {
      startBlackjack(r);
      for (const p of r.players) if (p.bot && p.inHand) placeBlackjackBet(r, p, Math.min(100, Math.floor(p.stack / 10) * 10));
    }
    r.turnSeq++;
  }
  act(token, msg) {
    const { r, p } = this.auth(token);
    if (!msg || typeof msg !== 'object' || typeof msg.actionId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(msg.actionId)) throw new GameError('Identifiant d’action invalide.');
    if (p.requests.has(msg.actionId)) return p.requests.get(msg.actionId);
    const { type, amount } = msg;
    const gameplay = ['fold', 'check', 'call', 'raise', 'allin', 'hit', 'stand', 'double'];
    if ((gameplay.includes(type) || ['bet', 'start'].includes(type)) && msg.handId !== r.handId) throw new GameError('Cette main a déjà changé. La table a été actualisée.');
    if (gameplay.includes(type) && msg.turnSeq !== r.turnSeq) throw new GameError('Cette action est périmée. Réessaie depuis la table actualisée.');
    if (type === 'start') {
      if (r.ownerId !== p.id) throw new GameError('Seul l’hôte peut distribuer.');
      if (!BETWEEN.includes(r.phase)) throw new GameError('Une main est déjà en cours.');
      this.start(r);
    } else if (type === 'addBot' || type === 'removeBot') {
      if (r.ownerId !== p.id || !BETWEEN.includes(r.phase)) throw new GameError('Les robots se gèrent par l’hôte entre deux mains.');
      this.cleanBetween(r);
      if (type === 'addBot') {
        const name = botNames.find(n => !r.players.some(x => x.bot && x.name === n)) ?? 'Robot';
        this.addPlayer(r, name, true);
      } else {
        const b = [...r.players].reverse().find(x => x.bot);
        if (!b) throw new GameError('Aucun robot à retirer.');
        r.players = r.players.filter(x => x !== b);
      }
    } else if (type === 'refill') {
      const threshold = r.game === 'poker' ? 1 : 10;
      if (!BETWEEN.includes(r.phase) || p.stack >= threshold) throw new GameError('La recharge gratuite est disponible à court de jetons, entre les mains.');
      const n = r.game === 'poker' ? 2000 : 1000; p.stack += n; p.refills += n;
    } else if (type === 'bet' && r.game === 'blackjack') {
      placeBlackjackBet(r, p, amount); r.turnSeq++;
    } else if (gameplay.includes(type)) {
      if (r.game === 'poker') actPoker(r, p, type, amount);
      else actBlackjack(r, p, type);
      r.turnSeq++;
    } else throw new GameError('Action inconnue.');
    this.changed(r);
    const result = { ok: true, version: r.version };
    p.requests.set(msg.actionId, result);
    if (p.requests.size > 256) p.requests.delete(p.requests.keys().next().value);
    return result;
  }
  changed(r) {
    r.version++; r.updatedAt = Date.now();
    const key = `${r.handId}:${r.phase}:${r.turn ?? ''}`;
    if (r.timerKey !== key) {
      r.timerKey = key;
      r.deadline = r.phase === 'betting' ? Date.now() + this.betMs : r.turn ? Date.now() + this.turnMs : 0;
      r.botAt = r.turn ? Date.now() + this.botMs + randomInt(250) : 0;
    }
    // Bots that hit repeatedly need another thought delay, without extending the human turn deadline.
    if (r.turn && r.players.find(p => p.id === r.turn)?.bot && r.botAt <= Date.now()) r.botAt = Date.now() + this.botMs;
    this.onChange(r);
  }
  connect(token) {
    const { r, p } = this.auth(token);
    p.connected = true; p.disconnectedAt = null;
    if (!r.ownerId) r.ownerId = p.id;
    this.changed(r); return { r, p };
  }
  disconnect(token) {
    const found = this.tokens.get(token); if (!found) return;
    const { r, p } = found;
    p.connected = false; p.disconnectedAt = Date.now(); this.transferOwner(r); this.changed(r);
  }
  leave(token) {
    const { r, p } = this.auth(token);
    p.leaving = true; p.connected = false; p.disconnectedAt = 0;
    this.tokens.delete(token); this.transferOwner(r);
    this.cleanBetween(r); this.changed(r);
  }
  tick(now = Date.now()) {
    for (const r of this.rooms.values()) {
      if (now - r.updatedAt > this.ttlMs || !r.players.some(p => !p.bot && !p.leaving && (p.connected || now - (p.disconnectedAt ?? p.joinedAt) < this.graceMs))) {
        for (const p of r.players) this.tokens.delete(p.token);
        this.rooms.delete(r.code); continue;
      }
      let expired = false;
      for (const p of r.players) {
        if (!p.bot && !p.leaving && !p.connected && p.disconnectedAt !== null && now - p.disconnectedAt > this.graceMs) {
          p.leaving = true; this.tokens.delete(p.token); expired = true;
        }
      }
      if (expired) { this.transferOwner(r); this.changed(r); }
      try {
        const actor = r.players.find(p => p.id === r.turn);
        if (r.phase === 'betting' && r.deadline && now >= r.deadline) {
          dealBlackjack(r); r.turnSeq++; this.changed(r);
        } else if (actor && ((actor.bot && now >= r.botAt) || now >= r.deadline || actor.leaving)) {
          const action = actor.bot ? (r.game === 'poker' ? pokerBot(r, actor) : blackjackBot(r, actor)) :
            r.game === 'poker' ? { type: pokerLegal(r, actor).check ? 'check' : 'fold' } : { type: 'stand' };
          if (r.game === 'poker') actPoker(r, actor, action.type, action.amount);
          else actBlackjack(r, actor, action.type);
          r.turnSeq++; r.botAt = 0; this.changed(r);
        }
      } catch (error) {
        // Keep the process alive; mark only the affected room, never fabricate a settlement.
        console.error(`[table ${r.code}]`, error);
        r.phase = 'error'; r.turn = null; r.deadline = 0; r.logs.push('Erreur de table : crée une nouvelle partie.'); this.changed(r);
      }
    }
  }
  view(r, viewer) {
    const poker = r.game === 'poker';
    const revealDealer = r.phase === 'results';
    return {
      code: r.code, game: r.game, solo: r.solo, ownerId: r.ownerId, you: viewer.id,
      version: r.version, handId: r.handId, turnSeq: r.turnSeq, phase: r.phase,
      turn: r.turn, deadline: r.deadline, serverNow: Date.now(),
      smallBlind: r.smallBlind, bigBlind: r.bigBlind, dealerSeat: r.dealerSeat,
      smallBlindSeat: r.smallBlindSeat, bigBlindSeat: r.bigBlindSeat,
      board: r.board, dealerCards: r.dealerCards.map((c, i) => revealDealer || i === 0 ? c : null),
      dealerTotal: revealDealer && r.dealerCards.length ? blackjackValue(r.dealerCards).total : null,
      pot: r.players.reduce((n, p) => n + (poker ? p.totalBet : p.bjBet || 0), 0),
      pots: r.pots, results: r.results, logs: r.logs.slice(-14),
      players: r.players.map(p => {
        const visible = !poker || p.id === viewer.id || (r.phase === 'results' && r.showdown && !p.folded);
        return {
          id: p.id, name: p.name, seat: p.seat, bot: p.bot, connected: p.connected, leaving: p.leaving,
          stack: p.stack, refills: p.refills, inHand: p.inHand, folded: p.folded, allIn: p.allIn,
          cards: p.cards.map(c => visible ? c : null), streetBet: p.streetBet, totalBet: p.totalBet,
          bjBet: p.bjBet, betReady: p.betReady, lastAction: p.lastAction, result: p.result,
          payout: p.payout, bjTotal: !poker && p.cards.length ? blackjackValue(p.cards).total : null
        };
      }),
      legal: poker ? pokerLegal(r, viewer) : blackjackLegal(r, viewer),
      yourCombination: poker && viewer.cards.length === 2 && r.board.length >= 3 ? evaluate([...viewer.cards, ...r.board]).name : null
    };
  }
}
