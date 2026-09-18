import {patchCards,motionMs} from './cards-ui.js';
import {euro,signedEuro,esc,storage,setMotion,soundEnabled,toggleSound,tone,toast,resultOverlay,clearResultOverlay,pageEnter,copyText} from './effects.js';
import {heroArt,smallArt,gemSVG,dieHTML,wheelSVG,plinkoSVG,WHEEL,color} from './art.js';

const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>[...p.querySelectorAll(s)];
const app=$('#app'),dialog=$('#dialog'),dialogBody=$('#dialog-content');
const GAMES={poker:{name:'Texas Hold’em',short:'Poker',icon:'♠',note:'La table, les amis, le bluff.',tag:'LE JEU PRINCIPAL'},blackjack:{name:'Blackjack',short:'Blackjack',icon:'21',note:'Vise 21. Bats le croupier.',tag:'CONTRE LE CROUPIER'},roulette:{name:'Roulette',short:'Roulette',icon:'◉',note:'37 cases. Un moment suspendu.',tag:'TABLE PARTAGÉE'},mines:{name:'Cristaux',short:'Cristaux',icon:'◇',note:'Explore. Révèle. Récupère.',tag:'EXPLORATION'},dice:{name:'Dice',short:'Dice',icon:'⚄',note:'Ta probabilité. Ton lancer.',tag:'UN LANCER'},plinko:{name:'Plinko',short:'Plinko',icon:'⋮',note:'Une bille, douze rebonds.',tag:'LAISSE REBONDIR'}};
const PHASE={lobby:'Salon privé',preflop:'Préflop',flop:'Flop',turn:'Turn',river:'River',results:'Résultats',betting:'Vos mises',playing:'À la table',spinning:'La roue tourne',error:'Table interrompue'};
let me=null,state=null,config={},siteInfo={},route='home',events=null,requestBusy=false,authNext=null,activeAdmin=null,historyOffset=0;
let tableKey='',clockOffset=0,lastTurn='',resultTimeout=null,rouletteAnimation=null,rouletteKey='',rouletteDraft=[],rouletteChip=100;
let diceBusy=false,plinkoBusy=false,minesBusy=false,miniHistory=[],lastMinesId='',pendingInvite=new URL(location.href).searchParams.get('table');
let ui={raise:0,bet:1000,miniStake:1000,chance:50,mineCount:3};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const id=()=>crypto.randomUUID?.()??[...crypto.getRandomValues(new Uint8Array(20))].map(x=>x.toString(16).padStart(2,'0')).join('');
const seenResults=new Set();
const moneyInput=(value,min=100,max=200000)=>{const text=String(value).trim().replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(text))throw Error('Indique un montant en euros, avec deux décimales au maximum.');const n=Math.round(Number(text)*100);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`Le montant doit être compris entre ${euro(min)} et ${euro(max)}.`);return n;};
const dt=n=>new Date(n).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
function formError(form,text){const el=$('.error-message',form)||$('.error-message',dialogBody);if(el)el.textContent=text;else toast(text,true);}
function modal(html){dialogBody.innerHTML=html;if(!dialog.open)dialog.showModal();requestAnimationFrame(()=>dialogBody.querySelector('input:not([type=checkbox]),button')?.focus());}
function closeModal(){dialog.close();authNext=null;}
function connection(text,ok){$('#connection-label').textContent=text;$('.top-context .live-dot').classList.toggle('offline',!ok);}
function updateAccount(next){
  me=next;$('#wallet-button').hidden=!me;$('#admin-nav').hidden=me?.role!=='admin';$('#account-button').textContent=me?me.name:'Connexion';
  $('#header-balance').textContent=euro(me?.wallet?.available??0);$('#wallet-button').title=me?`Disponible : ${euro(me.wallet.available)} · engagé : ${euro(me.wallet.inPlay)} (fictifs)`:'';
  $('#sound-toggle').textContent=soundEnabled()?'♪':'♩';$('#sound-toggle').title=soundEnabled()?'Couper le son':'Activer le son';
  const banner=me?.banner??config.banner??'';$('#site-banner').textContent=banner;$('#site-banner').hidden=!banner;
  $('#resume-bar').hidden=!me?.activeRoom||route==='table';
  if(me?.activeRoom)$('#resume-bar span').textContent=`Ton tapis est à la table ${me.activeRoom.code} · ${GAMES[me.activeRoom.game].short}`;
  if(route==='mines')patchMines();
  if(route==='wallet')patchWalletSummary();
  if(route==='account'&&me?.mustChangePassword)$('#password-required')?.removeAttribute('hidden');
}
function updateState(next){
  if(next){clockOffset=next.serverNow-Date.now();state=next;}
  else state=null;
  if(route==='table')renderTable();
  $('#resume-bar').hidden=!me?.activeRoom||route==='table';
}
async function api(path,msg,quiet=false){
  const isPost=msg!==undefined, payload=isPost?{...msg}:null;
  if(isPost&&!path.startsWith('/api/auth/'))payload.actionId??=id();
  const args={method:isPost?'POST':'GET',credentials:'same-origin',headers:{...(isPost?{'Content-Type':'application/json','X-CR-Request':'1','X-CSRF-Token':me?.csrf??''}:{})},...(isPost?{body:JSON.stringify(payload)}:{})};
  let response;
  for(let attempt=0;attempt<2;attempt++){
    try{response=await fetch(path,args);break;}catch(e){if(attempt||!isPost||path.startsWith('/api/auth/'))throw Error('Connexion interrompue. Actualise pour vérifier le dernier résultat avant de rejouer.');await sleep(700);}
  }
  const out=await response.json().catch(()=>({error:'Le serveur se réveille ou est indisponible. Réessaie dans un instant.'}));
  if(!response.ok){if(response.status===401&&!path.startsWith('/api/auth/')&&!quiet){events?.close();events=null;updateAccount(null);connection('Reconnecte-toi',false);}throw Object.assign(Error(out.error||'Action impossible.'),{status:response.status});}
  if(isPost&&Object.hasOwn(out,'me'))updateAccount(out.me);
  if(isPost&&Object.hasOwn(out,'state'))updateState(out.state);
  return out;
}
function startEvents(){
  events?.close();if(!me)return;const stream=new EventSource('/api/events');events=stream;
  stream.onopen=()=>connection('Connecté au club',true);
  stream.onerror=()=>connection('Reconnexion en cours…',false);
  stream.addEventListener('account',e=>{try{updateAccount(JSON.parse(e.data));}catch{}});
  stream.addEventListener('state',e=>{try{updateState(JSON.parse(e.data));}catch{}});
  stream.addEventListener('auth-expired',()=>{stream.close();events=null;updateAccount(null);updateState(null);connection('Session terminée',false);navigate('home');toast('Ta session a expiré ou a été révoquée. Reconnecte-toi.',true);});
  stream.addEventListener('service-error',()=>{connection('Le serveur redémarre…',false);});
}
function requireAccount(fn){if(!me){authNext=fn;authDialog();return;}if(me.mustChangePassword){navigate('account');toast('Choisis un nouveau mot de passe avant de rejouer.');return;}fn();}
function setRoute(next){route=next;$$('.rail-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===next||(next==='table'&&b.dataset.game===state?.game)||(b.dataset.nav==='arcade'&&['arcade','mines','dice','plinko'].includes(next))));$('#resume-bar').hidden=!me?.activeRoom||next==='table';}
function navigate(next){
  if(['wallet','account','admin','table'].includes(next)&&!me){authNext=()=>navigate(next);authDialog();return;}
  if(next==='admin'&&me?.role!=='admin'){toast('Cet espace est réservé à l’administrateur.',true);return;}
  if(next!==route){clearTimeout(resultTimeout);clearResultOverlay();tableKey='';rouletteAnimation?.cancel();rouletteAnimation=null;rouletteKey='';}
  setRoute(next);window.scrollTo({top:0,behavior:'instant'});
  if(next==='home')renderHome();else if(next==='table')renderTable();else if(next==='arcade')renderArcade();else if(['mines','dice','plinko'].includes(next))renderMini(next);else if(next==='wallet')renderWallet();else if(next==='account')renderAccount();else if(next==='admin')renderAdmin();
  pageEnter(app);
}
function cardsCatalog(games){return games.map(g=>`<button class="game-card" data-game="${g}"><div class="game-card-art"><span class="game-badge">${GAMES[g].tag}</span>${smallArt(g)}</div><div class="game-card-info"><h3>${GAMES[g].short}</h3><p>${GAMES[g].note}</p><span class="arrow">↗</span></div></button>`).join('');}
function renderHome(){
  app.innerHTML=`<div class="welcome-line"><span>${me?`Ravi de te revoir, <strong>${esc(me.name)}</strong>.`:'Un club privé. Une vraie partie entre amis.'}</span><span class="tag tag-mint"><i class="live-dot"></i> 100 % fictif</span></div><section class="hero"><div class="hero-copy"><div class="eyebrow">LE PLAISIR DE JOUER ENSEMBLE</div><h1>Le jeu.<br>Les amis.<br><em>Le moment.</em></h1><p>Retrouve ta classe autour d’une table.<br>Du bluff, du suspense. Jamais d’argent réel.</p><div class="hero-buttons"><button class="button button-primary" data-game="poker">Jouer au poker <span>↗</span></button><button class="button button-ghost" data-do="join">Rejoindre <span>→</span></button></div><div class="hero-note"><i></i> ${euro(config.startingBalance??100000)} fictifs à la création du compte</div></div>${heroArt()}</section><div class="section-heading"><div><span class="eyebrow">CHOISIS TON AMBIANCE</span><h2>À quoi joue-t-on ?</h2></div><button class="text-button" data-do="help">Les règles, en 30 secondes ↗</button></div><section class="game-grid">${cardsCatalog(Object.keys(GAMES))}</section><div class="how-strip"><div class="how-item"><span>01</span><div><strong>Installe-toi</strong><p>Un compte, ton solde personnel.</p></div></div><div class="how-item"><span>02</span><div><strong>Invite tes amis</strong><p>Une table, un lien à partager.</p></div></div><div class="how-item"><span>03</span><div><strong>Profite du moment</strong><p>Six jeux. Zéro argent réel.</p></div></div>`;
}
function renderArcade(){app.innerHTML=`<div class="page-heading"><div><span class="eyebrow">LES PETITES PARENTHÈSES</span><h1>L’arcade du club</h1><p>Ton même portefeuille. Trois façons de jouer en solo.</p></div><button class="button button-soft button-small" data-do="help">Comment jouer ?</button></div><section class="game-grid arcade-grid">${cardsCatalog(['mines','dice','plinko'])}</section><p class="notice mint-notice" style="margin-top:24px">Ces jeux utilisent uniquement des euros fictifs. Les probabilités et les multiplicateurs sont indiqués avant de jouer. Pas de mise automatique ni de dépôt.</p>`;}
function authDialog(mode='login'){
  modal(`<span class="eyebrow">BIENVENUE AU CLUB</span><h2>${mode==='login'?'Ta place t’attend.':'On te garde une place.'}</h2><p>Un compte personnel pour retrouver ton solde et tes parties.</p><div class="dialog-tabs"><button class="dialog-tab ${mode==='login'?'active':''}" data-auth="login">Se connecter</button><button class="dialog-tab ${mode==='register'?'active':''}" data-auth="register">Créer mon compte</button></div><form data-form="auth" data-mode="${mode}" class="stack"><div><label for="auth-user">Identifiant</label><input id="auth-user" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,23}" placeholder="Ton identifiant" required></div>${mode==='register'?'<div><label for="auth-name">Pseudo à la table</label><input id="auth-name" name="name" autocomplete="nickname" minlength="2" maxlength="18" placeholder="Comment t’appelle-t-on ?" required></div>':''}<div><label for="auth-password">Mot de passe</label><input id="auth-password" name="password" type="password" autocomplete="${mode==='login'?'current-password':'new-password'}" minlength="10" maxlength="128" placeholder="Au moins 10 caractères" required></div><button class="button button-primary wide">${mode==='login'?'Entrer dans le club':'Créer mon compte'}</button><p class="error-message" role="alert"></p></form><p class="form-note">${mode==='register'?'1 000 € fictifs offerts une seule fois à la création. Aucun paiement. Utilise un mot de passe différent de tes autres comptes.':'Mot de passe oublié ? Demande à l’administrateur de le réinitialiser. Sur un ordinateur partagé, déconnecte-toi en partant.'}</p>`);
}
function setup(game){
  if(['mines','dice','plinko'].includes(game)){requireAccount(()=>navigate(game));return;}
  requireAccount(()=>{
    if(me.activeRoom){if(me.activeRoom.game===game){navigate('table');return;}toast('Quitte ta table actuelle avant d’en créer une autre.');navigate('table');return;}
    modal(`<div class="setup-game-icon">${GAMES[game].icon}</div><span class="eyebrow">PRENDS PLACE</span><h2>${GAMES[game].name}</h2><p>${game==='poker'?'Deux cartes pour toi. Cinq au centre. À toi de jouer.':game==='blackjack'?'Seul ou entre amis, chacun défie le croupier.':'Une vraie roue partagée. Chacun choisit ses mises.'}</p><form data-form="create" data-game="${game}" class="stack"><div><label for="table-mode">Comment veux-tu jouer ?</label><select id="table-mode" name="mode"><option value="private">Créer une table privée · avec mes amis</option><option value="solo">${game==='poker'?'M’entraîner contre des robots':'Jouer en solo'}</option></select></div><div class="field-row"><div><label for="table-buyin">Mon tapis · € fictifs</label><input id="table-buyin" type="number" name="buyIn" min="20" max="2000" step="1" value="${Math.max(20,Math.min(200,Math.floor(me.wallet.available/100)))}" required></div>${game==='poker'?'<div><label for="table-bots">Robots en mode solo</label><select id="table-bots" name="bots"><option value="1">1 robot</option><option value="2">2 robots</option><option value="3" selected>3 robots</option><option value="4">4 robots</option><option value="5">5 robots</option></select></div>':''}</div>${game==='poker'?'<div><label for="poker-mode">Distribution des cartes</label><select id="poker-mode" name="pokerMode"><option value="boost">Mains favorisées · plus d’action</option><option value="classic">Classique · mélange standard</option></select></div><p class="notice">✦ <strong>Mains favorisées</strong> sélectionne une distribution parmi 24 mélanges pour améliorer les mains de départ de l’ensemble de la table. Ce n’est pas la distribution standard. Aucun gagnant n’est choisi et aucune victoire n’est garantie. Tes amis verront et accepteront ce mode.</p>':'<p class="notice mint-notice">Tirage aléatoire côté serveur. Le mode Mains favorisées ne concerne que le poker.</p>'}<p class="form-note">Disponible : <strong>${euro(me.wallet.available)}</strong> fictifs. Ton tapis est transféré, pas dépensé : il revient au portefeuille à la sortie de la table.</p><button class="button button-primary wide">Ouvrir ma table <span>→</span></button><p class="error-message" role="alert"></p></form><button class="text-button" data-do="join">J’ai déjà un code de table →</button>`);
  });
}
function joinDialog(code=pendingInvite??''){
  requireAccount(()=>{modal(`<span class="eyebrow">UNE PLACE POUR TOI</span><h2>Rejoins tes amis.</h2><p>Entre les six caractères de leur table.</p><form data-form="find-room" class="stack"><div><label for="join-code">Code de la table</label><input class="code-input" id="join-code" name="code" maxlength="6" minlength="6" value="${esc(code)}" autocomplete="off" placeholder="ABCDEF" required></div><button class="button button-primary wide">Trouver la table <span>→</span></button><p class="error-message" role="alert"></p></form>`);});
}
function joinConfirm(info){modal(`<span class="eyebrow">${GAMES[info.game].name.toUpperCase()}</span><h2>Table ${esc(info.code)}</h2><p>${info.players} / ${info.capacity} places occupées. ${info.phase==='lobby'?'La partie va bientôt commencer.':'Tu prendras place à la prochaine main.'}</p><form data-form="join" data-code="${esc(info.code)}" class="stack"><div><label for="join-buyin">Mon tapis · € fictifs</label><input id="join-buyin" name="buyIn" type="number" min="20" max="2000" step="1" value="${info.buyIn/100}" required></div>${info.game==='poker'&&info.pokerMode==='boost'?'<p class="notice">✦ <strong>Mode Mains favorisées</strong> : les mains de départ de la table sont favorisées par sélection parmi 24 mélanges. Le tirage n’est donc pas standard, et personne n’est assuré de gagner.</p><label class="checkbox-label"><input type="checkbox" name="acceptBoost" required> J’ai compris et j’accepte ce mode de distribution.</label>':'<p class="notice mint-notice">Distribution classique. Les résultats sont déterminés côté serveur.</p>'}<p class="form-note">Disponible : ${euro(me.wallet.available)} fictifs.</p><button class="button button-primary wide">Prendre ma place <span>→</span></button><p class="error-message" role="alert"></p></form>`);}
function inviteDialog(){if(!state)return;const url=`${siteInfo.publicBaseUrl||location.origin}/?table=${encodeURIComponent(state.code)}`;modal(`<span class="eyebrow">PLUS ON EST, MIEUX ON JOUE</span><h2>Invite ta classe.</h2><p>Ils ouvrent le lien, se connectent et rejoignent ta table.</p><div class="invite-code">${esc(state.code)}</div><label for="invite-link">Lien de la table</label><input readonly id="invite-link" class="invite-link" value="${esc(url)}"><button class="button button-primary wide" style="margin-top:16px" data-do="copy-invite">Copier l’invitation <span>↗</span></button><p class="form-note">Maximum 6 joueurs, robots compris. Le lien contient le code de la table, jamais tes identifiants.</p>`);}

function tableSkeleton(s){
  const roulette=s.game==='roulette';
  app.innerHTML=`<div class="table-heading"><div><span class="eyebrow">${s.solo?'TON ENTRAÎNEMENT':'ENTRE AMIS · TABLE PRIVÉE'}</span><h1>${GAMES[s.game].name}</h1><div class="subline"><span class="tag tag-mint">${s.solo?'Solo':esc(s.code)}</span><span class="tag">€ fictifs</span>${s.game==='poker'?`<span class="tag ${s.pokerMode==='boost'?'tag-gold':''}">${s.pokerMode==='boost'?'✦ Mains favorisées':'Mélange classique'}</span>`:''}</div></div><div class="row">${!s.solo?'<button class="button button-soft button-small" data-do="invite">Inviter <span>↗</span></button>':''}<button class="button button-ghost button-small" data-do="leave">Quitter</button></div></div><div class="table-layout"><section class="table-surface"><div class="table-topline"><strong>CLUB ROYAL <span class="brand-star">✦</span></strong><span id="table-phase"></span><span id="hand-number"></span></div>${roulette?rouletteSkeleton():`<div class="table-stage ${s.game==='blackjack'?'blackjack-stage':''}"><div class="table-felt"><span class="felt-label">CLUB ROYAL · PLAY TOGETHER</span></div>${s.game==='poker'?'<div class="board-area"><div class="pot-display"><span class="mini-chip"></span><div><small>POT DE LA TABLE</small><strong id="table-pot"></strong></div></div><div id="board-cards" class="board-cards cards-line"></div><div class="board-description" id="board-description"></div></div>':'<div class="dealer-area"><div class="dealer-label">LE CROUPIER <span>· S17</span></div><div id="dealer-cards" class="cards-line"></div><div class="dealer-score" id="dealer-total"></div></div><div class="board-description" id="board-description">BLACKJACK 3:2 · LE CROUPIER RESTE À 17</div>'}<div class="empty-table-copy" id="table-empty"><strong>La table est à toi.</strong><p>Invite tes amis ou ajoute un robot.<br>La prochaine main vous attend.</p></div><div id="seats"></div></div>`}<div class="timer-track"><i id="timer-progress"></i></div><div id="table-actions" class="table-actions"></div></section><aside class="table-side"><section class="side-panel invite-panel"><span class="eyebrow">${s.solo?'MODE SOLO':'TA TABLE PRIVÉE'}</span><div class="room-code">${s.solo?'À ton rythme':esc(s.code)}</div><p>${s.solo?'Prends le temps de découvrir les règles.':'Partage le lien pour retrouver tes amis.'}</p>${!s.solo?'<button class="button button-soft button-small wide" data-do="invite">Copier l’invitation ↗</button>':''}</section><section class="side-panel"><h3>Ton tapis <span class="muted">· fictif</span></h3><div class="side-row"><span>À la table</span><strong id="my-table-balance"></strong></div><div class="side-row"><span>Disponible hors table</span><strong id="my-wallet-balance"></strong></div><button class="button button-ghost button-small wide" id="topup-button" data-do="topup">Ajouter au tapis</button><p class="form-note">Un transfert, pas un deuxième solde indépendant.</p></section><section class="side-panel" id="table-results-panel" hidden><h3>Cette main</h3><div id="table-results" class="result-list"></div></section><section class="side-panel logs-panel"><h3>À la table</h3><div id="table-logs" class="log-list"></div></section><section class="side-panel room-rules"><h3>Le détail qui compte</h3><p>${s.game==='poker'?(s.pokerMode==='boost'?'Mains de départ favorisées pour l’ensemble des joueurs. Pas de gagnant imposé.':'52 cartes, mélange standard. Tes deux cartes restent privées jusqu’à l’abattage.') :s.game==='blackjack'?'Le croupier reste à 17, même souple. Un dépassement perd immédiatement. Un blackjack naturel paie 3:2.':'Roulette européenne, un seul zéro. Aucun multiplicateur caché. La roue n’est pas influencée par ton solde.'}</p><button class="text-button" data-do="help" style="margin-top:10px">Toutes les règles ↗</button></section></aside></div>`;
}
function renderTable(){
  const s=state;if(!s){tableKey='';app.innerHTML=`<div class="page-heading"><div><span class="eyebrow">TON PROCHAIN MOMENT</span><h1>Une nouvelle table ?</h1><p>Ta dernière table est fermée ou tu l’as quittée.</p></div></div><p class="notice">Les tapis sont rendus au portefeuille à la fin de la main. Un redémarrage annule la main inachevée et restitue le dernier tapis réglé.</p><section class="game-grid" style="margin-top:24px">${cardsCatalog(['poker','blackjack','roulette'])}</section>`;return;}
  const key=`${s.code}:${s.game}`;if(tableKey!==key){tableSkeleton(s);tableKey=key;rouletteDraft=[];rouletteKey='';}
  const self=s.players.find(p=>p.id===s.you),between=['lobby','results'].includes(s.phase);
  $('#table-phase').textContent=PHASE[s.phase]||s.phase;$('#hand-number').textContent=s.handId?`MAIN ${String(s.handId).padStart(2,'0')}`:'PRÊT À JOUER';
  $('#my-table-balance').textContent=euro(self?.stack??0);$('#my-wallet-balance').textContent=euro(me?.wallet.available??0);$('#topup-button').disabled=!between;
  $('#table-results-panel').hidden=s.phase!=='results';
  $('#table-results').innerHTML=(s.results??[]).map(r=>`<div class="result-item"><div><strong>${esc(r.name)}</strong><small>${esc(r.label)}</small></div><b class="${r.net>0?'positive-text':r.net<0?'negative-text':''}">${signedEuro(r.net)}</b></div>`).join('');
  $('.logs-panel').hidden=!s.logs.length;$('#table-logs').innerHTML=s.logs.slice(-6).reverse().map(l=>`<p>${esc(l)}</p>`).join('');
  let flipWait=0;
  if(s.game==='roulette')flipWait=patchRoulette(s);
  else{
    $('#table-empty').hidden=s.phase!=='lobby';
    if(s.game==='poker'){
      $('#board-cards').hidden=s.phase==='lobby';$('.pot-display').hidden=s.phase==='lobby';
      $('#table-pot').textContent=euro(s.pot);
      flipWait=patchCards($('#board-cards'),s.board,`${s.code}:${s.handId}:board`,{stagger:160,placeholders:5});
      $('#board-description').textContent=s.phase==='lobby'?'':s.yourCombination?`TA MAIN · ${s.yourCombination.toUpperCase()}`:`BLINDES ${euro(s.smallBlind)} / ${euro(s.bigBlind)}`;
    }else{
      $('.dealer-area').hidden=!s.dealerCards.length;
      flipWait=patchCards($('#dealer-cards'),s.dealerCards,`${s.code}:${s.handId}:dealer`,{stagger:190});
      $('#dealer-total').textContent=s.dealerTotal===null?'Carte cachée':`Total : ${s.dealerTotal}`;
    }
    const positions={1:[0],2:[0,3],3:[0,2,4],4:[0,2,3,4],5:[0,1,2,4,5],6:[0,1,2,3,4,5]};
    const sorted=[...s.players].sort((a,b)=>a.seat-b.seat);const you=sorted.findIndex(p=>p.id===s.you);const ordered=[...sorted.slice(you),...sorted.slice(0,you)];
    const seatRoot=$('#seats');const valid=new Set(ordered.map(p=>p.id));for(const n of [...seatRoot.children])if(!valid.has(n.dataset.player))n.remove();
    ordered.forEach((p,i)=>{
      let seat=$(`[data-player="${p.id}"]`,seatRoot);
      if(!seat){seat=document.createElement('div');seat.dataset.player=p.id;seat.innerHTML='<div class="seat-cards cards-line"></div><div class="seat-plate"><span class="seat-name"></span><strong class="seat-stack"></strong><span class="seat-badge" hidden></span><span class="seat-badge dealer" hidden>D</span><span class="seat-bet" hidden></span><span class="seat-total" hidden></span></div><div class="seat-action"></div>';seatRoot.append(seat);}
      seat.className=`seat seat-pos-${positions[ordered.length]?.[i]??0} ${p.id===s.you?'self':''} ${s.turn===p.id?'active':''} ${p.result&&p.payout>0&&s.phase==='results'?'winner':''} ${p.folded?'folded':''}`;
      $('.seat-name',seat).textContent=`${p.name}${p.id===s.you?' · toi':''}`;$('.seat-stack',seat).textContent=euro(p.stack);
      const badge=$('.seat-badge:not(.dealer)',seat);badge.hidden=!p.bot&&p.connected;badge.textContent=p.bot?'ROBOT':'HORS LIGNE';
      $('.dealer',seat).hidden=!(s.game==='poker'&&p.seat===s.dealerSeat&&s.phase!=='lobby');
      const stake=s.game==='poker'?p.streetBet:p.bjBet;$('.seat-bet',seat).hidden=!stake;$('.seat-bet',seat).textContent=euro(stake);
      $('.seat-action',seat).textContent=p.leaving?'Quitte après cette main':p.allIn?'TAPIS':p.lastAction||(!p.inHand&&s.phase!=='lobby'?'Prochaine main':'Prêt');
      $('.seat-total',seat).hidden=s.game!=='blackjack'||p.bjTotal===null;$('.seat-total',seat).textContent=p.bjTotal??'';
      flipWait=Math.max(flipWait,patchCards($('.seat-cards',seat),p.cards,`${s.code}:${s.handId}:${p.id}`,{delay:p.id===s.you?100:0,stagger:190}));
    });
  }
  renderActions(s,self);updateClock();
  const turnKey=`${s.code}/${s.handId}/${s.turnSeq}/${s.turn}`;if(s.turn===s.you&&lastTurn!==turnKey){tone('turn');}lastTurn=turnKey;
  if(s.phase==='results'){
    const result=s.results.find(r=>r.id===s.you),overlayKey=`cr-result:${me?.id}:${s.code}:${s.handId}`;
    let seen;try{seen=sessionStorage.getItem(overlayKey);}catch{}
    if(result&&!seen&&!seenResults.has(overlayKey)){seenResults.add(overlayKey);try{sessionStorage.setItem(overlayKey,'1');}catch{}clearTimeout(resultTimeout);const expected=tableKey;resultTimeout=setTimeout(()=>{if(route==='table'&&tableKey===expected&&state?.phase==='results')resultOverlay({title:result.net>0?'BIEN JOUÉ !':result.net===0?'ÉGALITÉ':'MAIN TERMINÉE',amount:result.net,label:`${result.label} · gain net fictif`});},Math.max(200,flipWait+180));}
  }
}
function renderActions(s,p){
  const area=$('#table-actions');const owner=s.you===s.ownerId,between=['lobby','results'].includes(s.phase),myTurn=s.turn===s.you;
  // Preserve typed amounts while an unrelated wallet update arrives.
  const oldRaise=$('#raise-amount');if(oldRaise)ui.raise=Number(oldRaise.value)*100;
  const oldBet=$('#bj-bet');if(oldBet)ui.bet=Number(oldBet.value)*100;
  let controls='',context='';
  if(between){context=s.phase==='results'?'La main est terminée. On rejoue ?':owner?'Ta table est prête.':'L’hôte va lancer la partie.';controls=owner?`<button class="button button-primary" data-action="start" ${s.game==='poker'&&s.players.filter(x=>!x.leaving&&x.stack>0).length<2?'disabled':''}>${s.phase==='results'?'Main suivante':'Distribuer / commencer'} <span>→</span></button>${s.players.length<6?'<button class="button button-soft" data-action="addBot">+ Robot</button>':''}${s.players.some(x=>x.bot)?'<button class="button button-ghost" data-action="removeBot">− Robot</button>':''}`:'<p class="table-status">Attends que l’hôte lance la prochaine main.</p>';}
  else if(s.game==='poker'&&myTurn&&s.legal){
    const l=s.legal;context=s.yourCombination?`À toi · ${s.yourCombination}`:'À toi de jouer';
    controls=`<button class="button button-ghost" data-action="fold">Se coucher</button>${l.check?'<button class="button button-mint" data-action="check">Parole</button>':`<button class="button button-mint" data-action="call" ${!l.call?'disabled':''}>Suivre ${euro(Math.min(l.owed,p.stack))}</button>`}${l.raise?'<button class="button button-primary" data-action="raise">Relancer</button>':''}${l.allIn?'<button class="button button-soft" data-action="allIn">Tapis</button>':''}`;
    if(l.raise){const amount=Math.max(l.minRaise,Math.min(l.maxRaise,ui.raise||l.minRaise));controls+=`<div class="raise-control wide"><div><label for="raise-slider">Relancer à · mise totale de ce tour</label><input id="raise-slider" type="range" min="${l.minRaise/100}" max="${l.maxRaise/100}" step="0.01" value="${amount/100}"></div><div><label for="raise-amount">€ fictifs</label><input id="raise-amount" type="number" min="${l.minRaise/100}" max="${l.maxRaise/100}" step="0.01" value="${amount/100}"></div></div>`;}
  }else if(s.game==='blackjack'&&s.phase==='betting'&&p.inHand&&!p.betReady){
    context='Choisis ta mise. Tu joues contre le croupier.';
    const bet=Math.max(500,Math.min(20000,Math.floor(p.stack/500)*500,ui.bet));
    controls=`<div class="bet-preset-row">${[500,1000,2500,5000].map(n=>`<button class="bet-preset ${n===bet?'selected':''}" data-bjbet="${n}" ${n>p.stack?'disabled':''}>${euro(n)}</button>`).join('')}</div><div class="row"><label for="bj-bet" class="muted">€</label><input id="bj-bet" aria-label="Mise blackjack en euros fictifs" type="number" min="5" max="${Math.min(200,Math.floor(p.stack/500)*5)}" step="5" value="${bet/100}" style="width:96px"><button class="button button-primary" data-action="bet">Miser</button></div>`;
  }else if(s.game==='blackjack'&&myTurn&&s.legal){context=`À toi · ${p.bjTotal} points`;controls=`<button class="button button-primary" data-action="hit">Tirer une carte</button><button class="button button-mint" data-action="stand">Rester</button><button class="button button-soft" data-action="double" ${!s.legal.double?'disabled':''}>Doubler</button>`;}
  else if(s.game==='roulette'&&s.phase==='betting'&&p.inHand&&!p.betReady){context='Place tes jetons sur le tapis, puis confirme.';const total=rouletteDraft.reduce((n,b)=>n+b.amount,0);controls=`<button class="button button-primary" data-action="rouletteBet" ${!total?'disabled':''}>Confirmer ${euro(total)} <span>→</span></button><span class="table-status">Les mises sont verrouillées après confirmation.</span>`;}
  else{context=s.game==='roulette'&&s.phase==='spinning'?'Rien ne va plus. La bille suit son chemin.':s.phase==='betting'?'Ta mise est confirmée. Patiente…':s.turn?`Au tour de ${s.players.find(x=>x.id===s.turn)?.name??'ton partenaire'}`:'La main continue…';controls=`<p class="table-status">${p.inHand?'Observe la table. Ton prochain moment arrive.':'Tu participeras à la prochaine main.'}</p>`;}
  area.innerHTML=`<div class="action-context"><strong>${esc(context)}</strong><span class="turn-time" id="turn-time"></span></div><div class="action-buttons">${controls}</div>`;
  if(requestBusy)$$('button',area).forEach(b=>b.disabled=true);
}
function updateClock(){if(route!=='table'||!state)return;const n=Math.max(0,Math.ceil((state.deadline-(Date.now()+clockOffset))/1000));const el=$('#turn-time');if(el)el.textContent=state.deadline&&n?`${n} s`:'';const bar=$('#timer-progress');if(bar)bar.style.transform=`scaleX(${state.deadline?Math.min(1,n/25):0})`;}
setInterval(updateClock,250);
function topupDialog(){modal(`<span class="eyebrow">UN SEUL PORTEFEUILLE</span><h2>Ajouter au tapis.</h2><p>Disponible : ${euro(me.wallet.available)} fictifs. Le transfert est possible entre deux mains.</p><form data-form="topup" class="stack"><div><label for="topup-amount">Montant en € fictifs</label><input id="topup-amount" name="amount" type="number" min="10" max="2000" step="1" value="100" required></div><button class="button button-primary">Transférer au tapis</button><p class="error-message" role="alert"></p></form>`);}
function leaveDialog(){modal(`<span class="eyebrow">À BIENTÔT À LA TABLE</span><h2>Tu quittes la partie ?</h2><p>${['lobby','results'].includes(state?.phase)?'Ton tapis revient immédiatement au portefeuille.':'La main en cours sera terminée automatiquement pour toi, puis le tapis restant te sera rendu. Quitter n’annule pas les pertes.'}</p><div class="button-bar"><button class="button button-ghost" data-do="close">Rester</button><button class="button button-primary" data-do="confirm-leave">Quitter la table</button></div>`);}

function rouletteSkeleton(){return `<div class="roulette-stage"><div class="roulette-layout"><div><div class="roulette-visual"><div class="roulette-wheel"><span class="wheel-pointer"></span><span class="wheel-ball"></span><div class="wheel-rotor">${wheelSVG()}</div><div class="wheel-number"><small id="wheel-label">LE CLUB</small><strong id="wheel-value">R</strong></div></div></div><div class="roulette-history" id="roulette-history"></div><p class="roulette-description">ROULETTE EUROPÉENNE · UN SEUL ZÉRO</p></div><div class="roulette-hud"><span class="eyebrow">LE TOUR EN COURS</span><div class="roulette-total"><small>MISES DE LA TABLE</small><strong id="roulette-total">0 €</strong></div><div class="roulette-player-list" id="roulette-players"></div><p class="form-note">Les mises restent personnelles.<br>La roue, elle, est la même pour tous.</p></div></div><div class="roulette-bets"><div class="roulette-bets-header"><strong>Place tes jetons</strong><span id="roulette-draft-total"></span></div><div class="roulette-chiprow">${[100,500,1000,2500].map(n=>`<button data-rchip="${n}" class="${n===rouletteChip?'selected':''}" aria-label="Jeton de ${n/100} euros fictifs">${n/100}</button>`).join('')}<button class="text-button" data-do="roulette-clear">Effacer les mises</button></div><div class="number-grid"><button class="number-bet zero" data-rbet="straight" data-selection="0">0<small></small></button>${[3,2,1].flatMap(start=>Array.from({length:12},(_,i)=>start+i*3)).map(n=>`<button class="number-bet ${color(n)}" data-rbet="straight" data-selection="${n}">${n}<small></small></button>`).join('')}</div><div class="outside-grid">${[1,2,3].map(d=>`<button class="outside-bet dozen" data-rbet="dozen" data-selection="${d}">${d===1?'1–12':d===2?'13–24':'25–36'} <small>×3</small></button>`).join('')}${[['low','1–18'],['even','Pair'],['red','Rouge'],['black','Noir'],['odd','Impair'],['high','19–36']].map(([t,n])=>`<button class="outside-bet ${t==='red'?'red':''}" data-rbet="${t}">${n} <small>×2</small></button>`).join('')}</div><p class="form-note">Numéro plein ×36 · douzaine ×3 · chance simple ×2. Multiplicateurs = mise incluse. Le zéro fait perdre les chances simples. Maximum 200 € fictifs par tour.</p></div></div>`;}
function patchRoulette(s){
  const self=s.players.find(p=>p.id===s.you),handKey=`${s.code}:${s.handId}`;let wait=0;
  if($('#roulette-draft-total').dataset.hand!==handKey){rouletteDraft=[];$('#roulette-draft-total').dataset.hand=handKey;}
  $('#roulette-total').textContent=euro(s.pot);$('#roulette-players').innerHTML=s.players.map(p=>`<div class="roulette-player"><strong>${esc(p.name)}${p.bot?' · robot':''}</strong><small>${p.betReady?euro(p.totalBet):p.inHand?'Choisit ses mises':'En attente'}</small></div>`).join('');
  $('#roulette-history').innerHTML=(s.rouletteHistory??[]).map(entry=>{const n=typeof entry==='number'?entry:entry.number;return `<span class="${color(n)}">${n}</span>`;}).join('');
  const animateKey=`${handKey}:${s.phase}`;
  if(rouletteKey!==animateKey){
    const rotor=$('.wheel-rotor');
    if(s.phase==='spinning'){
      rouletteAnimation?.cancel();rotor.style.transform='rotate(0deg)';$('#wheel-label').textContent='SUSPENSE';$('#wheel-value').textContent='…';
      if(motionMs())rouletteAnimation=rotor.animate([{transform:'rotate(0deg)'},{transform:'rotate(720deg)'}],{duration:2000,iterations:Infinity,easing:'linear'});
    }else if(s.phase==='results'&&s.winningNumber!==null){
      let angle=0;try{const m=new DOMMatrixReadOnly(getComputedStyle(rotor).transform);angle=Math.atan2(m.b,m.a)*180/Math.PI;}catch{}
      rouletteAnimation?.cancel();const target=(360-WHEEL.indexOf(s.winningNumber)*360/37)%360;const finish=angle+720+((target-angle)%360+360)%360;
      wait=motionMs()?2000:0;rotor.style.transform=`rotate(${target}deg)`;
      if(wait)rouletteAnimation=rotor.animate([{transform:`rotate(${angle}deg)`},{transform:`rotate(${finish}deg)`}],{duration:wait,easing:'cubic-bezier(.18,.65,.15,1)'});
      const expected=s.handId;setTimeout(()=>{if(route==='table'&&state?.handId===expected&&$('#wheel-value')){$('#wheel-value').textContent=s.winningNumber;$('#wheel-label').textContent=color(s.winningNumber)==='red'?'ROUGE':s.winningNumber===0?'ZÉRO':'NOIR';}},wait);
    }else if(s.phase==='lobby'||s.phase==='betting'){rouletteAnimation?.cancel();$('#wheel-value').textContent='R';$('#wheel-label').textContent=s.phase==='betting'?'FAITES VOS JEUX':'LE CLUB';}
    rouletteKey=animateKey;
  }
  const canBet=s.phase==='betting'&&self.inHand&&!self.betReady&&!requestBusy;
  const bets=self.betReady?self.rouletteBets:rouletteDraft;
  $('#roulette-draft-total').textContent=`${self.betReady?'Confirmé':'Ta sélection'} : ${euro(bets.reduce((n,b)=>n+b.amount,0))}`;
  $$('[data-rbet]').forEach(b=>{b.disabled=!canBet;const selected=bets.find(x=>x.type===b.dataset.rbet&&String(x.selection??'')===String(b.dataset.selection??''));b.classList.toggle('selected',!!selected);b.title=selected?`Misé : ${euro(selected.amount)}`:'Ajouter le jeton sélectionné';if(b.classList.contains('number-bet'))$('small',b).textContent=selected?selected.amount/100:'';});
  $$('[data-rchip]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.rchip)===rouletteChip);b.disabled=!canBet;});$('[data-do="roulette-clear"]').disabled=!canBet;
  return wait;
}
function addRouletteBet(button){
  if(requestBusy)return;const p=state.players.find(x=>x.id===state.you),total=rouletteDraft.reduce((n,b)=>n+b.amount,0);
  if(total+rouletteChip>Math.min(20000,p.stack)){toast('Tu ne peux pas dépasser 200 € fictifs ou ton tapis.',true);return;}
  const type=button.dataset.rbet,selection=button.dataset.selection===undefined?undefined:Number(button.dataset.selection);let b=rouletteDraft.find(x=>x.type===type&&x.selection===selection);
  if(!b){if(rouletteDraft.length>=25){toast('Maximum 25 positions différentes par tour.',true);return;}b={type,...(selection!==undefined?{selection}:{}),amount:0};rouletteDraft.push(b);}b.amount+=rouletteChip;tone('click');patchRoulette(state);renderActions(state,p);
}

function miniHeading(game){return `<div class="page-heading"><div><span class="eyebrow">L’ARCADE DU CLUB · SOLO</span><h1>${GAMES[game].name}</h1><p>${GAMES[game].note} Uniquement des euros fictifs.</p></div><button class="button button-soft button-small" data-do="help">Les règles ↗</button></div>`;}
function stakeControl(value=ui.miniStake){return `<div><label for="mini-stake">Mise · € fictifs</label><input id="mini-stake" type="number" min="1" max="200" step="0.01" value="${value/100}"><div class="bet-preset-row" style="margin-top:9px">${[500,1000,2500].map(n=>`<button class="bet-preset" data-minibet="${n}">${euro(n)}</button>`).join('')}</div></div>`;}
function renderMini(game){
  const m=me?.mines;
  let controls=stakeControl(game==='mines'&&m?.status==='playing'?m.stake:ui.miniStake),stage='';
  if(game==='mines'){
    controls+=`<div><label for="mine-count">Mines cachées</label><select id="mine-count">${[1,3,5].map(n=>`<option value="${n}" ${n===(m?.status==='playing'?m.mineCount:ui.mineCount)?'selected':''}>${n} mine${n>1?'s':''} · ${25-n} cristaux</option>`).join('')}</select></div><div class="control-stat"><span>Gain récupérable</span><b id="mines-return">0,00 €</b></div><div class="control-stat"><span>Au prochain cristal</span><strong id="mines-next">—</strong></div><div class="game-controls-full"><button id="mines-start" class="button button-primary wide" data-do="mines-start">Commencer l’exploration</button><button id="mines-cashout" class="button button-mint wide" data-do="mines-cashout" hidden>Récupérer</button><button id="mines-cancel" class="text-button" data-do="mines-cancel" style="margin-top:12px" hidden>Annuler avant de révéler</button></div><p class="odds-note game-controls-full">Les mines sont fixées avant le premier clic. Elles ne se déplacent jamais. Récupère tes gains avant de toucher une mine. Retour théorique 97 % avant arrondi des centimes, pas une promesse sur ta session.</p>`;
    stage=`<div class="game-stage"><div class="game-stage-header"><strong>CRISTAUX <span>✦</span></strong><span id="mines-status">25 CASES · À TOI D’EXPLORER</span></div><div class="mines-grid" id="mines-grid">${Array.from({length:25},(_,i)=>`<button class="mines-cell" data-cell="${i}" aria-label="Révéler la case ${i+1}"><span class="mine-rotor"><span class="mine-face mine-back">✦</span><span class="mine-face mine-front">${gemSVG()}</span></span></button>`).join('')}</div><p class="mines-caption" id="mines-caption">Choisis ta mise. Les cristaux n’attendent que toi.</p></div>`;
  }else if(game==='dice'){
    controls+=`<div><label for="dice-chance">Probabilité de gagner · <strong id="chance-value">${ui.chance} %</strong></label><input id="dice-chance" type="range" min="10" max="90" step="1" value="${ui.chance}"></div><div class="control-stat"><span>Multiplicateur · mise incluse</span><b id="dice-multiplier">${(97/ui.chance).toFixed(2)}×</b></div><div class="game-controls-full"><button class="button button-primary wide" id="dice-play" data-do="dice-play">Lancer le dé <span>↗</span></button></div><p class="odds-note game-controls-full">Un nombre uniforme de 0,00 à 99,99. Gagné s’il est strictement inférieur à ta probabilité. Multiplicateur exact : 97 / probabilité. Le cube est décoratif, le résultat n’est pas celui d’un dé à six faces.</p>`;
    stage=`<div class="game-stage"><div class="game-stage-header"><strong>DICE <span>✦</span></strong><span>TON SEUIL, TON LANCER</span></div><div class="dice-center"><div class="dice-platform"></div>${dieHTML()}</div><div class="dice-result"><strong id="dice-value">—</strong><p id="dice-message">Le prochain lancer t’appartient.</p></div><div class="dice-rule"><i id="dice-rule-fill" style="width:${ui.chance}%"></i><b id="dice-marker" style="left:50%"></b></div><div class="dice-rule-labels"><span>0,00</span><span id="dice-threshold">Gagne en dessous de ${ui.chance}</span><span>99,99</span></div></div>`;
  }else{
    controls+=`<div class="control-stat"><span>Niveaux</span><b>12</b></div><div class="control-stat"><span>Directions par rebond</span><strong>50 % / 50 %</strong></div><div class="game-controls-full"><button id="plinko-play" class="button button-primary wide" data-do="plinko-play">Lâcher la bille <span>↓</span></button></div><p class="odds-note game-controls-full">Chaque rebond est tiré côté serveur. Les cases du centre sont plus fréquentes. Les multiplicateurs affichés incluent ta mise et sont arrondis pour la lecture ; le paiement utilise leur valeur exacte. Retour théorique 97 % avant arrondi des centimes.</p>`;
    stage=`<div class="game-stage plinko-stage"><div class="game-stage-header"><strong>PLINKO <span>✦</span></strong><span>UN PETIT MOMENT SUSPENDU</span></div>${plinkoSVG(config.plinkoMultipliers||Array(13).fill(1))}<p class="mines-caption" id="plinko-caption">Douze rebonds. Une seule destination.</p></div>`;
  }
  app.innerHTML=`${miniHeading(game)}<div class="arcade-layout"><aside class="game-controls"><header class="game-controls-full"><span class="eyebrow">À TON RYTHME</span><h2>${GAMES[game].short}</h2></header>${controls}</aside>${stage}</div><div class="arcade-history"><span class="eyebrow">TES DERNIERS TOURS</span><div id="mini-history" class="row"></div></div>`;
  if(game==='mines'){lastMinesId='';patchMines();}renderMiniHistory();
}
function renderMiniHistory(){const el=$('#mini-history');if(el)el.innerHTML=miniHistory.filter(h=>h.game===route).slice(-6).reverse().map(h=>`<span class="mini-history-pill ${h.net<0?'loss':''}">${signedEuro(h.net)}</span>`).join('')||'<span class="muted" style="font-size:11px">L’historique complet est dans ton portefeuille.</span>';}
function patchMines(){
  if(route!=='mines'||!$('#mines-grid'))return;const m=me?.mines,active=m?.status==='playing';
  if(m&&lastMinesId!==m.id){$$('[data-cell]').forEach(b=>{b.className='mines-cell';$('.mine-front',b).innerHTML=gemSVG();});lastMinesId=m.id;}
  $$('[data-cell]').forEach(b=>{const i=Number(b.dataset.cell),revealed=m?.revealed.includes(i),mine=m?.mines?.includes(i);b.disabled=!active||revealed||minesBusy;b.classList.toggle('revealed',!!revealed||!!mine);b.classList.toggle('mine',!!mine);if(mine)$('.mine-front',b).textContent='✹';b.setAttribute('aria-label',mine?`Mine · case ${i+1}`:revealed?`Cristal · case ${i+1}`:`Révéler la case ${i+1}`);});
  $('#mines-start').hidden=active;$('#mines-start').disabled=minesBusy;$('#mines-start').textContent=m?'Nouvelle exploration':'Commencer l’exploration';
  $('#mines-cashout').hidden=!active;$('#mines-cashout').disabled=minesBusy||!m?.revealed.length;$('#mines-cashout').textContent=`Récupérer ${euro(m?.availableReturn??0)}`;
  $('#mines-cancel').hidden=!active||m.revealed.length>0;$('#mines-cancel').disabled=minesBusy;
  $('#mini-stake').disabled=active||minesBusy;$('#mine-count').disabled=active||minesBusy;$$('[data-minibet]').forEach(b=>b.disabled=active||minesBusy);
  $('#mines-return').textContent=euro(active?m.availableReturn:m?.payout??0);$('#mines-next').textContent=active&&m.nextReturn?euro(m.nextReturn):'—';
  $('#mines-status').textContent=active?`${m.revealed.length} ${m.revealed.length>1?'CRISTAUX RÉVÉLÉS':'CRISTAL RÉVÉLÉ'}`:m?.status==='lost'?'UNE MINE · FIN DE L’EXPLORATION':m?.status==='won'?'GAINS RÉCUPÉRÉS':'25 CASES · À TOI D’EXPLORER';
  $('#mines-caption').textContent=active?'Clique sur une case ou récupère tes gains.':m?.status==='lost'?'La mise est perdue. Les mines apparaissent maintenant.':m?.status==='won'?`Retour : ${euro(m.payout)} fictifs, mise incluse.`:'Les mines restent au même endroit du début à la fin.';
}
async function minesAction(type,cell){
  if(minesBusy)return;minesBusy=true;
  try{let msg={type};if(type==='start'){ui.miniStake=moneyInput($('#mini-stake').value,100,20000);ui.mineCount=Number($('#mine-count').value);Object.assign(msg,{stake:ui.miniStake,mineCount:ui.mineCount});}else Object.assign(msg,{gameId:me.mines.id,...(cell!==undefined?{cell}:{})});
    patchMines();const r=await api('/api/mines',msg);tone('card');
    if(r.status!=='playing'){const net=r.payout-r.stake;miniHistory.push({game:'mines',net});renderMiniHistory();setTimeout(()=>{if(route==='mines'&&me?.mines?.id===r.id)resultOverlay({title:r.status==='won'?'CRISTAUX RÉCUPÉRÉS':r.status==='cancelled'?'MISE RESTITUÉE':'UNE MINE !',amount:net,label:'Résultat net · euros fictifs'});},motionMs()+80);}
  }finally{minesBusy=false;patchMines();}
}
async function playDice(){
  if(diceBusy)return;ui.miniStake=moneyInput($('#mini-stake').value,100,20000);ui.chance=Number($('#dice-chance').value);diceBusy=true;$('#dice-play').disabled=true;$('#dice-chance').disabled=true;$('#mini-stake').disabled=true;
  try{const r=await api('/api/instant',{game:'dice',stake:ui.miniStake,chance:ui.chance});const duration=motionMs()?1350:0;
    const cube=$('.dice-center .die-cube');if(duration)cube.animate([{transform:'rotateX(-20deg) rotateY(30deg)'},{transform:'rotateX(700deg) rotateY(1110deg)'}],{duration,easing:'cubic-bezier(.15,.65,.2,1)'});tone('card');await sleep(duration);
    if(route==='dice'){$('#dice-value').textContent=(r.roll/100).toLocaleString('fr-FR',{minimumFractionDigits:2});$('#dice-message').textContent=r.won?`Gagné · retour ${euro(r.payout)} fictifs, mise incluse.`:'Au-dessus du seuil. La mise est perdue.';$('#dice-marker').style.left=`${r.roll/100}%`;resultOverlay({title:r.won?'LE BON LANCER !':'LANCER TERMINÉ',amount:r.net});miniHistory.push({game:'dice',net:r.net});renderMiniHistory();}
  }finally{diceBusy=false;if(route==='dice'){$('#dice-play').disabled=false;$('#dice-chance').disabled=false;$('#mini-stake').disabled=false;}}
}
async function playPlinko(){
  if(plinkoBusy)return;ui.miniStake=moneyInput($('#mini-stake').value,100,20000);plinkoBusy=true;$('#plinko-play').disabled=true;
  try{const r=await api('/api/instant',{game:'plinko',stake:ui.miniStake});const ball=$('#plinko-ball'),frames=[{transform:'translate(320px, 20px)',offset:0},{transform:'translate(320px, 50px)',offset:1/14}];let right=0;
    r.path.forEach((step,i)=>{right+=step;frames.push({transform:`translate(${320+(right-(i+1)/2)*36}px, ${50+(i+1)*25}px)`,offset:(i+2)/14});});frames.push({transform:`translate(${104+r.bucket*36}px, 385px)`,offset:1});
    $$('[data-bucket]').forEach(el=>el.classList.remove('landed'));const duration=motionMs()?2300:0;ball.style.transform=frames.at(-1).transform;if(duration)await ball.animate(frames,{duration,easing:'linear'}).finished;tone('card');
    if(route==='plinko'){$(`[data-bucket="${r.bucket}"]`).classList.add('landed');$('#plinko-caption').textContent=`${r.multiplier.toFixed(3)}× · retour ${euro(r.payout)} fictifs, mise incluse.`;resultOverlay({title:r.net>0?'JOLI REBOND !':'LA BILLE EST ARRIVÉE',amount:r.net});miniHistory.push({game:'plinko',net:r.net});renderMiniHistory();}
  }finally{plinkoBusy=false;if(route==='plinko')$('#plinko-play').disabled=false;}
}

function walletCards(){return `<div class="wallet-summary"><section class="balance-card"><span class="eyebrow">TON PORTEFEUILLE</span><small>DISPONIBLE · EUROS FICTIFS</small><strong id="wallet-available">${euro(me.wallet.available)}</strong><p>Pour tous les jeux du club, sans paiement.</p></section><section class="balance-card secondary"><small>ENGAGÉ EN PARTIE</small><strong id="wallet-inplay">${euro(me.wallet.inPlay)}</strong><p>Tapis réglé à la dernière main + mise Cristaux.</p></section><section class="balance-card secondary"><small>TOTAL DE RÉFÉRENCE</small><strong id="wallet-total">${euro(me.wallet.total)}</strong><p>Disponible + engagé. Les mises en cours ne sont pas encore réglées.</p></section></div>`;}
function patchWalletSummary(){if(!me)return;for(const[k,idName]of[['available','wallet-available'],['inPlay','wallet-inplay'],['total','wallet-total']]){const n=$(`#${idName}`);if(n)n.textContent=euro(me.wallet[k]);}if($('#refill-button'))$('#refill-button').hidden=!me.canRefill;}
function historyTable(entries){return entries.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Opération</th><th>Portefeuille</th><th>Tapis / engagé</th></tr></thead><tbody>${entries.map(x=>`<tr><td>${dt(x.at)}</td><td><strong>${esc(x.label)}</strong><small>${x.game?GAMES[x.game]?.short??x.game:'Club Royal'}${x.reference?` · ${esc(x.reference)}`:''}</small></td><td class="amount ${x.walletDelta>0?'positive-text':x.walletDelta<0?'negative-text':''}">${x.walletDelta?signedEuro(x.walletDelta):'—'}</td><td class="amount ${x.tableDelta>0?'positive-text':x.tableDelta<0?'negative-text':''}">${x.tableDelta?signedEuro(x.tableDelta):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="history-empty">Aucune opération sur cette page.</p>';}
async function renderWallet(){
  app.innerHTML=`<div class="page-heading"><div><span class="eyebrow">TES EUROS, TOUJOURS FICTIFS</span><h1>Un seul portefeuille.</h1><p>Le même solde pour le poker, le blackjack, la roulette et l’arcade.</p></div><button class="button button-soft button-small" data-do="wallet-refresh">Actualiser ↻</button></div>${walletCards()}<p class="notice mint-notice" style="margin-bottom:24px">Les montants sont fictifs et ne peuvent pas être achetés, échangés ou retirés. Un transfert vers une table ne constitue pas une perte. Le résultat de la main est enregistré séparément.</p><button id="refill-button" class="button button-primary" data-do="refill" ${me.canRefill?'':'hidden'} style="margin-bottom:20px">Recevoir 1 000 € fictifs de secours</button><section class="panel"><div class="section-heading"><div><span class="eyebrow">RIEN N’EST CACHÉ</span><h2>Tes opérations</h2></div><span class="muted" style="font-size:11px">Les plus récentes d’abord</span></div><div id="history-content"><div class="loader"></div></div><div class="row space-between" style="margin-top:18px"><button class="text-button" data-do="history-prev" ${!historyOffset?'disabled':''}>← Plus récentes</button><button class="text-button" data-do="history-next">Plus anciennes →</button></div></section>`;
  try{const entries=await api(`/api/history?offset=${historyOffset}`);if(route==='wallet'){$('#history-content').innerHTML=historyTable(entries);$('[data-do="history-next"]').disabled=entries.length<50;}}catch(e){if($('#history-content'))$('#history-content').textContent=e.message;}
}
function renderAccount(){
  app.innerHTML=`<div class="page-heading"><div><span class="eyebrow">TON COIN DU CLUB</span><h1>Mon compte</h1><p>Retrouve ton identité et gère ta connexion.</p></div><button class="button button-ghost button-small" data-do="logout">Me déconnecter</button></div><p class="notice" id="password-required" ${me.mustChangePassword?'':'hidden'} style="margin-bottom:22px">L’administrateur a réinitialisé ton mot de passe. Choisis-en un nouveau avant de jouer.</p><div class="profile-layout"><section class="panel profile-card"><div class="avatar">${esc(me.name.slice(0,1).toUpperCase())}</div><h2>${esc(me.name)}</h2><p>@${esc(me.username)}</p><span class="tag ${me.role==='admin'?'tag-gold':'tag-mint'}">${me.role==='admin'?'ADMINISTRATEUR':'MEMBRE DU CLUB'}</span><hr><p class="form-note">Sur un PC de l’école, utilise ton propre compte et déconnecte-toi en partant. Ton mot de passe n’est jamais affiché aux autres joueurs.</p>${me.role==='admin'?'<button class="button button-soft wide" data-nav="admin">Ouvrir l’administration →</button>':''}</section><div class="stack"><section class="panel"><h2>Ton pseudo à la table</h2><form data-form="profile-name" class="stack" style="margin-top:20px"><div><label for="profile-name">Pseudo · 2 à 18 caractères</label><input id="profile-name" name="name" minlength="2" maxlength="18" value="${esc(me.name)}" required></div><button class="button button-primary">Enregistrer le pseudo</button><p class="error-message" role="alert"></p></form></section><section class="panel"><h2>Changer mon mot de passe</h2><form data-form="password" class="stack" style="margin-top:20px"><div><label for="current-password">Mot de passe actuel</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></div><div><label for="new-password">Nouveau mot de passe</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div><div><label for="repeat-password">Confirme le nouveau mot de passe</label><input id="repeat-password" name="repeatPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div><button class="button button-soft">Changer et fermer mes sessions</button><p class="form-note">Toutes tes sessions seront fermées. Reconnecte-toi ensuite avec le nouveau mot de passe.</p><p class="error-message" role="alert"></p></form></section></div></div>`;
}
async function renderAdmin(query=''){
  app.innerHTML='<div class="loading-scene"><span class="loader"></span><p>Ouverture de l’administration…</p></div>';
  try{const data=await api(`/api/admin?q=${encodeURIComponent(query)}`);if(route!=='admin')return;activeAdmin=data;
    app.innerHTML=`<div class="page-heading"><div><span class="eyebrow">ESPACE PRIVÉ · ADMINISTRATEUR</span><h1>Les coulisses du club.</h1><p>Des actions immédiates, enregistrées dans le journal d’administration.</p></div><div class="row"><button class="button button-soft button-small" data-do="admin-refresh">Actualiser ↻</button><button class="button button-ghost button-small" data-do="admin-export">Exporter</button></div></div><section class="admin-stats">${[['Utilisateurs',data.stats.users],['En ligne',data.stats.online],['Tables ouvertes',data.stats.rooms],['Opérations',data.stats.transactions]].map(([label,n])=>`<div class="admin-stat"><small>${label}</small><strong>${n}</strong></div>`).join('')}</section><section class="panel"><div class="section-heading"><div><span class="eyebrow">LES MEMBRES</span><h2>Tous les utilisateurs</h2></div><span class="tag">${esc(data.storage==='memory-test'?'Base de test temporaire':data.storage==='turso'?'Base distante':'SQLite local')}</span></div><form data-form="admin-search" class="admin-tools"><input name="query" aria-label="Rechercher un membre" placeholder="Un pseudo, un identifiant…" value="${esc(query)}"><button class="button button-soft button-small">Rechercher</button></form><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Membre</th><th>Disponible</th><th>Engagé</th><th>Statut</th><th>Action</th></tr></thead><tbody>${data.users.map(u=>`<tr><td><strong><i class="alert-dot ${u.online?'':'offline'}"></i> ${esc(u.name)}</strong><small>@${esc(u.username)} · ${u.role==='admin'?'admin':'joueur'}</small></td><td class="amount">${euro(u.wallet.available)}</td><td class="amount">${euro(u.wallet.inPlay)}</td><td><span class="tag ${u.disabled?'tag-red':'tag-mint'}">${u.disabled?'Suspendu':'Actif'}</span></td><td><button class="button button-soft button-small" data-manage="${u.id}">Gérer</button></td></tr>`).join('')}</tbody></table></div></section><div class="admin-panels" style="margin-top:24px"><section class="panel"><span class="eyebrow">MAINTENANT</span><h2>Tables en cours</h2><div style="margin-top:18px">${data.rooms.map(r=>`<div class="admin-room"><div><strong>${GAMES[r.game].short} · ${esc(r.code)}</strong><small>${PHASE[r.phase]??r.phase} · ${r.players.map(p=>`${esc(p.name)}${p.bot?' (robot)':''}`).join(', ')}</small></div><button class="text-button" data-close-room="${esc(r.code)}">Fermer</button></div>`).join('')||'<p class="form-note">Aucune table active.</p>'}</div><p class="readonly-note">Les cartes privées des joueurs ne sont pas accessibles dans l’administration.</p></section><section class="panel admin-settings"><span class="eyebrow">LE FONCTIONNEMENT DU CLUB</span><h2>Paramètres du site</h2><form data-form="admin-settings" class="stack" style="margin-top:20px"><label class="checkbox-label"><input name="maintenance" type="checkbox" ${data.settings.maintenance?'checked':''}> Suspendre les nouvelles parties et inscriptions</label><div><label for="admin-banner">Message visible par tous · 180 caractères</label><input id="admin-banner" name="banner" maxlength="180" value="${esc(data.settings.banner)}" placeholder="Bienvenue à la classe !"></div><div><label for="settings-reason">Raison de la modification</label><input id="settings-reason" name="reason" minlength="4" maxlength="180" placeholder="Information à la classe" required></div><button class="button button-soft">Enregistrer</button><p class="error-message" role="alert"></p></form></section></div><section class="panel" style="margin-top:24px"><span class="eyebrow">TRAÇABILITÉ</span><h2>Journal administrateur</h2><div style="margin-top:18px">${data.audit.map(a=>`<div class="admin-log"><span>${dt(a.at)}</span><div><strong>${esc(a.actorName)} · ${esc(a.action)}</strong><p>${esc(a.reason)}</p><small>${esc(a.target)}</small></div></div>`).join('')||'<p class="form-note">Les prochaines modifications apparaîtront ici.</p>'}</div></section>`;
  }catch(e){app.innerHTML=`<p class="notice">${esc(e.message)}</p>`;}
}
function manageUser(userId){
  const u=activeAdmin?.users.find(u=>u.id===userId);if(!u)return;
  modal(`<span class="eyebrow">ADMINISTRATION · MEMBRE</span><div class="admin-user-info"><strong>${esc(u.name)}</strong><p>@${esc(u.username)} · ${u.role==='admin'?'Administrateur':'Joueur'}</p><span class="tag tag-mint">Disponible ${euro(u.wallet.available)}</span><span class="tag">Engagé ${euro(u.wallet.inPlay)}</span></div><hr><h3>Modifier le disponible</h3><form data-form="admin-balance" data-user="${u.id}" class="stack" style="margin-top:16px"><div class="field-row"><div><label for="balance-mode">Action</label><select name="mode" id="balance-mode"><option value="add">Ajouter</option><option value="subtract">Retirer</option><option value="set">Fixer le disponible à</option></select></div><div><label for="admin-amount">Montant · € fictifs</label><input name="amount" id="admin-amount" type="number" step="0.01" min="0" max="1000000" value="100" required></div></div><div><label for="balance-reason">Raison obligatoire</label><input name="reason" id="balance-reason" minlength="4" maxlength="180" placeholder="Crédit pour la session de classe" required></div><button class="button button-primary">Appliquer au portefeuille</button><p class="error-message" role="alert"></p></form><p class="readonly-note">Seul le disponible change. Les tapis et mises déjà engagés ne sont pas effacés.</p><hr><div class="manage-actions"><button class="button button-soft button-small" data-user-history="${u.id}">Historique des opérations</button><button class="button button-soft button-small" data-user-action="cancelMines" data-user="${u.id}">Annuler Cristaux</button>${u.role!=='admin'?`<button class="button button-soft button-small" data-user-action="resetPassword" data-user="${u.id}">Réinitialiser le mot de passe</button><button class="button button-soft button-small" data-user-action="revokeSessions" data-user="${u.id}">Fermer les sessions</button><button class="button button-danger button-small" data-user-action="suspend" data-disabled="${!u.disabled}" data-user="${u.id}">${u.disabled?'Réactiver le compte':'Suspendre le compte'}</button>`:''}</div>`);
}
function adminActionDialog(type,userId,extra={}){
  const titles={suspend:extra.disabled?'Suspendre ce compte ?':'Réactiver ce compte ?',resetPassword:'Nouveau mot de passe temporaire',revokeSessions:'Fermer les sessions ?',cancelMines:'Annuler son exploration ?',closeRoom:'Fermer cette table ?'};
  const details={suspend:'Les sessions sont fermées en cas de suspension. La main en cours se termine automatiquement, sans annuler les pertes.',resetPassword:'Choisis un mot de passe temporaire de 10 caractères minimum. Communique-le en privé au joueur. Il devra le remplacer avant de rejouer.',revokeSessions:'Toutes les connexions de cet utilisateur seront fermées.',cancelMines:'L’exploration en cours sera annulée et sa mise initiale sera restituée.',closeRoom:'La main en cours sera annulée pour tous les joueurs. Leurs tapis de référence seront rendus. Les mains déjà réglées restent enregistrées.'};
  modal(`<span class="eyebrow">ACTION ADMINISTRATEUR</span><h2>${titles[type]}</h2><p>${details[type]}</p><form data-form="admin-action" data-type="${type}" data-user="${userId??''}" data-extra="${esc(JSON.stringify(extra))}" class="stack">${type==='resetPassword'?'<div><label for="reset-password">Mot de passe temporaire</label><input type="password" id="reset-password" name="password" minlength="10" maxlength="128" autocomplete="new-password" required></div>':''}<div><label for="admin-reason">Raison · visible dans le journal</label><input id="admin-reason" name="reason" minlength="4" maxlength="180" required></div><button class="button button-danger">Confirmer l’action</button><p class="error-message" role="alert"></p></form>`);
}
function settingsDialog(){modal(`<span class="eyebrow">LE CLUB, À TON GOÛT</span><h2>Ton ambiance.</h2><p>Les animations sont légères et ne changent jamais le résultat des jeux.</p><form data-form="preferences" class="stack"><div><label for="motion-mode">Animations des cartes et de l’interface</label><select id="motion-mode" name="motion"><option value="cinematic" ${document.documentElement.dataset.motion==='cinematic'?'selected':''}>Immersives · cartes en 1 seconde</option><option value="quick" ${document.documentElement.dataset.motion==='quick'?'selected':''}>Rapides · cartes en 0,42 seconde</option><option value="reduced" ${document.documentElement.dataset.motion==='reduced'?'selected':''}>Réduites · mouvements presque désactivés</option></select></div><label class="checkbox-label"><input name="sound" type="checkbox" ${soundEnabled()?'checked':''}> Petits sons de cartes et de jetons</label><button class="button button-primary">Enregistrer mon ambiance</button></form><p class="form-note">Ces préférences sont mémorisées uniquement dans ce navigateur.</p>`);}
const rules={
  poker:`<strong>Texas Hold’em :</strong> deux cartes privées, cinq communes. La meilleure combinaison de cinq cartes gagne : carte haute, paire, deux paires, brelan, suite, couleur, full, carré, quinte flush. Tu peux te coucher, suivre, dire parole, relancer ou faire tapis. Les pots secondaires protègent les tapis différents. Les égalités partagent le pot. Aucun prélèvement sur le pot.<br><br><strong>Mains favorisées :</strong> mode optionnel annoncé à toute la table. Le serveur compare les seules mains de départ de 24 mélanges, puis garde une distribution plus favorable à l’ensemble des places. Il ne regarde pas le futur tableau pour choisir un gagnant. Le mode classique reste disponible.`,
  blackjack:`Vise 21 sans dépasser. Les figures valent 10, l’As 1 ou 11. Chacun affronte le croupier, pas les amis. Six jeux de cartes, nouveau mélange avant chaque main. Le croupier vérifie son blackjack si sa carte visible vaut 10 ou est un As, puis reste sur tous les 17 (S17). Une victoire normale rapporte 1:1 de bénéfice ; un blackjack naturel 3:2. Une égalité rend la mise. Un dépassement perd immédiatement. Doubler : seulement les deux premières cartes, mise doublée, une dernière carte. Pas de split, assurance, abandon ni paris annexes dans cette version. Aucun boost des cartes.`,
  roulette:`Roulette européenne : 37 numéros de 0 à 36, probabilité égale 1/37. Numéro plein : retour total ×36 ; douzaine : ×3 ; rouge/noir, pair/impair, 1–18/19–36 : ×2. Le zéro perd toutes les chances simples. Pas de règle « la partage ». Les multiplicateurs incluent la mise. Chaque mise vaut au moins 1 €, le total maximum est 200 € fictifs. Les joueurs d’une table partagent exactement le même numéro gagnant.`,
  mines:`25 cases. Choisis 1, 3 ou 5 mines, puis révèle des cristaux. Les mines sont fixées au début et restent cachées côté serveur. Toucher une mine perd la mise. Après au moins un cristal, tu peux récupérer le montant affiché. Sans aucun clic, tu peux annuler et récupérer ta mise. Les sessions survivent à la reconnexion et au redémarrage si la base de données reste disponible. Le multiplicateur utilise la probabilité exacte de découvrir ces cristaux, avec un retour théorique de 97 % avant arrondi des centimes.`,
  dice:`Le serveur choisit uniformément un entier de 0 à 9 999, affiché entre 0,00 et 99,99. Choisis entre 10 et 90 % de chance. Gagné si le résultat est strictement inférieur au seuil choisi. Le retour total est mise × 97 / probabilité, arrondi au centime inférieur. Par exemple, 50 % donne ×1,94. Le dé animé est une illustration : il ne représente pas un tirage limité à six valeurs.`,
  plinko:`La bille effectue 12 choix gauche/droite indépendants, chacun à 50 %. Les cases centrales ont donc plus de chances que les bords. La trajectoire montrée est celle calculée par le serveur. Les 13 multiplicateurs symétriques sont normalisés à un retour théorique de 97 % avant arrondi des centimes. La valeur affichée sous chaque case est arrondie pour la lecture ; le paiement utilise la valeur exacte. Aucun pilotage de la trajectoire selon le solde.`
};
function helpDialog(){const g=route==='table'?state?.game:['mines','dice','plinko'].includes(route)?route:'poker';modal(`<span class="eyebrow">30 SECONDES POUR COMMENCER</span><h2>Simplement, joue.</h2><div class="tutorial-steps"><div class="tutorial-step"><b>01</b><div><strong>Ton compte, tes euros fictifs</strong><p>1 000 € à l’inscription. Un seul portefeuille partout. Zéro argent réel.</p></div></div><div class="tutorial-step"><b>02</b><div><strong>Une table ou une petite partie</strong><p>Crée une table, invite par lien ou essaie les robots. L’arcade se joue en solo.</p></div></div><div class="tutorial-step"><b>03</b><div><strong>Les bons boutons au bon moment</strong><p>Le site indique ton tour. Ton tapis te revient à la sortie, une fois la main terminée.</p></div></div></div>${Object.entries(rules).map(([key,text])=>`<details class="rules-details" ${key===g?'open':''}><summary>${GAMES[key].short}</summary><p>${text}</p></details>`).join('')}<p class="form-note">Les euros de CLUB ROYAL n’ont aucune valeur monétaire. Pas de dépôt, achat, retrait, publicité ni prix réel. Fais des pauses et garde le jeu comme un moment convivial.</p><button class="button button-primary wide" data-do="tutorial-done">C’est parti <span>→</span></button>`);}

async function executeButton(button){
  if(button.disabled)return;
  if(button.dataset.nav){navigate(button.dataset.nav);return;}
  if(button.dataset.game){setup(button.dataset.game);return;}
  if(button.dataset.auth){authDialog(button.dataset.auth);return;}
  if(button.dataset.rchip){rouletteChip=Number(button.dataset.rchip);patchRoulette(state);return;}
  if(button.dataset.rbet){addRouletteBet(button);return;}
  if(button.dataset.bjbet){ui.bet=Number(button.dataset.bjbet);renderActions(state,state.players.find(p=>p.id===state.you));return;}
  if(button.dataset.minibet){ui.miniStake=Number(button.dataset.minibet);$('#mini-stake').value=ui.miniStake/100;return;}
  if(button.dataset.cell){await minesAction('reveal',Number(button.dataset.cell));return;}
  if(button.dataset.manage){manageUser(button.dataset.manage);return;}
  if(button.dataset.userAction){adminActionDialog(button.dataset.userAction,button.dataset.user,{...(button.dataset.disabled!==undefined?{disabled:button.dataset.disabled==='true'}:{})});return;}
  if(button.dataset.closeRoom){adminActionDialog('closeRoom',null,{code:button.dataset.closeRoom});return;}
  if(button.dataset.userHistory){const rows=await api(`/api/admin/history?user=${encodeURIComponent(button.dataset.userHistory)}`);modal(`<span class="eyebrow">ADMINISTRATION</span><h2>Historique du membre</h2><p>Les 50 opérations les plus récentes.</p>${historyTable(rows)}`);return;}
  if(button.dataset.action){
    if(requestBusy||!state)return;const type=button.dataset.action==='allIn'?'allin':button.dataset.action;
    const msg={type,handId:state.handId,turnSeq:state.turnSeq};
    if(type==='raise')msg.amount=moneyInput($('#raise-amount').value,1,1e12);
    if(type==='bet')msg.amount=moneyInput($('#bj-bet').value,500,20000);
    if(type==='rouletteBet')msg.bets=structuredClone(rouletteDraft);
    requestBusy=true;renderActions(state,state.players.find(p=>p.id===state.you));
    try{await api('/api/action',msg);tone('click');}finally{requestBusy=false;if(route==='table'&&state)renderTable();}return;
  }
  switch(button.dataset.do){
    case 'join':joinDialog();break;
    case 'close':closeModal();break;
    case 'help':helpDialog();break;
    case 'settings':settingsDialog();break;
    case 'sound':toggleSound();updateAccount(me);break;
    case 'tutorial-done':storage.set('cr-v2-tutorial',true);closeModal();break;
    case 'invite':inviteDialog();break;
    case 'copy-invite':await copyText(`${siteInfo.publicBaseUrl||location.origin}/?table=${encodeURIComponent(state.code)}`);break;
    case 'leave':leaveDialog();break;
    case 'confirm-leave':
      if(requestBusy)return;requestBusy=true;button.disabled=true;
      try{await api('/api/leave',{});closeModal();tableKey='';navigate('home');toast(me?.activeRoom?'Tu as quitté la table. Le tapis sera rendu après la main en cours.':'Table quittée. Ton tapis a été rendu au portefeuille.');}finally{requestBusy=false;button.disabled=false;}break;
    case 'topup':topupDialog();break;
    case 'roulette-clear':rouletteDraft=[];patchRoulette(state);renderActions(state,state.players.find(p=>p.id===state.you));break;
    case 'mines-start':await minesAction('start');break;
    case 'mines-cashout':await minesAction('cashout');break;
    case 'mines-cancel':await minesAction('cancel');break;
    case 'dice-play':await playDice();break;
    case 'plinko-play':await playPlinko();break;
    case 'refill':await api('/api/refill',{});await renderWallet();toast('1 000 € fictifs de secours ajoutés.');break;
    case 'wallet-refresh':updateAccount(await api('/api/me'));await renderWallet();break;
    case 'history-next':historyOffset+=50;await renderWallet();break;
    case 'history-prev':historyOffset=Math.max(0,historyOffset-50);await renderWallet();break;
    case 'admin-refresh':await renderAdmin();break;
    case 'admin-export':{
      const data=await api('/api/admin/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`club-royal-journal-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Export réservé à l’administration : conserve-le en privé.');break;
    }
    case 'logout':await api('/api/auth/logout',{});events?.close();events=null;updateAccount(null);updateState(null);closeModal();connection('Bienvenue au club',true);navigate('home');break;
  }
}
document.addEventListener('click',e=>{const b=e.target.closest('button,[data-nav]');if(!b)return;executeButton(b).catch(error=>toast(error.message,true));});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role=button][data-nav]')){e.preventDefault();navigate(e.target.dataset.nav);}});
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
document.addEventListener('input',e=>{
  const input=e.target;
  if(input.id==='raise-slider'){$('#raise-amount').value=input.value;ui.raise=Math.round(Number(input.value)*100);}
  if(input.id==='raise-amount'){$('#raise-slider').value=input.value;ui.raise=Math.round(Number(input.value)*100);}
  if(input.id==='dice-chance'){ui.chance=Number(input.value);$('#chance-value').textContent=`${ui.chance} %`;$('#dice-multiplier').textContent=`${(97/ui.chance).toFixed(2)}×`;$('#dice-rule-fill').style.width=`${ui.chance}%`;$('#dice-threshold').textContent=`Gagne en dessous de ${ui.chance}`;}
  if(input.id==='join-code')input.value=input.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
});
document.addEventListener('submit',async e=>{
  const form=e.target;if(!form.dataset.form)return;e.preventDefault();if(form.dataset.busy)return;form.dataset.busy='1';const buttons=$$('button',form);buttons.forEach(b=>b.disabled=true);formError(form,'');const f=new FormData(form);
  try{
    switch(form.dataset.form){
      case 'auth':{
        const next=authNext;const out=await api(`/api/auth/${form.dataset.mode}`,{username:f.get('username'),name:f.get('name')||undefined,password:f.get('password')});updateAccount(out.me);closeModal();startEvents();updateState(await api('/api/state'));navigate('home');
        if(me.mustChangePassword)navigate('account');else if(next)next();else if(!storage.get('cr-v2-tutorial',false))helpDialog();break;
      }
      case 'create':{
        await api('/api/create',{game:form.dataset.game,solo:f.get('mode')==='solo',bots:Number(f.get('bots')||3),buyIn:moneyInput(f.get('buyIn'),2000,200000),pokerMode:f.get('pokerMode')||'classic'});closeModal();navigate('table');break;
      }
      case 'find-room':{const info=await api(`/api/room?code=${encodeURIComponent(f.get('code').toUpperCase())}`);joinConfirm(info);break;}
      case 'join':await api('/api/join',{code:form.dataset.code,buyIn:moneyInput(f.get('buyIn'),2000,200000),acceptBoost:f.get('acceptBoost')==='on'});pendingInvite=null;try{history.replaceState(null,'',location.pathname);}catch{/* Some embedded browsers disallow history updates. */}closeModal();navigate('table');break;
      case 'topup':await api('/api/topup',{amount:moneyInput(f.get('amount'),1000,200000)});closeModal();toast('Ton tapis a été augmenté.');break;
      case 'profile-name':await api('/api/profile',{name:f.get('name')});renderAccount();toast('Pseudo mis à jour.');break;
      case 'password':{
        if(f.get('newPassword')!==f.get('repeatPassword'))throw Error('Les nouveaux mots de passe ne correspondent pas.');await api('/api/profile',{currentPassword:f.get('currentPassword'),newPassword:f.get('newPassword')});events?.close();events=null;updateAccount(null);navigate('home');authDialog();toast('Mot de passe modifié. Reconnecte-toi.');break;
      }
      case 'preferences':setMotion(f.get('motion'));if((f.get('sound')==='on')!==soundEnabled())toggleSound();updateAccount(me);closeModal();toast('Ton ambiance est enregistrée.');break;
      case 'admin-search':await renderAdmin(f.get('query'));break;
      case 'admin-balance':await api('/api/admin/action',{type:'balance',userId:form.dataset.user,mode:f.get('mode'),amount:moneyInput(f.get('amount'),0,100000000),reason:f.get('reason')});closeModal();await renderAdmin();toast('Solde disponible modifié et action enregistrée.');break;
      case 'admin-action':{
        const extra=JSON.parse(form.dataset.extra||'{}');await api('/api/admin/action',{type:form.dataset.type,userId:form.dataset.user,...extra,reason:f.get('reason'),...(f.get('password')?{password:f.get('password')}:{})});closeModal();await renderAdmin();toast('Action appliquée et enregistrée.');break;
      }
      case 'admin-settings':await api('/api/admin/action',{type:'settings',maintenance:f.get('maintenance')==='on',banner:f.get('banner'),reason:f.get('reason')});await renderAdmin();toast('Paramètres du site enregistrés.');break;
    }
  }catch(error){formError(form,error.message);}finally{delete form.dataset.busy;buttons.forEach(b=>b.disabled=false);}
});

async function boot(){
  try{
    [config,siteInfo]=await Promise.all([api('/api/config'),api('/api/info')]);
    try{updateAccount(await api('/api/me',undefined,true));updateState(await api('/api/state'));startEvents();}catch(e){if(e.status!==401)throw e;updateAccount(null);connection('Bienvenue au club',true);}
    navigate('home');
    if(pendingInvite){authNext=()=>joinDialog(pendingInvite);if(me)joinDialog(pendingInvite);else authDialog();}
  }catch(e){connection('Service indisponible',false);app.innerHTML=`<div class="loading-scene"><h1>Le club se réveille.</h1><p>${esc(e.message)}</p><button class="button button-primary" id="retry-boot">Réessayer</button></div>`;$('#retry-boot').onclick=boot;}
}
boot();
