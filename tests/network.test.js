import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { randomUUID } from 'node:crypto';

async function harness(t, options = {}) {
  const app = createApp({ tickMs: 10, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.stop());
  async function api(route, data, token, headers = {}) {
    const res = await fetch(`${base}/api/${route}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    return { status: res.status, data: await res.json() };
  }
  async function create(game = 'poker') { return (await api('create', { name: 'Alice', game })).data; }
  async function join(code, name = 'Bob') { return (await api('join', { name, code })).data; }
  async function action(who, type, extra = {}) {
    const s = (await api('state', undefined, who.token)).data;
    return api('action', { type, actionId: randomUUID(), handId: s.handId, turnSeq: s.turnSeq, ...extra }, who.token);
  }
  async function stream(token) {
    const control = new AbortController(); t.after(() => control.abort());
    const res = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: control.signal });
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const events = []; let buffer = ''; const decoder = new TextDecoder();
    (async () => { try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true }); let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (packet.startsWith('event: state')) events.push(JSON.parse(packet.match(/^data: (.+)$/m)[1]));
        }
      }
    } catch { /* Test cleanup aborts open streams. */ } })();
    return {
      events, close: () => control.abort(),
      async wait(predicate) {
        const until = Date.now() + 3000;
        while (Date.now() < until) { const event = events.findLast(predicate); if (event) return event; await new Promise(r => setTimeout(r, 10)); }
        throw new Error('Événement SSE attendu non reçu');
      }
    };
  }
  return { app, base, api, create, join, action, stream };
}

test('HTTP : accueil, ressources locales et protections', async t => {
  const { base } = await harness(t);
  for (const route of ['/', '/app.js', '/styles.css', '/favicon.svg']) {
    const response = await fetch(base + route); assert.equal(response.status, 200); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.ok((await response.text()).length > 20);
  }
  assert.equal((await fetch(base + '/server/index.js')).status, 404);
  assert.equal((await fetch(base + '/.env')).status, 404);
});
test('Deux clients SSE jouent réellement une main complète et voient le même tableau', async t => {
  const { create, join, api, action, stream } = await harness(t);
  const a = await create(), b = await join(a.code.toLowerCase());
  const sa = await stream(a.token), sb = await stream(b.token);
  await action(a, 'start');
  const va = await sa.wait(s => s.phase === 'preflop'), vb = await sb.wait(s => s.phase === 'preflop');
  assert.equal(va.players.length, 2); assert.deepEqual(va.players.find(p => p.id === b.id).cards, [null, null]);
  assert.deepEqual(vb.players.find(p => p.id === a.id).cards, [null, null]);
  const secret = va.players.find(p => p.id === a.id).cards[0].id; assert.ok(!JSON.stringify(vb).includes(secret));
  assert.ok(!JSON.stringify(va).includes(a.token)); assert.ok(!JSON.stringify(vb).includes(b.token));
  let steps = 0;
  while (true) {
    const snapshot = (await api('state', undefined, a.token)).data;
    if (snapshot.phase === 'results') break;
    assert.ok(++steps < 50);
    const who = snapshot.turn === a.id ? a : b;
    const own = (await api('state', undefined, who.token)).data;
    assert.equal((await action(who, own.legal.check ? 'check' : 'call')).status, 200);
  }
  const ra = await sa.wait(s => s.phase === 'results'), rb = await sb.wait(s => s.phase === 'results');
  assert.deepEqual(ra.board, rb.board); assert.deepEqual(ra.results, rb.results); assert.equal(ra.board.length, 5);
  assert.equal(ra.players.reduce((n, p) => n + p.stack, 0), 4000);
});
test('Salons isolés : une autre table ne reçoit ni joueurs ni mises', async t => {
  const { create, join, api, action } = await harness(t);
  const a = await create(); await join(a.code); const other = await create();
  const before = (await api('state', undefined, other.token)).data;
  await action(a, 'start');
  const after = (await api('state', undefined, other.token)).data;
  assert.equal(after.version, before.version); assert.equal(after.players.length, 1); assert.equal(after.phase, 'lobby'); assert.notEqual(a.code, other.code);
});
test('Requête dupliquée : une seule mise, même réponse', async t => {
  const { create, join, api, action } = await harness(t);
  const a = await create('blackjack'); await join(a.code); await action(a, 'start');
  const s = (await api('state', undefined, a.token)).data;
  const msg = { type: 'bet', amount: 100, actionId: randomUUID(), handId: s.handId, turnSeq: s.turnSeq };
  const first = await api('action', msg, a.token), second = await api('action', msg, a.token);
  assert.equal(first.status, 200); assert.deepEqual(first, second);
  assert.equal((await api('state', undefined, a.token)).data.players.find(p => p.id === a.id).stack, 900);
});
test('Authentification, actions hors tour et ancienne main refusées', async t => {
  const { create, join, api, action } = await harness(t);
  const a = await create(), b = await join(a.code);
  assert.equal((await api('state', undefined, 'invalid')).status, 401);
  assert.equal((await action(b, 'start')).status, 400);
  await action(a, 'start');
  assert.equal((await action(b, 'call')).status, 400);
  assert.equal((await api('action', { type: 'call', handId: 0, turnSeq: 0, actionId: randomUUID() }, a.token)).status, 400);
  assert.equal((await api('action', { type: 'call', handId: 1, turnSeq: -1, actionId: randomUUID() }, a.token)).status, 400);
});
test('Reconnexion au même siège avec cartes et jetons conservés', async t => {
  const { create, join, api, action, stream } = await harness(t);
  const a = await create(), b = await join(a.code); let sa = await stream(a.token); await stream(b.token);
  await action(a, 'start'); const before = (await api('state', undefined, a.token)).data;
  sa.close(); await new Promise(r => setTimeout(r, 40)); sa = await stream(a.token);
  const after = await sa.wait(s => s.phase === 'preflop');
  assert.equal(after.players.length, 2); assert.deepEqual(after.players.find(p => p.id === a.id).cards, before.players.find(p => p.id === a.id).cards);
  assert.equal(after.players.find(p => p.id === a.id).stack, before.players.find(p => p.id === a.id).stack);
});
test('Arrivée pendant une main : attente jusqu’à la suivante', async t => {
  const { create, join, api, action } = await harness(t);
  const a = await create(); await join(a.code); await action(a, 'start'); const c = await join(a.code, 'Chloe');
  const s = (await api('state', undefined, c.token)).data; const p = s.players.find(p => p.id === c.id);
  assert.equal(p.inHand, false); assert.deepEqual(p.cards, []); assert.equal(s.legal, null); assert.equal(p.stack, 2000);
});
test('Table pleine et code invalide renvoient des erreurs lisibles', async t => {
  const { create, join, api } = await harness(t); const a = await create();
  for (let i = 0; i < 5; i++) await join(a.code, `Joueur ${i}`);
  assert.equal((await api('join', { name: 'En trop', code: a.code })).status, 400);
  assert.equal((await api('join', { name: 'Introuvable', code: 'ZZZZZZ' })).status, 404);
});
test('Déconnexion de l’hôte : transfert et tour expiré sans bloquer', async t => {
  const { create, join, api, action, stream } = await harness(t, { turnMs: 100 });
  const a = await create(), b = await join(a.code); const sa = await stream(a.token); await stream(b.token);
  await action(a, 'start'); sa.close();
  await new Promise(r => setTimeout(r, 180));
  const s = (await api('state', undefined, b.token)).data;
  assert.equal(s.ownerId, b.id); assert.equal(s.phase, 'results'); assert.equal(s.players.find(p => p.id === a.id).folded, true);
});
test('Blackjack multijoueur : délai des mises puis tour auto', async t => {
  const { create, join, api, action, stream } = await harness(t, { betMs: 100, turnMs: 100 });
  const a = await create('blackjack'); await join(a.code); await stream(a.token); await action(a, 'start'); await action(a, 'bet', { amount: 100 });
  await new Promise(r => setTimeout(r, 320));
  const s = (await api('state', undefined, a.token)).data;
  assert.equal(s.phase, 'results'); assert.equal(s.players.filter(p => p.bjBet > 0).length, 1);
});
test('Origine externe et requêtes non JSON refusées', async t => {
  const { base, api } = await harness(t);
  assert.equal((await api('create', { name: 'Alice', game: 'poker' }, null, { Origin: 'https://untrusted.example' })).status, 403);
  const response = await fetch(base + '/api/create', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(response.status, 415);
});
test('Quitter invalide la session, sans exposer d’informations privées', async t => {
  const { create, api } = await harness(t); const a = await create();
  assert.equal((await api('leave', {}, a.token)).status, 200);
  assert.equal((await api('state', undefined, a.token)).status, 401);
});
test('Table solo réellement peuplée de robots, pas rejoignable par code', async t => {
  const { api } = await harness(t, { botMs: 10 });
  const solo = (await api('create', { name: 'Alice', game: 'poker', solo: true, bots: 3 })).data;
  assert.equal(solo.state.players.filter(p => p.bot).length, 3); assert.notEqual(solo.state.phase, 'lobby');
  assert.equal((await api('join', { name: 'Bob', code: solo.code })).status, 400);
});
