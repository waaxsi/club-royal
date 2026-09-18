import { makeDeck, evaluate, compareRanks } from './cards.js';

const live = r => r.players.filter(p => p.inHand && !p.folded);
const able = r => live(r).filter(p => p.stack > 0);
const ordered = ps => [...ps].sort((a, b) => a.seat - b.seat);
function next(ps, seat) {
  const list = ordered(ps);
  return list.find(p => p.seat > seat) ?? list[0];
}
function take(r) { const c = r.deck.pop(); if (!c) throw new Error('Paquet épuisé.'); return c; }
function pay(p, n) { n = Math.min(p.stack, n); p.stack -= n; p.streetBet += n; p.totalBet += n; p.allIn = p.stack === 0; return n; }
function note(r, text) { r.logs.push(text); r.logs = r.logs.slice(-30); }

export function startPoker(r, deck = makeDeck()) {
  const players = r.players.filter(p => !p.leaving && (p.connected || p.bot) && p.stack > 0);
  if (players.length < 2) throw new Error('Il faut au moins deux joueurs avec des jetons. Ajoute un robot.');
  r.handId++; r.phase = 'preflop'; r.deck = deck; r.board = []; r.results = []; r.pots = []; r.showdown = false;
  r.currentBet = r.bigBlind; r.lastFullRaise = r.bigBlind;
  for (const p of r.players) Object.assign(p, {
    inHand: players.includes(p), cards: [], folded: false, allIn: false,
    streetBet: 0, totalBet: 0, actedAtBet: null, payout: 0, result: '', lastAction: ''
  });
  let dealer = next(players, r.dealerSeat ?? -1);
  // When a table becomes heads-up, don't charge the same surviving player the big blind twice.
  if (players.length === 2 && next(players, dealer.seat).seat === r.bigBlindSeat) dealer = next(players, dealer.seat);
  r.dealerSeat = dealer.seat;
  const sb = players.length === 2 ? dealer : next(players, dealer.seat);
  const bb = next(players, sb.seat); r.smallBlindSeat = sb.seat; r.bigBlindSeat = bb.seat;
  const dealOrder = ordered(players).sort((a, b) => ((a.seat - dealer.seat + 5) % 6) - ((b.seat - dealer.seat + 5) % 6));
  for (let i = 0; i < 2; i++) for (const p of dealOrder) p.cards.push(take(r));
  pay(sb, r.smallBlind); sb.lastAction = 'Petite blinde';
  pay(bb, r.bigBlind); bb.lastAction = 'Grosse blinde';
  r.pending = new Set(able(r).map(p => p.id));
  note(r, `Main #${r.handId} · blindes ${r.smallBlind}/${r.bigBlind}`);
  advancePoker(r, bb.seat);
}

export function pokerLegal(r, p) {
  if (!p || r.turn !== p.id || !['preflop', 'flop', 'turn', 'river'].includes(r.phase)) return null;
  const owed = Math.max(0, r.currentBet - p.streetBet);
  const reopened = p.actedAtBet === null || r.currentBet - p.actedAtBet >= r.lastFullRaise;
  const canRaise = able(r).some(x => x.id !== p.id) && reopened && p.stack > owed;
  return {
    check: owed === 0, call: Math.min(owed, p.stack), owed, fold: true,
    minRaise: r.currentBet + r.lastFullRaise,
    maxRaise: p.streetBet + p.stack,
    raise: canRaise,
    allIn: p.stack <= owed || canRaise,
    currentBet: r.currentBet
  };
}

export function actPoker(r, p, type, amount) {
  const legal = pokerLegal(r, p);
  if (!legal) throw new Error("Ce n’est pas ton tour.");
  if (type === 'allin') {
    if (!legal.allIn) throw new Error('La relance n’est pas rouverte.');
    if (p.stack <= legal.owed) type = 'call';
    else { type = 'raise'; amount = legal.maxRaise; }
  }
  if (type === 'fold') { p.folded = true; p.lastAction = 'Couché'; }
  else if (type === 'check') {
    if (!legal.check) throw new Error('Tu dois suivre ou te coucher.');
    p.lastAction = 'Parole';
  } else if (type === 'call') {
    if (!legal.owed) throw new Error('Aucune mise à suivre.');
    const paid = pay(p, legal.owed); p.lastAction = p.allIn ? `Tapis · ${paid}` : `Suit · ${paid}`;
  } else if (type === 'raise') {
    if (!legal.raise || !Number.isSafeInteger(amount) || amount <= r.currentBet || amount > legal.maxRaise) throw new Error('Relance invalide.');
    if (amount < legal.minRaise && amount !== legal.maxRaise) throw new Error(`Relance minimum : ${legal.minRaise}.`);
    const increase = amount - r.currentBet;
    pay(p, amount - p.streetBet);
    r.currentBet = amount;
    if (increase >= r.lastFullRaise) {
      r.lastFullRaise = increase;
      r.pending = new Set(able(r).filter(x => x.id !== p.id).map(x => x.id));
    } else {
      for (const x of able(r)) if (x.id !== p.id && x.streetBet < r.currentBet) r.pending.add(x.id);
    }
    p.lastAction = p.allIn ? `Tapis · ${amount}` : `Relance à ${amount}`;
  } else throw new Error('Action inconnue.');
  p.actedAtBet = r.currentBet;
  r.pending.delete(p.id);
  note(r, `${p.name} · ${p.lastAction}`);
  advancePoker(r, p.seat);
}

function dealStreet(r) {
  take(r); // Burn card. Never sent to clients.
  if (r.phase === 'preflop') { r.board.push(take(r), take(r), take(r)); r.phase = 'flop'; }
  else if (r.phase === 'flop') { r.board.push(take(r)); r.phase = 'turn'; }
  else { r.board.push(take(r)); r.phase = 'river'; }
  for (const p of r.players) { p.streetBet = 0; p.actedAtBet = null; }
  r.currentBet = 0; r.lastFullRaise = r.bigBlind;
  r.pending = new Set(able(r).map(p => p.id));
  note(r, ({ flop: 'Flop · trois cartes communes', turn: 'Turn · quatrième carte', river: 'River · dernière carte' })[r.phase]);
}

export function advancePoker(r, afterSeat) {
  if (live(r).length === 1) { settlePoker(r, false); return; }
  const actors = able(r);
  for (const id of [...r.pending]) if (!actors.some(p => p.id === id)) r.pending.delete(id);
  // No betting into a dry side pot: the last player may only match an outstanding bet.
  if (actors.length === 1 && actors[0].streetBet >= r.currentBet) r.pending.clear();
  if (!actors.length) r.pending.clear();
  if (r.pending.size) { r.turn = next(actors.filter(p => r.pending.has(p.id)), afterSeat).id; return; }
  if (r.phase === 'river') { settlePoker(r, true); return; }
  dealStreet(r);
  advancePoker(r, r.dealerSeat);
}

/** Build and settle each contribution level separately, including unmatched returns. */
export function settlePoker(r, showdown = true) {
  if (r.phase === 'results') return;
  const alive = live(r);
  const participants = r.players.filter(p => p.inHand);
  const total = participants.reduce((n, p) => n + p.totalBet, 0);
  r.pots = [];
  if (!showdown && alive.length === 1) {
    alive[0].payout = total;
    r.pots.push({ amount: total, winners: [alive[0].id], label: 'Sans opposition' });
  } else {
    const ranks = new Map(alive.map(p => [p.id, evaluate([...p.cards, ...r.board])]));
    for (const p of alive) p.result = ranks.get(p.id).name;
    let previous = 0;
    for (const level of [...new Set(participants.map(p => p.totalBet).filter(Boolean))].sort((a, b) => a - b)) {
      const contributing = participants.filter(p => p.totalBet >= level);
      const amount = (level - previous) * contributing.length; previous = level;
      if (contributing.length === 1) {
        contributing[0].payout += amount;
        r.pots.push({ amount, winners: [contributing[0].id], label: 'Mise non suivie rendue' });
        continue;
      }
      const eligible = contributing.filter(p => !p.folded);
      if (!eligible.length) throw new Error('Pot sans joueur éligible.');
      const best = eligible.reduce((a, b) => compareRanks(ranks.get(a.id).rank, ranks.get(b.id).rank) >= 0 ? a : b);
      const winners = eligible.filter(p => compareRanks(ranks.get(p.id).rank, ranks.get(best.id).rank) === 0);
      winners.sort((a, b) => ((a.seat - r.dealerSeat + 5) % 6) - ((b.seat - r.dealerSeat + 5) % 6));
      const share = Math.floor(amount / winners.length), odd = amount % winners.length;
      winners.forEach((p, i) => { p.payout += share + (i < odd ? 1 : 0); });
      r.pots.push({ amount, winners: winners.map(p => p.id), label: r.pots.length ? 'Pot secondaire' : 'Pot principal' });
    }
  }
  for (const p of participants) {
    p.stack += p.payout;
    if (p.folded) p.result = 'Couché';
    else if (!showdown) p.result = 'Sans opposition';
  }
  r.results = participants.map(p => ({ id: p.id, name: p.name, payout: p.payout, net: p.payout - p.totalBet, label: p.result }));
  r.phase = 'results'; r.showdown = showdown; r.turn = null; r.deadline = 0;
  note(r, r.results.filter(p => p.payout).map(p => `${p.name} reçoit ${p.payout}`).join(' · '));
}

/** Deliberately modest practice bot. Only its own hand and the public board are used. */
export function pokerBot(r, p, random = Math.random) {
  const l = pokerLegal(r, p);
  const own = p.cards;
  let strength = own[0].rank === own[1].rank ? 0.76 : (own[0].rank + own[1].rank) / 42;
  if (r.board.length >= 3) strength = Math.min(0.96, 0.22 + evaluate([...own, ...r.board]).rank[0] * 0.14);
  const roll = random();
  if (l.raise && l.maxRaise >= l.minRaise && (roll < strength * 0.18)) {
    return { type: 'raise', amount: Math.min(l.maxRaise, l.minRaise + r.bigBlind * (strength > 0.7 ? 2 : 0)) };
  }
  if (l.check) return { type: 'check' };
  if (l.owed > Math.max(r.bigBlind * 3, p.stack * 0.25) && roll > strength) return { type: 'fold' };
  return { type: 'call' };
}
