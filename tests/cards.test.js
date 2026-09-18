import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, evaluate, rankFive, compareRanks, blackjackValue } from '../server/cards.js';
export const cards = text => text.trim().split(/\s+/).map((v, i) => ({ id: `test-${v}-${i}`, rank: ({ T: 10, J: 11, Q: 12, K: 13, A: 14 })[v[0]] ?? Number(v[0]), suit: v[1] }));

test('52 cartes distinctes, aucun joker', () => {
  const deck = makeDeck(); assert.equal(deck.length, 52); assert.equal(new Set(deck.map(c => c.id)).size, 52);
  assert.equal(new Set(deck.map(c => c.rank)).size, 13);
});
test('Sabot : 312 identifiants physiques distincts', () => {
  const deck = makeDeck(6); assert.equal(deck.length, 312); assert.equal(new Set(deck.map(c => c.id)).size, 312);
});
const cases = [
  ['As Ks Qs Js Ts 2h 3d', 8, 14, 'Quinte flush royale'],
  ['9h 8h 7h 6h 5h As Ad', 8, 9, 'Quinte flush'],
  ['Ah Ad Ac As Kh 2s 3s', 7, 14, 'Carré'],
  ['Ah Ad Ac Ks Kh Kd 2s', 6, 14, 'Full'],
  ['Ah Jh 9h 7h 3h 2s Kd', 5, 14, 'Couleur'],
  ['Ah 2d 3c 4s 5d Kh Ks', 4, 5, 'Quinte'],
  ['Ah Ad Ac Ks Qh 2s 3s', 3, 14, 'Brelan'],
  ['Ah Ad Ks Kd Qh Qs 3s', 2, 14, 'Double paire'],
  ['Kh Kd As Jh 9d 6s 2c', 1, 13, 'Paire'],
  ['Ah Kd 9s 7h 5d 3c 2s', 0, 14, 'Carte haute']
];
for (const [text, category, high, name] of cases) test(`Évaluation : ${name} (${text})`, () => {
  const hand = evaluate(cards(text)); assert.equal(hand.rank[0], category); assert.equal(hand.rank[1], high); assert.equal(hand.name, name); assert.equal(hand.cards.length, 5);
});
test('Départage par kickers', () => assert.ok(compareRanks(evaluate(cards('As Ad Kh Qc Js')).rank, evaluate(cards('Ah Ac Kd Qh Ts')).rank) > 0));
test('Une quinte 6 haute bat la roue A–5', () => assert.ok(compareRanks(evaluate(cards('2s 3d 4h 5c 6s')).rank, evaluate(cards('As 2d 3h 4c 5s')).rank) > 0));
test('La meilleure main peut être les cinq cartes communes', () => {
  const a = evaluate(cards('Ah Kh Qh Jh Th 2s 3s')), b = evaluate(cards('Ah Kh Qh Jh Th 9c 9d'));
  assert.equal(compareRanks(a.rank, b.rank), 0);
});
test('Couleur départagée sur la cinquième carte', () => assert.ok(compareRanks(evaluate(cards('As Js 9s 7s 4s')).rank, evaluate(cards('Ah Jh 9h 7h 3h')).rank) > 0));
test('Plusieurs As au blackjack', () => {
  assert.deepEqual(blackjackValue(cards('As Ah 9d')), { total: 21, soft: true, blackjack: false, bust: false });
  assert.equal(blackjackValue(cards('As Ah Ac 9d')).total, 12);
  assert.equal(blackjackValue(cards('As 6h')).soft, true);
  assert.equal(blackjackValue(cards('As 6h Td')).soft, false);
});
test('Blackjack naturel et dépassement', () => {
  assert.equal(blackjackValue(cards('As Kh')).blackjack, true);
  assert.equal(blackjackValue(cards('7s 7h 7d')).blackjack, false);
  assert.equal(blackjackValue(cards('Ks Qh 2d')).bust, true);
});
test('L’évaluateur refuse les tailles invalides', () => { assert.throws(() => evaluate(cards('As Kh'))); assert.throws(() => rankFive(cards('As Kh'))); });
