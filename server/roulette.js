import { randomInt } from 'node:crypto';
export const WHEEL = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
export const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const rouletteColor = n => n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
export function validateRouletteBets(bets, available) {
  if (!Array.isArray(bets) || bets.length > 25) throw new Error('Choisis au maximum 25 mises.');
  const out = [], seen = new Set(); let total = 0;
  for (const b of bets) {
    if (!b || typeof b !== 'object' || !Number.isSafeInteger(b.amount) || b.amount < 100 || b.amount > 20000 || b.amount % 100) throw new Error('Chaque mise doit être de 1 à 200 € fictifs, par euros entiers.');
    const type = b.type, selection = b.selection ?? null;
    if (type === 'straight') { if (!Number.isInteger(selection) || selection < 0 || selection > 36) throw new Error('Numéro invalide.'); }
    else if (['dozen', 'column'].includes(type)) { if (![1,2,3].includes(selection)) throw new Error('Groupe invalide.'); }
    else if (!['red','black','even','odd','low','high'].includes(type) || selection !== null) throw new Error('Mise inconnue.');
    const key = `${type}:${selection}`; if (seen.has(key)) throw new Error('Regroupe les mises identiques.'); seen.add(key);
    total += b.amount; out.push({ type, selection, amount: b.amount });
  }
  if (total > 20000 || total > available) throw new Error('Le total doit rester sous 200 € fictifs et sous ton tapis.');
  return { bets: out, total };
}
export function rouletteReturn(bet, n) {
  let hit = false, multiplier = 2;
  if (bet.type === 'straight') { hit = n === bet.selection; multiplier = 36; }
  else if (n !== 0) {
    if (bet.type === 'red') hit = RED.has(n);
    else if (bet.type === 'black') hit = !RED.has(n);
    else if (bet.type === 'even') hit = n % 2 === 0;
    else if (bet.type === 'odd') hit = n % 2 === 1;
    else if (bet.type === 'low') hit = n <= 18;
    else if (bet.type === 'high') hit = n >= 19;
    else if (bet.type === 'dozen') { hit = Math.ceil(n / 12) === bet.selection; multiplier = 3; }
    else if (bet.type === 'column') { hit = (n - 1) % 3 + 1 === bet.selection; multiplier = 3; }
  }
  return hit ? bet.amount * multiplier : 0;
}
export function startRoulette(r) {
  const ps = r.players.filter(p => !p.leaving && (p.connected || p.bot) && p.stack >= 100);
  if (!ps.length) throw new Error('Il faut au moins 1 € fictif à table.');
  r.handId++; r.phase = 'betting'; r.turn = null; r.results = []; r.winningNumber = null; r.spinStartedAt = 0; r.spinEndsAt = 0;
  for (const p of r.players) Object.assign(p, { inHand: ps.includes(p), rouletteBets: [], betReady: false, totalBet: 0, streetBet: 0, bjBet: 0, cards: [], payout: 0, result: '', folded: false, lastAction: '' });
}
export function betRoulette(r, p, bets, now = Date.now()) {
  if (r.phase !== 'betting' || !p.inHand || p.betReady) throw new Error('Les mises sont fermées.');
  const checked = validateRouletteBets(bets, p.stack);
  p.stack -= checked.total; p.totalBet = checked.total; p.rouletteBets = checked.bets; p.betReady = true;
  p.lastAction = checked.total ? 'Mise confirmée' : 'Passe ce tour';
  if (r.players.filter(x => x.inHand).every(x => x.betReady)) spinRoulette(r, now);
}
export function spinRoulette(r, now = Date.now()) {
  if (r.phase !== 'betting') return;
  for (const p of r.players) if (p.inHand) p.betReady = true;
  if (!r.players.some(p => p.inHand && p.totalBet > 0)) { r.phase = 'lobby'; return; }
  r.phase = 'spinning'; r.turn = null;
  r.winningNumber = randomInt(37); // Secret until spinEndsAt; excluded from public state.
  r.spinStartedAt = now; r.spinEndsAt = now + (r.spinMs ?? 4800);
}
export function settleRoulette(r) {
  if (r.phase !== 'spinning') return;
  const n = r.winningNumber;
  for (const p of r.players.filter(p => p.inHand && p.totalBet)) {
    p.payout = p.rouletteBets.reduce((sum, bet) => sum + rouletteReturn(bet, n), 0);
    p.stack += p.payout; p.result = `${n} · ${rouletteColor(n) === 'red' ? 'Rouge' : n === 0 ? 'Zéro' : 'Noir'}`;
  }
  r.results = r.players.filter(p => p.inHand && p.totalBet).map(p => ({ id: p.id, name: p.name, payout: p.payout, net: p.payout - p.totalBet, label: p.result }));
  r.rouletteHistory = [n, ...(r.rouletteHistory || [])].slice(0,12);
  r.phase = 'results'; r.turn = null; r.deadline = 0;
}
