import test from 'node:test';
import assert from 'node:assert/strict';
import { startBlackjack, dealBlackjack, actBlackjack, settleBlackjack, placeBlackjackBet, blackjackLegal } from '../server/blackjack.js';
import { setup, cards } from './helpers.js';

function arranged(player, dealer, tail = '') {
  const { room: r, players: [p] } = setup('blackjack', 1); startBlackjack(r);
  p.stack -= 100; p.bjBet = 100; p.totalBet = 100; p.betReady = true;
  const hand = cards(player), house = cards(dealer);
  const sequence = [hand[0], house[0], hand[1], house[1], ...tail.split(' ').filter(Boolean).flatMap(cards)];
  dealBlackjack(r, sequence.reverse());
  return { r, p };
}
test('Victoire ordinaire : 1000 → 1100', () => { const { r, p } = arranged('Ks Qh', 'Td 7h'); actBlackjack(r, p, 'stand'); assert.equal(p.stack, 1100); });
test('Blackjack naturel : 1000 → 1150', () => { const { r, p } = arranged('As Kh', 'Td 7h'); assert.equal(r.phase, 'results'); assert.equal(p.stack, 1150); });
test('Égalité : 1000 → 1000', () => { const { r, p } = arranged('Ts 7h', 'Td 7c'); actBlackjack(r, p, 'stand'); assert.equal(p.stack, 1000); });
test('Défaite : 1000 → 900', () => { const { r, p } = arranged('Ts 7h', 'Td 9c'); actBlackjack(r, p, 'stand'); assert.equal(p.stack, 900); });
test('Deux blackjacks : égalité immédiate', () => { const { r, p } = arranged('As Kh', 'Ad Tc'); assert.equal(r.phase, 'results'); assert.equal(p.stack, 1000); });
test('Le blackjack du croupier termine la main avant une action', () => { const { r, p } = arranged('Ts 9h', 'Ad Tc'); assert.equal(r.phase, 'results'); assert.equal(p.stack, 900); assert.throws(() => actBlackjack(r, p, 'hit')); });
test('Le croupier reste sur soft 17', () => { const { r, p } = arranged('Ts 8h', 'Ad 6c', '9s'); actBlackjack(r, p, 'stand'); assert.equal(r.dealerCards.length, 2); assert.equal(p.stack, 1100); });
test('Le croupier tire sous 17 puis s’arrête', () => { const { r, p } = arranged('Ts 8h', 'Td 6c', 'As'); actBlackjack(r, p, 'stand'); assert.equal(r.dealerCards.length, 3); assert.equal(p.stack, 1100); });
test('Croupier dépasse : joueur non dépassé gagne', () => { const { r, p } = arranged('Ts 8h', 'Td 6c', 'Ks'); actBlackjack(r, p, 'stand'); assert.equal(p.stack, 1100); });
test('Un joueur dépassé perd même face à un croupier dépassé', () => {
  const { room: r, players: [p] } = setup('blackjack', 1); startBlackjack(r);
  Object.assign(p, { stack: 900, bjBet: 100, cards: cards('Ts Kh 5c') }); r.dealerCards = cards('Td Qs 4c'); r.phase = 'playing';
  settleBlackjack(r); assert.equal(p.stack, 900);
});
test('Double : une seule carte et mise doublée exactement une fois', () => {
  const { r, p } = arranged('5s 6h', 'Td 7c', 'Ks'); assert.equal(blackjackLegal(r, p).double, true);
  actBlackjack(r, p, 'double'); assert.equal(p.cards.length, 3); assert.equal(p.bjBet, 200); assert.equal(p.stack, 1200); assert.equal(r.phase, 'results');
  assert.throws(() => actBlackjack(r, p, 'double')); settleBlackjack(r); assert.equal(p.stack, 1200);
});
test('Double interdit après avoir tiré ou sans fonds suffisants', () => {
  const { r, p } = arranged('2s 3h', 'Td 7c', '4s'); actBlackjack(r, p, 'hit'); assert.equal(blackjackLegal(r, p).double, false); assert.throws(() => actBlackjack(r, p, 'double'));
  p.cards = cards('5s 6h'); p.stack = 50; assert.equal(blackjackLegal(r, p).double, false);
});
test('Mises validées, pas de solde négatif ni double débit', () => {
  const { room: r, players: [p] } = setup('blackjack', 2); startBlackjack(r);
  for (const amount of [-10, 25, 201, 300, NaN, Infinity, '100']) assert.throws(() => placeBlackjackBet(r, p, amount));
  placeBlackjackBet(r, p, 100); assert.equal(p.stack, 900); assert.throws(() => placeBlackjackBet(r, p, 100)); assert.equal(p.stack, 900);
});
test('Aucun pari : retour au salon, pas de boucle de mains vides', () => {
  const { room: r, players: [p] } = setup('blackjack', 1); startBlackjack(r); placeBlackjackBet(r, p, 0); assert.equal(r.phase, 'lobby'); assert.equal(p.stack, 1000);
});
test('Vue publique : carte et total cachés du croupier absents', () => {
  const { manager, room: r, players: [p] } = setup('blackjack', 1); startBlackjack(r);
  p.bjBet = 100; p.betReady = true; p.stack -= 100;
  dealBlackjack(r, cards('5s Td 6h 7c Ks').reverse());
  const view = manager.view(r, p); assert.equal(view.dealerCards[1], null); assert.equal(view.dealerTotal, null); assert.equal(view.deck, undefined);
  assert.ok(!JSON.stringify(view).includes(r.dealerCards[1].id));
});
test('800 mains aléatoires : gains cohérents et aucun solde négatif', () => {
  for (let i = 0; i < 800; i++) {
    const { room: r, players: [p] } = setup('blackjack', 1); startBlackjack(r); placeBlackjackBet(r, p, 100);
    let rounds = 0;
    while (r.phase !== 'results') {
      assert.ok(++rounds < 30);
      const legal = blackjackLegal(r, p);
      actBlackjack(r, p, legal.double && i % 3 === 0 ? 'double' : p.cards.reduce((n, c) => n + Math.min(c.rank === 14 ? 1 : c.rank, 10), 0) < 16 ? 'hit' : 'stand');
    }
    assert.ok([800, 900, 1000, 1100, 1150, 1200].includes(p.stack), `Solde inattendu ${p.stack}`);
  }
});
