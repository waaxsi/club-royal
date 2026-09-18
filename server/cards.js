import { randomInt } from 'node:crypto';

export const HAND_NAMES = ['Carte haute', 'Paire', 'Double paire', 'Brelan', 'Quinte', 'Couleur', 'Full', 'Carré', 'Quinte flush'];

/** Fresh cryptographically shuffled deck/shoe. Inject cards in unit tests, never over the API. */
export function makeDeck(decks = 1) {
  const cards = [];
  for (let d = 0; d < decks; d++) for (const suit of ['s', 'h', 'd', 'c']) {
    for (let rank = 2; rank <= 14; rank++) cards.push({ id: `${d}-${suit}-${rank}`, rank, suit });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function compareRanks(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

export function rankFive(cards) {
  if (cards.length !== 5) throw new Error('Cinq cartes requises.');
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const count = new Map();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  const groups = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(c => c.suit === cards[0].suit);
  const unique = [...count.keys()].sort((a, b) => b - a);
  let straight = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) straight = unique[0];
    else if (unique.join(',') === '14,5,4,3,2') straight = 5;
  }
  if (flush && straight) return [8, straight];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map(x => x[0])];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...groups.map(x => x[0])];
  if (groups[0][1] === 2) return [1, ...groups.map(x => x[0])];
  return [0, ...ranks];
}

/** Enumerates at most 21 combinations; correctness over clever ranking shortcuts. */
export function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7) throw new Error('Entre cinq et sept cartes requises.');
  let best = null, winning = [];
  const walk = (start, picked) => {
    if (picked.length === 5) {
      const rank = rankFive(picked);
      if (!best || compareRanks(rank, best) > 0) { best = rank; winning = picked; }
      return;
    }
    for (let i = start; i <= cards.length - (5 - picked.length); i++) walk(i + 1, [...picked, cards[i]]);
  };
  walk(0, []);
  return { rank: best, name: best[0] === 8 && best[1] === 14 ? 'Quinte flush royale' : HAND_NAMES[best[0]], cards: winning };
}

export function blackjackValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 14) { total += 11; aces++; }
    else total += Math.min(c.rank, 10);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0, blackjack: cards.length === 2 && total === 21, bust: total > 21 };
}
