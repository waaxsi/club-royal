import { makeDeck } from './cards.js';

/** Publicly disclosed PARTY variant. Only starting hands are scored, never the board,
 * player identity, bank balance, previous losses or a preselected winner. */
export function startingStrength(a, b) {
  const high = Math.max(a.rank, b.rank), low = Math.min(a.rank, b.rank);
  return (high + low) / 2 + (high === low ? 15 + high / 4 : 0)
    + (a.suit === b.suit ? 3 : 0) + (high - low === 1 ? 2 : 0) + (low >= 10 ? 4 : 0);
}
export function startingDistributionScore(deck, count) {
  const n = deck.length, values = [];
  for (let i = 0; i < count; i++) values.push(startingStrength(deck[n - 1 - i], deck[n - 1 - count - i]));
  // Reward the weakest starting hand as well as the table average.
  return 2 * Math.min(...values) + values.reduce((a, b) => a + b, 0) / count;
}
export function favoredDeck(count, factory = makeDeck) {
  if (!Number.isInteger(count) || count < 2 || count > 6) throw new Error('Nombre de joueurs invalide.');
  let best = null, score = -Infinity;
  for (let i = 0; i < 24; i++) {
    const candidate = factory(), next = startingDistributionScore(candidate, count);
    if (next > score) { best = candidate; score = next; }
  }
  return best;
}
