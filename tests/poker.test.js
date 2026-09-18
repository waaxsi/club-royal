import test from 'node:test';
import assert from 'node:assert/strict';
import { startPoker, actPoker, pokerLegal, settlePoker, pokerBot } from '../server/poker.js';
import { cards, setup, passiveRound } from './helpers.js';

test('Duel : bouton = petite blinde, agit en premier préflop', () => {
  const { room: r, players: [a, b] } = setup('poker', 2); startPoker(r);
  assert.equal(r.dealerSeat, a.seat); assert.equal(r.smallBlindSeat, a.seat); assert.equal(r.bigBlindSeat, b.seat); assert.equal(r.turn, a.id);
  assert.equal(a.stack, 1990); assert.equal(b.stack, 1980);
  actPoker(r, a, 'call'); assert.equal(r.turn, b.id); assert.equal(pokerLegal(r, b).check, true);
  actPoker(r, b, 'check'); assert.equal(r.phase, 'flop'); assert.equal(r.turn, b.id);
});
test('À trois : grosse blinde garde son option', () => {
  const { room: r, players: [a, b, c] } = setup(); startPoker(r);
  actPoker(r, a, 'call'); actPoker(r, b, 'call'); assert.equal(r.turn, c.id);
  actPoker(r, c, 'check'); assert.equal(r.phase, 'flop'); assert.equal(r.turn, b.id);
});
test('Coucher collectif : attribution unique et cartes cachées', () => {
  const { manager, room: r, players: [a, b] } = setup('poker', 2); startPoker(r); actPoker(r, a, 'fold');
  assert.equal(r.phase, 'results'); assert.equal(b.stack, 2010); assert.equal(a.stack, 1990); assert.equal(r.showdown, false);
  assert.deepEqual(manager.view(r, a).players.find(p => p.id === b.id).cards, [null, null]);
  const before = b.stack; settlePoker(r); assert.equal(b.stack, before);
});
test('Une main complète a cinq communes et conserve les jetons', () => {
  const { room: r } = setup(); startPoker(r); passiveRound(r);
  assert.equal(r.board.length, 5); assert.equal(r.players.reduce((a, p) => a + p.stack, 0), 6000);
  assert.equal(new Set([...r.board, ...r.players.flatMap(p => p.cards)].map(c => c.id)).size, 11);
});
test('Rotation du bouton entre les mains', () => {
  const { room: r } = setup(); startPoker(r); const first = r.dealerSeat; passiveRound(r); startPoker(r); assert.notEqual(r.dealerSeat, first);
});
test('Relance minimum et interdiction de parole face à une mise', () => {
  const { room: r, players: [a] } = setup(); startPoker(r);
  assert.equal(pokerLegal(r, a).minRaise, 40); assert.throws(() => actPoker(r, a, 'raise', 39));
  assert.throws(() => actPoker(r, a, 'check')); assert.throws(() => actPoker(r, a, 'raise', NaN));
  actPoker(r, a, 'raise', 60); assert.equal(r.currentBet, 60); assert.equal(r.lastFullRaise, 40);
});
test('Action hors tour refusée sans débiter', () => {
  const { room: r, players: [a, b] } = setup(); startPoker(r); const before = b.stack;
  assert.throws(() => actPoker(r, b, 'call')); assert.equal(b.stack, before); assert.equal(r.turn, a.id);
});
test('Tapis court ne rouvre pas une relance déjà jouée', () => {
  const { room: r, players: [a, b, c] } = setup(); startPoker(r);
  a.stack = 900; a.streetBet = 100; a.totalBet = 100; a.actedAtBet = 100;
  b.stack = 50; b.streetBet = 100; b.totalBet = 100; b.actedAtBet = null;
  c.stack = 900; c.streetBet = 100; c.totalBet = 100; c.actedAtBet = null;
  r.currentBet = 100; r.lastFullRaise = 100; r.pending = new Set([b.id, c.id]); r.turn = b.id;
  actPoker(r, b, 'allin'); assert.equal(r.currentBet, 150); assert.equal(r.lastFullRaise, 100);
  actPoker(r, c, 'call'); assert.equal(r.turn, a.id); assert.equal(pokerLegal(r, a).raise, false); assert.equal(pokerLegal(r, a).call, 50);
  assert.throws(() => actPoker(r, a, 'raise', 300));
  actPoker(r, a, 'call'); assert.equal(r.phase, 'flop');
});
test('Plusieurs tapis courts peuvent rouvrir cumulativement', () => {
  const { room: r, players: [a, b, c, d] } = setup('poker', 4); startPoker(r);
  for (const p of r.players) Object.assign(p, { streetBet: 100, totalBet: 100, actedAtBet: null, stack: 900 });
  a.actedAtBet = 100; b.stack = 40; c.stack = 100;
  r.currentBet = 100; r.lastFullRaise = 100; r.turn = b.id; r.pending = new Set([b.id, c.id, d.id]);
  actPoker(r, b, 'allin'); actPoker(r, c, 'allin'); actPoker(r, d, 'call');
  assert.equal(r.turn, a.id); assert.equal(r.currentBet, 200); assert.equal(pokerLegal(r, a).raise, true);
});
test('Tous à tapis : aucune boucle de tours et runout complet', () => {
  const { room: r, players: [a, b] } = setup('poker', 2); a.stack = 10; b.stack = 10; startPoker(r);
  assert.equal(r.phase, 'results'); assert.equal(r.board.length, 5); assert.equal(a.stack + b.stack, 20);
});
test('Pas de relance dans un pot secondaire vide', () => {
  const { room: r, players: [a, b] } = setup('poker', 2); a.stack = 30; b.stack = 200; startPoker(r);
  actPoker(r, a, 'allin'); assert.equal(pokerLegal(r, b).raise, false); assert.equal(pokerLegal(r, b).allIn, false);
  actPoker(r, b, 'call'); assert.equal(r.phase, 'results'); assert.equal(a.stack + b.stack, 230);
});
test('Trois tapis inégaux : pot principal, secondaire et remboursement', () => {
  const { room: r, players: [a, b, c] } = setup(); startPoker(r);
  r.board = cards('2s 4h 7d 9c Js'); r.phase = 'river';
  a.cards = cards('As Ah'); b.cards = cards('Ks Kh'); c.cards = cards('Qs Qh');
  r.players.forEach((p, i) => { p.totalBet = (i + 1) * 100; p.stack = 0; });
  settlePoker(r); assert.deepEqual(r.players.map(p => p.stack), [300, 200, 100]);
  assert.deepEqual(r.pots.map(p => p.amount), [300, 200, 100]);
});
test('Égalité avec jeton impair : priorité à gauche du bouton', () => {
  const { room: r, players: [a, b, c] } = setup(); startPoker(r);
  r.board = cards('Ah Kh Qh Jh Th'); r.phase = 'river'; r.dealerSeat = a.seat;
  a.cards = cards('2s 3s'); b.cards = cards('4s 5s'); c.cards = cards('6s 7s'); c.folded = true;
  for (const p of r.players) { p.totalBet = 5; p.stack = 0; }
  settlePoker(r); assert.equal(a.stack, 7); assert.equal(b.stack, 8); assert.equal(c.stack, 0);
});
test('Robots : comportement indépendant des cartes privées adverses', () => {
  const { room: r, players: [a, b] } = setup(); startPoker(r);
  const expected = pokerBot(r, a, () => .5); b.cards = cards('As Ah'); r.deck.reverse();
  assert.deepEqual(pokerBot(r, a, () => .5), expected);
});
test('Simulation de 600 mains : conservation, terminaisons et pots', () => {
  let seed = 123456789;
  const rand = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
  for (let n = 0; n < 600; n++) {
    const { room: r } = setup('poker', 2 + n % 5);
    for (const p of r.players) p.stack = 1 + Math.floor(rand() * 2000);
    const total = r.players.reduce((a, p) => a + p.stack, 0); startPoker(r);
    let steps = 0;
    while (r.phase !== 'results') {
      assert.ok(++steps < 300, 'La main doit se terminer');
      const p = r.players.find(p => p.id === r.turn), l = pokerLegal(r, p), roll = rand();
      if (roll < .08) actPoker(r, p, 'fold');
      else if (roll < .2 && l.allIn) actPoker(r, p, 'allin');
      else if (roll < .38 && l.raise && l.maxRaise >= l.minRaise) actPoker(r, p, 'raise', Math.min(l.maxRaise, l.minRaise + Math.floor(rand() * 100)));
      else actPoker(r, p, l.check ? 'check' : 'call');
      assert.ok(r.players.every(p => Number.isSafeInteger(p.stack) && p.stack >= 0));
    }
    assert.equal(r.players.reduce((a, p) => a + p.stack, 0), total, `Conservation main ${n}`);
    assert.equal(r.pots.reduce((a, p) => a + p.amount, 0), r.players.reduce((a, p) => a + p.totalBet, 0));
  }
});

test('Transition à deux joueurs : pas deux grosses blindes consécutives', () => {
  const { room: r, players: [a, b, c] } = setup(); startPoker(r); passiveRound(r);
  assert.equal(r.bigBlindSeat, c.seat); a.leaving = true; startPoker(r);
  assert.equal(r.bigBlindSeat, b.seat); assert.equal(r.smallBlindSeat, c.seat);
});
