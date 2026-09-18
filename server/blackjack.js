import { makeDeck, blackjackValue } from './cards.js';

function take(r) { const c = r.deck.pop(); if (!c) throw new Error('Sabot épuisé.'); return c; }
const participants = r => r.players.filter(p => p.inHand && p.bjBet > 0);

export function startBlackjack(r) {
  const available = r.players.filter(p => !p.leaving && (p.connected || p.bot) && p.stack >= 10);
  if (!available.length) throw new Error('Recharge tes jetons pour jouer.');
  r.handId++; r.phase = 'betting'; r.turn = null; r.dealerCards = []; r.results = []; r.deck = [];
  for (const p of r.players) Object.assign(p, {
    inHand: available.includes(p), cards: [], bjBet: 0, betReady: false, bjDone: false,
    payout: 0, result: '', lastAction: '', totalBet: 0, streetBet: 0, folded: false, allIn: false
  });
  r.logs.push(`Main #${r.handId} · les mises sont ouvertes`); r.logs = r.logs.slice(-30);
}

export function placeBlackjackBet(r, p, amount) {
  if (r.phase !== 'betting' || !p.inHand || p.betReady) throw new Error('Cette mise est déjà fermée.');
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 200 || amount % 10 !== 0 || (amount > 0 && amount < 10) || amount > p.stack) throw new Error('Mise : 10 à 200 jetons, par pas de 10, selon ton solde.');
  p.stack -= amount; p.bjBet = amount; p.totalBet = amount; p.betReady = true;
  p.lastAction = amount ? `Mise · ${amount}` : 'Passe cette main';
  if (r.players.filter(p => p.inHand).every(p => p.betReady)) dealBlackjack(r);
}

export function dealBlackjack(r, deck = makeDeck(6)) {
  if (r.phase !== 'betting') return;
  for (const p of r.players) if (p.inHand && !p.betReady) { p.betReady = true; p.lastAction = 'Passe cette main'; }
  const ps = participants(r);
  if (!ps.length) { r.phase = 'lobby'; r.turn = null; return; }
  r.deck = deck; r.phase = 'playing'; r.dealerCards = [];
  for (let i = 0; i < 2; i++) {
    for (const p of ps) p.cards.push(take(r));
    r.dealerCards.push(take(r));
  }
  for (const p of ps) if (blackjackValue(p.cards).blackjack) { p.bjDone = true; p.lastAction = 'Blackjack !'; }
  if (blackjackValue(r.dealerCards).blackjack) settleBlackjack(r);
  else advanceBlackjack(r);
}

export function blackjackLegal(r, p) {
  if (!p || r.phase !== 'playing' || r.turn !== p.id || p.bjDone) return null;
  return { hit: true, stand: true, double: p.cards.length === 2 && p.stack >= p.bjBet };
}

export function actBlackjack(r, p, type) {
  const l = blackjackLegal(r, p);
  if (!l) throw new Error("Ce n’est pas ton tour.");
  if (type === 'stand') { p.bjDone = true; p.lastAction = 'Reste'; }
  else if (type === 'hit' || type === 'double') {
    if (type === 'double') {
      if (!l.double) throw new Error('Impossible de doubler cette main.');
      p.stack -= p.bjBet; p.bjBet *= 2; p.totalBet = p.bjBet; p.bjDone = true;
    }
    p.cards.push(take(r));
    const v = blackjackValue(p.cards);
    if (v.total >= 21) p.bjDone = true;
    p.lastAction = v.bust ? 'Dépasse 21' : type === 'double' ? 'Double' : 'Tire';
  } else throw new Error('Action inconnue.');
  r.logs.push(`${p.name} · ${p.lastAction}`); r.logs = r.logs.slice(-30);
  advanceBlackjack(r);
}

function advanceBlackjack(r) {
  const next = participants(r).find(p => !p.bjDone);
  if (next) { r.turn = next.id; return; }
  // No need to draw if every hand already busted or has a natural blackjack.
  if (participants(r).some(p => { const v = blackjackValue(p.cards); return !v.bust && !v.blackjack; })) {
    while (blackjackValue(r.dealerCards).total < 17) r.dealerCards.push(take(r));
  }
  settleBlackjack(r);
}

export function settleBlackjack(r) {
  if (r.phase === 'results') return;
  const dealer = blackjackValue(r.dealerCards);
  for (const p of participants(r)) {
    const v = blackjackValue(p.cards);
    let multiplier = 0;
    if (v.bust) p.result = 'Dépasse 21';
    else if (dealer.blackjack) {
      multiplier = v.blackjack ? 1 : 0; p.result = v.blackjack ? 'Égalité' : 'Blackjack du croupier';
    } else if (v.blackjack) { multiplier = 2.5; p.result = 'Blackjack · 3:2'; }
    else if (dealer.bust || v.total > dealer.total) { multiplier = 2; p.result = 'Gagné'; }
    else if (v.total === dealer.total) { multiplier = 1; p.result = 'Égalité'; }
    else p.result = 'Croupier gagnant';
    p.payout = p.bjBet * multiplier; p.stack += p.payout;
  }
  r.results = participants(r).map(p => ({ id: p.id, name: p.name, payout: p.payout, net: p.payout - p.bjBet, label: p.result }));
  r.phase = 'results'; r.turn = null; r.deadline = 0;
}

export function blackjackBot(r, p) {
  const v = blackjackValue(p.cards), l = blackjackLegal(r, p);
  if (l.double && (v.total === 10 || v.total === 11)) return { type: 'double' };
  return { type: v.total < 17 ? 'hit' : 'stand' };
}
