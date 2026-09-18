import test from 'node:test';
import assert from 'node:assert/strict';
import {WHEEL,RED,rouletteReturn,validateRouletteBets,settleRoulette} from '../server/roulette.js';
import {choose,createMines,minesView,revealMine,cashMines,minesReturn,diceGame,plinkoGame,plinkoMultipliers} from '../server/minigames.js';
import {startingStrength,startingDistributionScore,favoredDeck} from '../server/boost.js';
import {makeDeck} from '../server/cards.js';

test('Roulette : 37 cases uniques, 18 rouges, 18 noires et un zéro',()=>{assert.equal(WHEEL.length,37);assert.deepEqual([...WHEEL].sort((a,b)=>a-b),Array.from({length:37},(_,i)=>i));assert.equal(RED.size,18);assert.ok(!RED.has(0));});
test('Roulette : paiements de toutes les positions sur les 37 issues',()=>{
  for(let selection=0;selection<=36;selection++){const b={type:'straight',selection,amount:100};assert.equal(WHEEL.reduce((n,out)=>n+rouletteReturn(b,out),0),3600);assert.equal(rouletteReturn(b,selection),3600);}
  for(const type of ['red','black','even','odd','low','high']){assert.equal(rouletteReturn({type,amount:100},0),0);assert.equal(WHEEL.reduce((n,out)=>n+rouletteReturn({type,amount:100},out),0),3600);}
  for(const type of ['dozen','column'])for(const selection of [1,2,3])assert.equal(WHEEL.reduce((n,out)=>n+rouletteReturn({type,selection,amount:100},out),0),3600);
});
test('Roulette : montants invalides, doublons, limites et groupes refusés',()=>{
  for(const amount of [-100,0,1,101,20001,Infinity,NaN,'100'])assert.throws(()=>validateRouletteBets([{type:'red',amount}],50000));
  assert.throws(()=>validateRouletteBets([{type:'red',amount:100},{type:'red',amount:100}],1000));assert.throws(()=>validateRouletteBets([{type:'straight',selection:37,amount:100}],1000));assert.throws(()=>validateRouletteBets([{type:'dozen',selection:4,amount:100}],1000));assert.throws(()=>validateRouletteBets([{type:'red',amount:1000}],500));assert.throws(()=>validateRouletteBets([{type:'red',amount:20000},{type:'black',amount:100}],30000));assert.equal(validateRouletteBets([],500).total,0);
});
test('Roulette : règlement idempotent, mise incluse et historique du vrai numéro',()=>{
  const r={phase:'spinning',winningNumber:0,players:[{id:'a',name:'Alice',inHand:true,totalBet:100,stack:900,rouletteBets:[{type:'straight',selection:0,amount:100}]}]};settleRoulette(r);assert.equal(r.players[0].stack,4500);assert.equal(r.results[0].net,3500);settleRoulette(r);assert.equal(r.players[0].stack,4500);assert.deepEqual(r.rouletteHistory,[0]);
});
test('Cristaux : disposition valide, immuable et cachée tant que le tour est actif',()=>{
  for(const n of [1,3,5]){const m=createMines(1000,n);assert.equal(new Set(m.mines).size,n);assert.ok(m.mines.every(x=>x>=0&&x<25));const before=[...m.mines];const safe=Array.from({length:25},(_,i)=>i).find(i=>!m.mines.includes(i));revealMine(m,safe);assert.deepEqual(m.mines,before);assert.ok(!Object.hasOwn(minesView(m),'mines'));assert.throws(()=>revealMine(m,safe));}
});
test('Cristaux : une mine perd, fin de jeu immuable et révélation finale autorisée',()=>{const m=createMines(1000,3);revealMine(m,m.mines[0]);assert.equal(m.status,'lost');assert.equal(m.payout,0);assert.deepEqual(minesView(m).mines,m.mines);assert.throws(()=>revealMine(m,0));assert.throws(()=>cashMines(m));});
test('Cristaux : cashout et complétion utilisent les probabilités combinatoires exactes',()=>{
  assert.equal(choose(25,0),1n);assert.equal(choose(25,3),2300n);assert.equal(choose(25,26),0n);
  for(const mineCount of [1,3,5])for(let safe=1;safe<=25-mineCount;safe++){const payout=minesReturn(10000,mineCount,safe);const numerator=10000n*97n*choose(25,safe),denominator=100n*choose(25-mineCount,safe);assert.equal(BigInt(payout),numerator/denominator);}
  const m=createMines(1000,1);for(let i=0;i<25;i++)if(!m.mines.includes(i))revealMine(m,i);assert.equal(m.status,'won');assert.equal(m.payout,24250);
  const c=createMines(1000,3);assert.throws(()=>cashMines(c));revealMine(c,Array.from({length:25},(_,i)=>i).find(i=>!c.mines.includes(i)));cashMines(c);assert.equal(c.payout,minesReturn(1000,3,1));
});
test('Dice : seuil strict, 10 000 issues, probabilité choisie et paiements exacts',()=>{
  for(const chance of [10,25,50,90]){let wins=0;for(let roll=0;roll<10000;roll++){const r=diceGame(1000,chance,()=>roll);if(r.won)wins++;assert.equal(r.payout,r.won?Math.floor(1000*97/chance):0);}assert.equal(wins,chance*100);assert.equal(diceGame(1000,chance,()=>chance*100).won,false);}
  for(const chance of [9,91,50.5,'50'])assert.throws(()=>diceGame(1000,chance));
});
test('Plinko : les 4 096 chemins correspondent à leur case et au paiement affiché',()=>{
  let returned=0;const bucketCounts=Array(13).fill(0);
  for(let mask=0;mask<4096;mask++){let i=0;const r=plinkoGame(10000,()=>mask>>(i++)&1);assert.equal(r.path.length,12);assert.equal(r.bucket,r.path.reduce((n,x)=>n+x,0));bucketCounts[r.bucket]++;returned+=r.payout;assert.ok(Math.abs(r.payout-10000*r.multiplier)<1.00001);}
  for(let i=0;i<=12;i++)assert.equal(bucketCounts[i],Number(choose(12,i)));assert.ok(returned/4096<=9700);assert.ok(returned/4096>9699);assert.deepEqual(plinkoMultipliers(),plinkoMultipliers().reverse());
});
test('Poker Boost : force des mains, sélection de 24 distributions et aucune carte dupliquée',()=>{
  assert.ok(startingStrength({rank:14,suit:'s'},{rank:14,suit:'h'})>startingStrength({rank:2,suit:'s'},{rank:7,suit:'h'}));
  for(const count of [2,3,4,5,6]){const choices=Array.from({length:24},()=>makeDeck());let i=0;const chosen=favoredDeck(count,()=>choices[i++]);assert.equal(i,24);assert.equal(new Set(chosen.map(c=>c.id)).size,52);assert.equal(startingDistributionScore(chosen,count),Math.max(...choices.map(d=>startingDistributionScore(d,count))));}
});
test('Poker Boost : la sélection dépend des seules cartes privées initiales, pas du tableau futur',()=>{
  const deck=makeDeck(),other=[...deck];other.splice(0,44,...other.slice(0,44).reverse());assert.equal(startingDistributionScore(deck,4),startingDistributionScore(other,4));
});
