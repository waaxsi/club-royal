import {motionMs} from './cards-ui.js';
export const euro=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format((n??0)/100);
export const signedEuro=n=>`${n>0?'+':n<0?'−':''}${euro(Math.abs(n))}`;
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const storage={get(k,d=null){try{return JSON.parse(localStorage.getItem(k))??d;}catch{return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}};
export function setMotion(mode){document.documentElement.dataset.motion=mode;storage.set('cr-v2-motion',mode);}
setMotion(storage.get('cr-v2-motion',matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'cinematic'));
let audio=null,soundOn=storage.get('cr-v2-sound',false);
export function soundEnabled(){return soundOn;}
export function toggleSound(){soundOn=!soundOn;storage.set('cr-v2-sound',soundOn);if(soundOn)tone('click');return soundOn;}
export function tone(type='click'){
  if(!soundOn)return;
  try{
    audio??=new(window.AudioContext||window.webkitAudioContext)();audio.resume();
    const notes=type==='win'?[523,659,784]:type==='card'?[700,480]:type==='turn'?[523,698]:[400];
    notes.forEach((freq,i)=>{const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime+i*.1;o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.045,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+.16);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.18);});
  }catch{/* Audio is optional. */}
}
export function toast(text,error=false){
  const el=document.createElement('div');el.className=`toast ${error?'error':''}`;el.textContent=text;document.querySelector('#toast-region').append(el);
  setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),300);},4500);
}
let resultTimer=null,numberFrame=null,resultGeneration=0;
export function clearResultOverlay(){
  ++resultGeneration;clearTimeout(resultTimer);cancelAnimationFrame(numberFrame);
  const root=document.querySelector('#result-layer');if(root){root.hidden=true;root.innerHTML='';}
}
export function resultOverlay({title,amount=0,label='Gain net · euros fictifs',positive=amount>0}){
  const generation=++resultGeneration;const root=document.querySelector('#result-layer');clearTimeout(resultTimer);cancelAnimationFrame(numberFrame);
  root.hidden=false;root.className=`result-layer ${positive?'positive':'neutral'}`;
  root.innerHTML=`<div class="result-halo"></div><div class="result-card"><div class="result-star">${positive?'✦':'◇'}</div><span class="eyebrow">${esc(title)}</span><strong id="result-number">${signedEuro(amount)}</strong><p>${esc(label)}</p><small>Aucune valeur monétaire</small></div>${positive&&motionMs()?Array.from({length:18},(_,i)=>`<i class="result-spark" style="--angle:${i*20}deg;--distance:${160+i%3*32}px;--delay:${i%4*.05}s"></i>`).join(''):''}`;
  if(positive)tone('win');
  if(motionMs()){
    const start=performance.now();const frame=now=>{const t=Math.min(1,(now-start)/900);const num=root.querySelector('#result-number');if(num)num.textContent=signedEuro(Math.round(amount*(1-Math.pow(1-t,3))));if(t<1)numberFrame=requestAnimationFrame(frame);};numberFrame=requestAnimationFrame(frame);
  }
  resultTimer=setTimeout(()=>{root.classList.add('out');setTimeout(()=>{if(generation===resultGeneration)root.hidden=true;},450);},positive?3000:2200);
}
export function pageEnter(el){if(motionMs())el.animate([{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:300,easing:'cubic-bezier(.2,.8,.2,1)'});}
export async function copyText(value){
  try{await navigator.clipboard.writeText(value);toast('Lien copié. Envoie-le à tes amis.');return true;}
  catch{const input=document.createElement('textarea');input.value=value;input.style.position='fixed';input.style.opacity='0';(document.querySelector('dialog[open]')||document.body).append(input);input.select();let ok=false;try{ok=document.execCommand('copy');}catch{}input.remove();toast(ok?'Copié.':'Copie le lien affiché dans le champ.');return ok;}
}
