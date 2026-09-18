import {cardMarkup} from './cards-ui.js';
export const WHEEL=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
export const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const color=n=>n===0?'green':RED.has(n)?'red':'black';
export function chip(n=10,klass=''){return `<span class="chip ${klass}"><b>${n}</b></span>`;}
export function heroArt(){return `<div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-table"><div class="table-inner-lines"></div><span class="felt-wordmark">CLUB ROYAL <small>PLAY TOGETHER</small></span></div><div class="floating-hand">${cardMarkup({rank:14,suit:'s'},'float-one')}${cardMarkup({rank:14,suit:'h'},'float-two')}</div><div class="chip-tower tower-one">${[0,1,2,3,4].map((_,i)=>`<div style="--i:${i}">${chip('50','violet')}</div>`).join('')}</div><div class="chip-tower tower-two">${[0,1,2,3].map((_,i)=>`<div style="--i:${i}">${chip('25','mint')}</div>`).join('')}</div><div class="floating-token">✦</div><span class="art-star star-one">✦</span><span class="art-star star-two">+</span></div>`;}
export function smallArt(game){
  if(game==='poker')return `<div class="small-hand">${cardMarkup({rank:14,suit:'s'})}${cardMarkup({rank:13,suit:'s'})}${chip('25','violet')}</div>`;
  if(game==='blackjack')return `<div class="small-hand bj-art">${cardMarkup({rank:14,suit:'h'})}${cardMarkup({rank:13,suit:'c'})}<b class="art-21">21</b></div>`;
  if(game==='roulette')return `<div class="mini-wheel">${wheelSVG()}</div>`;
  if(game==='mines')return `<div class="gem-cluster">${gemSVG()}${gemSVG()}${gemSVG()}</div>`;
  if(game==='dice')return `<div class="mini-die">${dieHTML()}</div>`;
  return `<div class="plinko-art"><span></span><i>· · ·<br>· · · ·<br>· · · · ·<br>· · · · · ·</i><b>×2</b><b>×5</b><b>×2</b></div>`;
}
export function gemSVG(){return '<svg class="gem-svg" viewBox="0 0 80 80" aria-hidden="true"><path d="m40 3 27 17 5 34-32 23L8 54l5-34Z" fill="#52ceb6"/><path d="m40 3 13 25-13 13-13-13Z" fill="#c4fff0"/><path d="m13 20 14 8 13 13L8 54Z" fill="#76f6d4"/><path d="m67 20-14 8-13 13 32 13Z" fill="#6fd9e1"/><path d="m8 54 32-13v36Z" fill="#238b9d"/><path d="m72 54-32-13v36Z" fill="#3fbab1"/><path d="m40 3-27 17 14 8Zm0 0 27 17-14 8Z" fill="#f2fffb" opacity=".6"/></svg>';}
export function dieHTML(){return `<div class="die-cube">${[1,2,3,4,5,6].map(n=>`<span class="die-face face-${n}">${Array.from({length:n},()=>'<i></i>').join('')}</span>`).join('')}</div>`;}
export function wheelSVG(){
  const center=200,r=176,step=360/37,rad=a=>a*Math.PI/180;
  const point=(a,radius=r)=>[center+radius*Math.cos(rad(a)),center+radius*Math.sin(rad(a))];
  return `<svg viewBox="0 0 400 400" class="wheel-svg" aria-label="Roulette à 37 cases"><circle cx="200" cy="200" r="197" fill="#18172d" stroke="#bba27a" stroke-width="5"/><circle cx="200" cy="200" r="184" fill="#aaa093"/>${WHEEL.map((n,i)=>{const a=i*step-90-step/2,b=a+step,p1=point(a),p2=point(b),label=point(i*step-90,160);return `<path d="M200 200 L${p1} A${r} ${r} 0 0 1 ${p2} Z" fill="${n===0?'#247e69':RED.has(n)?'#b64767':'#20253b'}" stroke="#d3bea0" stroke-width=".6"/><text x="${label[0]}" y="${label[1]}" dy=".35em" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="11" fill="#fff5e5" transform="rotate(${i*step} ${label[0]} ${label[1]})">${n}</text>`;}).join('')}<circle cx="200" cy="200" r="142" fill="#161c30" stroke="#bba27a" stroke-width="2"/><circle cx="200" cy="200" r="126" fill="#1d2734" stroke="#46505e"/><circle cx="200" cy="200" r="105" fill="#161c2c"/><path d="M94 200h212M200 94v212" stroke="#c6b88c" stroke-width="4"/><circle cx="200" cy="200" r="20" fill="#d5c69f"/><circle cx="200" cy="200" r="10" fill="#eadfce"/></svg>`;
}
export function plinkoSVG(multipliers){
  const pegs=[];for(let row=0;row<12;row++)for(let j=0;j<=row;j++)pegs.push(`<circle cx="${320+(j-row/2)*36}" cy="${50+row*25}" r="3.5"/>`);
  return `<svg class="plinko-svg" viewBox="0 0 640 440" aria-label="Planche Plinko à douze niveaux"><defs><radialGradient id="ball-shine"><stop stop-color="#fff"/><stop offset="1" stop-color="#a98df5"/></radialGradient></defs><g class="plinko-pegs">${pegs.join('')}</g><g class="plinko-buckets">${multipliers.map((m,i)=>`<g data-bucket="${i}"><rect x="${87+i*36}" y="370" width="34" height="37" rx="8"/><text x="${104+i*36}" y="393" text-anchor="middle">${m.toFixed(m<1?2:1)}×</text></g>`).join('')}</g><circle id="plinko-ball" cx="0" cy="0" r="8" fill="url(#ball-shine)" style="transform:translate(320px, 20px)"/></svg>`;
}
