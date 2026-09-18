# Vérifications — Club Royal 1.0

Vérification effectuée dans l’environnement de création sous **Linux, Node.js v22.16.0**, avec Chromium automatisé pour l’interface. Les résultats décrivent les vérifications réalisées, pas une certification de sécurité ni une garantie d’absence de défauts.

## Résultats automatisés

**69 tests Node.js réussis ; 0 échec, 0 ignoré.** Les tests sont inclus et relançables avec `npm test` ou `node --test`. `npm run build` vérifie la syntaxe des fichiers JavaScript ; il ne s’agit pas d’une compilation React/Vite.

### Moteur de cartes et poker

Paquet standard et sabot sans identifiants dupliqués ; catégories de mains et kickers ; As bas ; meilleure main sur le tableau ; cas de multiples As au blackjack. Tours en duel et à trois, option de la grosse blinde, rotation du bouton et transition vers un duel. Rejet des actions hors tour, relances trop petites et montants invalides. Victoires sans opposition, tapis courts, réouverture cumulative, runout automatique, absence de relance dans un pot secondaire vide, plusieurs pots, mise non suivie rendue et partage avec jeton impair.

Un test exécute **600 mains de poker simulées** de 2 à 6 joueurs, avec tapis de départ variables, actions légales aléatoires, vérification de terminaison, absence de soldes négatifs et conservation des jetons. Le tirage des cartes reste aléatoire ; ces simulations ne couvrent pas toutes les parties possibles.

### Blackjack

Les quatre soldes d’exemple sont testés : victoire, blackjack, égalité, défaite. Double naturel, blackjack du croupier, arrêt sur soft 17, tirage sous 17, dépassements, double avec une seule carte, double interdit, rejet et idempotence des mises, aucun pari, carte et total du croupier absents des vues publiques.

Un test exécute également **800 mains de blackjack simulées**, vérifie leur terminaison et les soldes possibles pour le scénario choisi.

### Vrai serveur et réseau

Les tests démarrent de vrais serveurs HTTP locaux sur des ports éphémères. Ils ouvrent **deux clients SSE indépendants** et jouent une main complète par requêtes HTTP, puis vérifient le même tableau et les mêmes résultats sur les deux connexions. Le filtre de cartes privées est vérifié sur les données réellement transmises.

Autres tests : isolation de salons, requête dupliquée sans double débit, authentification, permissions d’hôte, numéros de main/tour périmés, reconnexion avec siège/cartes/solde conservés, arrivée en cours de main, table pleine, code invalide, transfert d’hôte, expiration du tour et des mises, fermeture de session, expiration de la grâce, nettoyage des salons, requêtes non JSON et origine externe refusées. Les routes des fichiers internes et de `.env` ne sont pas servies.

## Interface et captures

Interface contrôlée dans Chromium en **1366 × 1000** et **390 × 844**. Pas de débordement horizontal observé à ces deux dimensions. Les captures sont dans `docs/apercus/`.

Parcours exécutés : accueil, saisie de pseudo, tutoriel, création d’un salon, entrée avec code depuis une deuxième session, ajout de robots, distribution et main de poker complète, reprise de session, sélection du blackjack, mise, décision « rester » et résultat, code invalide et invitation. Aucune exception JavaScript non gérée n’a été détectée pendant ce parcours.

### Limite importante de ce contrôle navigateur

Le Chromium fourni dans l’environnement de création bloque les navigations réseau locales par une politique d’administration. Cette politique n’a pas été modifiée. L’interface a donc été chargée dans une page de test et ses accès HTTP relayés vers le **vrai serveur local** par un adaptateur du banc d’essai. Pour le contrôle visuel, l’adaptateur transforme les changements d’état en messages attendus par le client ; il ne fait pas partie du produit livré.

Le **transport SSE natif** a été testé séparément avec les clients Node.js décrits plus haut. Les captures montrent le rendu du code de l’application, avec des états de parties réellement calculés par son moteur ; ce ne sont pas des images générées d’un site inexistant. En revanche, ce contrôle ne constitue pas un test de bout en bout du transport navigateur natif dans le réseau de l’école.

Un défaut d’interface trouvé pendant le contrôle a été corrigé : les boutons de gestion des robots sont maintenant réactivés après réception d’une confirmation, sans dépendre d’un message réseau suivant. Le libellé du joueur actif a aussi été corrigé pour distinguer « à toi » et « à son tour ».

## Non vérifié ici

- Exécution réelle de `LANCER.cmd` / `TESTER.cmd` sous Windows et installation de Node.js sur le PC de l’école.
- Connexion entre deux appareils physiques sur le réseau de la classe, règles du pare-feu et isolation Wi-Fi.
- Safari/iPhone réel, Firefox et tous les anciens navigateurs ; les dimensions mobiles ont été simulées sous Chromium.
- Déploiement public, proxy HTTPS, charge élevée ou tests de résistance prolongés.
- Copie dans le presse-papiers et plein écran sur tous les appareils, car les autorisations peuvent varier.
- Audit de sécurité indépendant, prévention de collusion et fonctions de tournoi complet.

Une courte partie avec deux appareils autorisés reste nécessaire avant une session de classe.

## Archive finale

Le ZIP a été contrôlé puis extrait dans un dossier vierge. Depuis cette copie, sans installation de dépendances, la vérification de syntaxe et les **69 tests** ont de nouveau réussi. Le serveur extrait a ensuite été démarré sur un autre port local ; sa route de santé, sa page et ses ressources publiques ont été récupérées avec succès. Ce contrôle a également été réalisé sous Linux, pas sur le PC Windows de l’école.
