# Architecture — Club Royal 1.0

## Un serveur, plusieurs salons

Le serveur écoute sur `0.0.0.0` et un seul port. Il sert l’interface et l’API depuis la même origine. Aucun fichier compilé ou stockage externe n’est nécessaire.

`POST /api/create` crée un salon et une identité. `POST /api/join` crée une identité dans un salon existant. Ces routes renvoient un token secret, l’identifiant public du joueur et la première vue. Le navigateur conserve uniquement sa propre session.

`GET /api/events` utilise `Authorization: Bearer <token>` et reste ouvert. La réponse contient des paquets SSE `event: state` avec la vue individuelle du joueur. Une lecture `fetch` + `ReadableStream` permet l’en-tête d’autorisation, contrairement au constructeur EventSource standard. Un heartbeat et un watchdog facilitent les reconnexions.

`POST /api/action` reçoit un type d’action, `actionId`, `handId`, `turnSeq` et, si nécessaire, un montant. La requête est authentifiée, validée et appliquée de façon synchrone, sans `await` au milieu d’une mutation du moteur. Le serveur renvoie une confirmation et diffuse des vues filtrées. Deux actions concurrentes sont donc traitées l’une après l’autre dans la boucle d’événements Node.

`GET /api/state` resynchronise un joueur. `POST /api/leave` invalide son token. `GET /api/info` donne le port et des adresses réseau candidates, sans rendre le serveur publiquement accessible.

## Machines à états

Poker : `lobby → preflop → flop → turn → river → results`. Une victoire sans opposition mène directement aux résultats. Lorsque personne ne peut plus miser, le tableau restant est complété et la main est évaluée. L’hôte relance une nouvelle main.

Blackjack : `lobby → betting → playing → results`. Un blackjack naturel du croupier mène directement aux résultats ; une phase de mises sans aucun pari retourne au salon. La distribution et le jeu du croupier sont des transitions serveur atomiques, pas des états publics séparés.

## Invariants du moteur

1. Une carte physique possède un identifiant unique. Le paquet de poker contient 52 cartes ; le sabot de blackjack, 312. Les doublons de rang/enseigne entre paquets de blackjack ont des identifiants différents.
2. Le total des jetons d’une main de poker est conservé : tapis initiaux = jetons finaux. Les recharges et les arrivées se produisent hors participation à la main en cours.
3. Une relance est un **montant total de la rue**, pas une somme à ajouter. `streetBet` et `totalBet` ont des rôles distincts.
4. Les niveaux de contribution produisent les pots secondaires. Chaque niveau est attribué séparément aux joueurs éligibles. Un niveau payé par un seul joueur est rendu comme mise non suivie.
5. Le blackjack débite la mise une fois à la validation. Un double débite une mise supplémentaire. Le règlement final utilise un paiement total, mise comprise, et ne peut être appliqué deux fois.
6. Une vue client n’est jamais une copie intégrale du salon. `RoomManager.view()` énumère les champs autorisés, remplace les cartes cachées par `null`, et ne transmet pas les secrets, le paquet, ni un total de croupier caché.
7. Les robots n’emploient pas les cartes des autres participants dans leur décision. Les fonctions de mélange et les règles ne cherchent pas à équilibrer artificiellement le nombre de victoires.

## Choix et simplifications

Pas de stockage durable, pas de file distribuée, pas de comptes ni d’administration publique. Les confirmations des 256 dernières actions par joueur sont gardées en mémoire ; une requête ancienne hors de cette fenêtre est toujours soumise aux validations de main et de tour, mais le système n’est pas une journalisation transactionnelle persistante.

Les cartes sont créées en CSS et les nouveaux éléments sont animés brièvement. L’application n’intègre ni modèle 3D, ni dépendance graphique, ni moteur lourd. Le relief est un effet CSS. La feuille de style prévoit un mode de mouvement réduit.

La source fait foi pour les détails. Toute extension de règles doit ajouter ses cas de test avant d’être exposée dans l’interface, notamment la séparation au blackjack, les tournois ou un classement persistant.
