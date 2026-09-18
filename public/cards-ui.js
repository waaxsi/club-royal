const suits={s:'♠',h:'♥',d:'♦',c:'♣'},names={s:'pique',h:'cœur',d:'carreau',c:'trèfle'};
export const motionMs=()=>document.documentElement.dataset.motion==='reduced'?0:document.documentElement.dataset.motion==='quick'?420:1000;
function front(c){
  const rank=({11:'J',12:'Q',13:'K',14:'A'})[c.rank]||String(c.rank),red=['h','d'].includes(c.suit);
  return `<span class="card-face card-front ${red?'red':''}"><span class="card-corner">${rank}<i>${suits[c.suit]}</i></span><span class="card-suit">${suits[c.suit]}</span><span class="card-corner bottom">${rank}<i>${suits[c.suit]}</i></span></span>`;
}
export function cardMarkup(c,classes=''){
  return `<div class="playing-card art-card ${classes} ${c?'is-face':''}"><div class="card-rotor"><span class="card-face card-back"><b>R</b><i>CLUB ROYAL</i></span>${c?front(c):'<span class="card-face card-front"></span>'}</div></div>`;
}
/** Keyed card nodes remain alive across snapshots. Only a NEW card or a hidden-to-face
 * transition triggers the slow physical flip, not countdowns, balances or reconnects. */
export function patchCards(parent,cards,key,{delay=0,stagger=150,placeholders=0}={}){
  if(!parent)return 0;
  const duration=motionMs(),count=Math.max(cards.length,placeholders);let end=0;
  for(let i=0;i<count;i++){
    const c=i<cards.length?cards[i]:'empty',slot=`${key}:${i}`;let node=parent.children[i];
    if(!node||node.dataset.slot!==slot){
      const fresh=document.createElement('div');fresh.className='playing-card';fresh.dataset.slot=slot;
      fresh.innerHTML='<div class="card-rotor"><span class="card-face card-back"><b>R</b><i>CLUB ROYAL</i></span><span class="card-face card-front"></span></div>';
      if(node)node.replaceWith(fresh);else parent.append(fresh);node=fresh;node.setAttribute('role','img');
    }
    if(c==='empty'){node.className='playing-card card-placeholder';node.innerHTML='<span>♠</span>';node.dataset.value='empty';node.setAttribute('aria-label','Carte à venir');continue;}
    if(node.dataset.value==='empty'){
      node.className='playing-card';node.innerHTML='<div class="card-rotor"><span class="card-face card-back"><b>R</b><i>CLUB ROYAL</i></span><span class="card-face card-front"></span></div>';node.dataset.value='';
    }
    if(c===null){node.setAttribute('aria-label','Carte cachée');continue;}
    const value=`${c.rank}${c.suit}`;
    if(node.dataset.value!==value){
      node.dataset.value=value;node.classList.add('card-arrival');
      const target=node.querySelector('.card-front');target.outerHTML=front(c);
      node.setAttribute('aria-label',`${({11:'Valet',12:'Dame',13:'Roi',14:'As'})[c.rank]||c.rank} de ${names[c.suit]}`);
      const wait=duration?delay+i*stagger+40:0;
      setTimeout(()=>{if(node.isConnected&&node.dataset.slot===slot)node.classList.add('is-face');},wait);
      end=Math.max(end,wait+duration);
    }
  }
  while(parent.children.length>count)parent.lastElementChild.remove();
  return end;
}
