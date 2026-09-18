import { RoomManager } from '../server/rooms.js';
import { pokerLegal, actPoker } from '../server/poker.js';
export const cards = text => text.trim().split(/\s+/).map((v, i) => ({ id: `test-${v}-${i}`, rank: ({ T: 10, J: 11, Q: 12, K: 13, A: 14 })[v[0]] ?? Number(v[0]), suit: v[1] }));
export function setup(game = 'poker', n = 3) {
  const manager = new RoomManager(); const session = manager.create({ name: 'Alice', game, bots: 3 });
  for (let i = 1; i < n; i++) manager.join({ name: ['Alice', 'Bob', 'Chloe', 'David', 'Emma', 'Fred'][i], code: session.code });
  const room = manager.rooms.get(session.code);
  return { manager, room, players: room.players, session };
}
export function passiveRound(r) {
  let steps = 0;
  while (r.phase !== 'results') {
    if (++steps > 150) throw Error('Boucle de jeu');
    const p = r.players.find(p => p.id === r.turn), legal = pokerLegal(r, p);
    actPoker(r, p, legal.check ? 'check' : 'call');
  }
}
export function action(manager, p, r, type, extra = {}) {
  return manager.act(p.token, { actionId: crypto.randomUUID(), handId: r.handId, turnSeq: r.turnSeq, type, ...extra });
}
