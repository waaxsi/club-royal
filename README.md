# ♠ CLUB ROYAL

**Un site de poker Texas Hold’em, avec un mode blackjack, pour jouer avec sa classe ou s’entraîner contre des robots.** Interface française, table en relief CSS, salons privés et jetons entièrement fictifs.

## Démarrer sur le PC de l’école

1. **Extrais tout le ZIP** dans un dossier, par exemple `Documents\club-royal`. Ne lance pas le projet directement à l’intérieur du ZIP.
2. Le PC doit disposer de **Node.js 22 ou plus récent**. Dans un terminal : `node --version`. Si Node.js manque, demande son installation au responsable informatique. Le projet ne modifie pas les réglages de l’école.
3. Double-clique sur **`LANCER.cmd`**. Garde cette fenêtre ouverte.
4. Ouvre l’adresse locale indiquée, normalement `http://localhost:3000`.
5. Choisis ton pseudo, sélectionne **Poker** ou **Blackjack**, puis joue en solo ou crée une table privée.

**Aucun `npm install` n’est nécessaire.** Le projet n’a aucune dépendance externe. Après installation de Node.js, il fonctionne sans accès à Internet sur un réseau local autorisé. Les images de cartes sont dessinées en CSS, sans téléchargement de police ou d’images.

### Depuis Visual Studio Code

Ouvre le dossier `club-royal`, puis un terminal intégré à la racine du projet :

```sh
node server/index.js
```

Autres commandes disponibles :

```sh
npm start          # lance le serveur
npm run dev        # relance automatiquement le serveur quand le code change
npm run build      # vérifie la syntaxe ; aucune compilation/bundle n’est nécessaire
npm test           # exécute les tests intégrés à Node.js
```

Un redémarrage en mode développement efface les parties en cours. Sous PowerShell, la commande directe `node server/index.js` évite de dépendre du script npm.ps1 ; il n’est pas nécessaire de changer la stratégie d’exécution.

**Ne double-clique pas sur `public/index.html` et n’utilise pas uniquement Live Server.** Le véritable moteur multijoueur est le serveur Node.js ; le HTML seul ne suffit pas.

## Jouer à plusieurs dans la classe

**Un seul PC doit héberger le serveur pour une même partie.** Les autres n’ont besoin que de leur navigateur.

L’hôte lance le site, clique sur **Créer une table privée**, puis sur **Inviter des amis**. Un code de six caractères et un lien s’affichent. Les autres élèves ouvrent **l’adresse réseau du PC hôte**, puis entrent le code ou suivent le lien.

Exemple d’adresse, à remplacer par la vraie adresse du PC :

```text
http://192.168.1.25:3000
```

`localhost` désigne toujours **le PC sur lequel on le tape**. Il ne faut donc pas donner `localhost:3000` aux autres élèves. Le terminal et l’écran « Aide connexion » affichent les adresses réseau candidates. Avec plusieurs cartes réseau, une adresse de VPN ou de machine virtuelle peut être proposée : choisis celle du réseau de la classe.

Le bouton **Distribuer les cartes**, puis **Main suivante**, appartient à l’hôte. Il peut ajouter ou retirer des robots entre les mains. Une table de poker accueille **2 à 6 joueurs** au total, humains et robots compris. Le blackjack accepte **1 à 6 joueurs**, chacun contre le croupier automatique. Plusieurs salons indépendants peuvent coexister.

### Un autre PC n’arrive pas à se connecter ?

Vérifie d’abord que le site fonctionne sur le PC hôte et que sa fenêtre serveur est ouverte. Vérifie ensuite l’adresse, le port et le réseau utilisé. Les réseaux scolaires peuvent isoler les appareils ou bloquer les connexions entrantes. Dans ce cas, demande une autorisation ou une aide au responsable informatique : le projet n’ouvre pas de port, ne change pas le pare-feu et ne contourne aucune restriction.

Les navigateurs peuvent limiter le nombre de connexions HTTP simultanées vers un même hôte : pour tester une classe, privilégie différents appareils plutôt qu’une dizaine d’onglets d’un seul navigateur.

### Changer de port

Copie `.env.example` en `.env`, puis modifie :

```dotenv
PORT=3001
```

Relance le serveur. Les invitations devront alors utiliser le nouveau port. Si un port est occupé, aucun autre programme n’est arrêté automatiquement.

### Jouer depuis différents réseaux / sur Internet

Ce ZIP ne déploie pas le site sur Internet. Il faut un hébergement capable d’exécuter le serveur Node.js en continu et de transmettre les réponses HTTP en streaming (SSE), sans mise en tampon du proxy. Un hébergement statique seul ne convient pas.

Après avoir configuré un vrai domaine, un proxy HTTPS et l’hébergement, `PUBLIC_BASE_URL` peut préciser l’origine des liens d’invitation. Ce réglage **ne crée ni hébergement ni tunnel**. La version livrée vise d’abord une table privée sur un réseau de confiance, pas une plateforme publique de casino ou un service à grande échelle.

## Les jeux implémentés

### Poker Texas Hold’em — mode principal

Deux cartes privées par joueur ; flop, turn et river ; meilleure combinaison de cinq cartes parmi les sept disponibles. Jeu sans limite, blindes fixes **10/20**, **2 000 jetons** au départ. Parole, suivre, se coucher, relance totale et tapis. Pots secondaires, partage des égalités, jetons impairs, sommes non suivies rendues, rotation du bouton et jeu en duel sont traités côté serveur.

Les robots prennent leurs décisions à partir de **leurs propres cartes et du tableau public**. Ils ne voient ni les cartes adverses ni l’ordre du paquet. Ce sont des partenaires d’entraînement simples, pas un moteur de poker de niveau professionnel.

Une relance doit respecter l’incrément minimum, sauf tapis insuffisant. Un tapis court ne rouvre pas nécessairement l’action ; plusieurs tapis courts peuvent la rouvrir cumulativement. La règle est expliquée dans les tests et dans le moteur. Il n’y a pas de prélèvement sur les pots.

L’hôte distribue chaque nouvelle main. Ce n’est pas un tournoi multi-tables : pas de niveaux de blindes, d’élimination permanente, de déplacement de sièges entre tables ni de classement global. Les joueurs arrivant pendant une main attendent la suivante. Le bouton avance parmi les joueurs actifs ; il ne s’agit pas d’une simulation complète des procédures de tournoi avec bouton mort.

### Blackjack — mode complémentaire

**1 000 jetons**, mises de **10 à 200**, par pas de 10. Six paquets sont mélangés avant chaque main. Le croupier reçoit une carte cachée, son blackjack est vérifié dès la distribution et il reste sur tous les 17, y compris les 17 avec As souple.

Tirer, rester et doubler sont disponibles. Le double est autorisé sur les deux cartes initiales avec suffisamment de jetons, donne exactement une carte supplémentaire et termine la main.

Le gain ordinaire est de **1:1**, le blackjack naturel de **3:2**, une égalité rend la mise. Le montant « rendu » inclut la mise initiale. Exemple, avec 1 000 jetons et une mise de 100 : victoire normale → 1 100 ; blackjack gagnant → 1 150 ; égalité → 1 000 ; défaite → 900.

La séparation de paires, l’assurance, l’abandon et les mises annexes ne sont **pas implémentés**. Cette limite apparaît dans les règles du site. Aucun résultat n’est ajusté pour forcer des victoires ou des défaites ; aucune affirmation de pourcentage d’avantage de la maison n’est faite.

### Jetons et rythme de jeu

Les jetons n’ont aucune valeur monétaire. Pas de compte, de paiement, de dépôt, de retrait, de publicité ou de lien affilié. À court de jetons, une recharge gratuite est disponible entre les mains. Les recharges sont comptées séparément côté serveur et ne sont pas des gains.

Au poker, après 25 secondes sans action : parole si possible, sinon coucher. Au blackjack : 30 secondes pour miser, puis 25 secondes par tour ; à expiration, le joueur reste. Une connexion interrompue conserve la place environ 90 secondes. Le jeu ne s’arrête pas pour attendre une personne déconnectée. Si l’hôte se déconnecte, un autre humain connecté devient hôte.

## Architecture et sécurité

- **Client** : HTML, CSS et JavaScript natif, sans service externe ni police à télécharger.
- **Serveur** : Node.js, HTTP natif, flux d’événements serveur **SSE** authentifiés, actions en JSON par `fetch`. Pas de Socket.IO, React ou WebGL dans la version livrée : ils ne sont pas nécessaires à ce périmètre.
- **Autorité** : le serveur mélange, distribue, valide les tours, débite et attribue les jetons. Le navigateur ne peut pas imposer un solde ou un résultat.
- **Aléatoire** : Fisher–Yates avec `node:crypto.randomInt` pour les cartes ; codes de salon aléatoires avec vérification de collision ; identifiants de session secrets à forte entropie.
- **Confidentialité de jeu** : les cartes privées adverses, la carte cachée du croupier et le paquet restant ne sont pas transmis aux autres joueurs. Les cartes couchées restent cachées après la main.
- **Actions fiables** : identifiants de requête pour éviter le double débit, numéro de main et séquence de tour pour rejeter les actions périmées, confirmation HTTP et nouvel état complet à la reconnexion.
- **Précautions** : taille de requête plafonnée, limitation de débit, contrôle d’origine, rendu échappé des pseudos, pas d’accès HTTP aux fichiers serveur ni à `.env`.

Le token de reconnexion reste dans `sessionStorage` et n’apparaît jamais dans les liens d’invitation. Une deuxième connexion utilisant le même token remplace la première ; pour deux joueurs, utiliser des sessions indépendantes. Si le navigateur bloque le stockage local, la partie courante reste possible mais la restauration après fermeture/actualisation peut ne pas fonctionner.

**Les salons et les jetons sont en mémoire.** Fermer ou redémarrer le serveur les efface. Les salles abandonnées expirent ; les requêtes ne sont pas persistées sur disque. Le projet ne protège pas contre une personne qui contrôle le PC hôte, un participant qui partage volontairement sa session ou une interception sur un réseau HTTP non fiable. Avant tout usage public, une revue de sécurité, HTTPS, une politique d’accès, un déploiement adapté et des tests de charge supplémentaires sont nécessaires.

## Où modifier le code ?

```text
club-royal/
  LANCER.cmd                 Démarrage Windows
  TESTER.cmd                 Vérifications Windows
  public/index.html          Accueil et structure des écrans
  public/styles.css          Couleurs, relief, cartes et responsive
  public/app.js              Interface, tutoriels, actions et reconnexion
  public/favicon.svg         Logo original
  server/index.js            Serveur HTTP, fichiers, API et flux SSE
  server/rooms.js            Salons, sessions, robots, délais et vues publiques
  server/poker.js            Règles Texas Hold’em, pots et décisions des robots
  server/blackjack.js        Règles blackjack et croupier
  server/cards.js            Paquets, mélange, évaluation des mains
  tests/                     Tests automatisés Node.js
  scripts/check.mjs          Vérification syntaxique
  docs/VERIFICATIONS.md      Résultats et limites des vérifications
  docs/ARCHITECTURE.md       Flux de données et invariants
  docs/SOURCES.md            Références techniques et règles consultées
  docs/apercus/              Captures de l’interface
```

Le dossier complet est éditable dans Visual Studio Code. Tous les assets nécessaires au jeu sont locaux. Les captures de `docs/apercus` servent uniquement d’aperçus et ne sont pas chargées par le site.

## Vérifications et limites

Voir **`docs/VERIFICATIONS.md`** pour le détail : tests de logique, simulations, clients réseau indépendants et contrôles visuels. Ce n’est pas une garantie d’absence de bugs. Le lancement `.cmd` sous Windows, un vrai iPhone, le réseau de l’école et un déploiement public n’ont pas été vérifiés ici.

Le mode responsive a été contrôlé en navigateur Chromium aux dimensions d’un ordinateur et d’un téléphone. Les tests ne remplacent pas une partie d’essai dans l’environnement de la classe.
