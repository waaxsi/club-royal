import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { setup, action } from './helpers.js';

test('Recharge humaine gratuite : seulement à court de jetons et hors main', () => {
  const { manager, room: r, players: [p] } = setup();
  assert.throws(() => action(manager, p, r, 'refill'));
  p.stack = 0; action(manager, p, r, 'refill'); assert.equal(p.stack, 2000); assert.equal(p.refills, 2000);
  action(manager, p, r, 'start'); p.stack = 0; assert.throws(() => action(manager, p, r, 'refill'));
});
test('Robots gérés par l’hôte uniquement entre les mains', () => {
  const { manager, room: r, players: [a, b] } = setup('poker', 2);
  assert.throws(() => action(manager, b, r, 'addBot'));
  action(manager, a, r, 'addBot'); assert.equal(r.players.length, 3);
  action(manager, a, r, 'removeBot'); assert.equal(r.players.length, 2);
  action(manager, a, r, 'start'); assert.throws(() => action(manager, a, r, 'addBot'));
});
test('Identité avec pseudo malicieux ne modifie pas les rôles', () => {
  const manager = new RoomManager(); const x = manager.create({ name: '<img> Alice', game: 'poker', ownerId: 'attacker', stack: 999999 });
  const p = manager.rooms.get(x.code).players[0]; assert.equal(p.name, 'img Alice'); assert.equal(p.stack, 2000); assert.notEqual(p.id, 'attacker');
});
test('Expiration après la grâce : jeton invalidé sans supprimer une mise en cours', () => {
  const { manager, room: r, players: [a, b] } = setup('poker', 2); action(manager, a, r, 'start');
  manager.graceMs = 20; manager.disconnect(a.token); const amount = a.totalBet;
  manager.tick(Date.now() + 30); assert.throws(() => manager.auth(a.token)); assert.equal(a.totalBet, amount); assert.equal(r.ownerId, b.id);
});
test('Salle vide expirée : nettoyage de la salle et des identifiants', () => {
  const manager = new RoomManager({ graceMs: 10 }); const { token, code } = manager.create({ name: 'Alice', game: 'blackjack' });
  manager.disconnect(token); manager.tick(Date.now() + 20); assert.equal(manager.rooms.has(code), false); assert.equal(manager.tokens.has(token), false);
});
