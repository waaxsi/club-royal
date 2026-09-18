import { randomInt, randomUUID } from 'node:crypto';
import { cents } from './security.js';

export function choose(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return 0n;
  let result = 1n;
  for (let i = 1; i <= Math.min(k, n-k); i++) result = result * BigInt(n-i+1) / BigInt(i);
  return result;
}
export function minesReturn(stake, mineCount, safeCount) {
  if (safeCount === 0) return stake;
  return Number(BigInt(stake) * 97n * choose(25, safeCount) / (100n * choose(25 - mineCount, safeCount)));
}
export function createMines(stake, mineCount) {
  cents(stake,100,20000);
  if (![1,3,5].includes(mineCount)) throw new Error('Choisis 1, 3 ou 5 mines.');
  const cells = Array.from({ length: 25 }, (_,i) => i);
  for (let i=24;i>0;i--) { const j=randomInt(i+1); [cells[i],cells[j]]=[cells[j],cells[i]]; }
  return { id: randomUUID(), stake, mineCount, mines: cells.slice(0,mineCount), revealed: [], status:'playing', payout:0, createdAt:Date.now() };
}
export function minesView(m) {
  if (!m) return null;
  return {
    id:m.id, stake:m.stake, mineCount:m.mineCount, revealed:m.revealed, status:m.status, payout:m.payout,
    availableReturn: minesReturn(m.stake,m.mineCount,m.revealed.length),
    nextReturn: m.revealed.length < 25-m.mineCount ? minesReturn(m.stake,m.mineCount,m.revealed.length+1) : null,
    ...(m.status !== 'playing' ? { mines:m.mines } : {})
  };
}
export function revealMine(m, cell) {
  if (m.status !== 'playing') throw new Error('Cette exploration est terminée.');
  if (!Number.isInteger(cell) || cell<0 || cell>=25 || m.revealed.includes(cell)) throw new Error('Cette case n’est pas disponible.');
  if (m.mines.includes(cell)) { m.status='lost'; m.exploded=cell; return; }
  m.revealed.push(cell);
  if (m.revealed.length === 25-m.mineCount) { m.status='won'; m.payout=minesReturn(m.stake,m.mineCount,m.revealed.length); }
}
export function cashMines(m) {
  if (m.status !== 'playing' || !m.revealed.length) throw new Error('Révèle au moins un cristal avant de récupérer le gain.');
  m.status='won'; m.payout=minesReturn(m.stake,m.mineCount,m.revealed.length);
}
export function diceGame(stake, chance, generator = randomInt) {
  cents(stake,100,20000);
  if (!Number.isInteger(chance) || chance<10 || chance>90) throw new Error('La chance doit être comprise entre 10 et 90 %.');
  const roll=generator(10000), won=roll<chance*100;
  const possible=Number(BigInt(stake)*97n/BigInt(chance));
  return { game:'dice', roll, chance, stake, won, payout:won?possible:0, possible, multiplier:97/chance };
}
// Exact, disclosed 12-row distribution, scaled to 97% expected gross return before cent rounding.
export const PLINKO_BASE = [160,90,30,20,10,6,5,6,10,20,30,90,160];
export const PLINKO_DENOM = PLINKO_BASE.reduce((sum, n, i) => sum + BigInt(n)*choose(12,i), 0n)*100n;
export const plinkoMultipliers = () => PLINKO_BASE.map(n => Number(BigInt(n)*4096n*97n)/Number(PLINKO_DENOM));
export function plinkoGame(stake, generator=randomInt) {
  cents(stake,100,20000);
  const path=Array.from({length:12},()=>generator(2));
  const bucket=path.reduce((a,b)=>a+b,0);
  const payout=Number(BigInt(stake)*BigInt(PLINKO_BASE[bucket])*4096n*97n/PLINKO_DENOM);
  return { game:'plinko', stake, path, bucket, payout, multiplier:plinkoMultipliers()[bucket] };
}
