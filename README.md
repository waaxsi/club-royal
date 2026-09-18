# CLUB ROYAL · V2

**Poker entre amis, blackjack, roulette et trois mini-jeux. Un compte, un portefeuille en euros fictifs.**

Cette version reprend les moteurs de cartes de CLUB ROYAL V1 et remplace l’interface et la gestion des comptes. Elle contient le code serveur, le site, les tests et les instructions de reprise. **Ce ZIP n’a pas été déployé sur le site public.**

## Ouvrir le projet

Node.js **22.16.0 minimum**. Utiliser une révision maintenue et corrigée de Node compatible avec `node:sqlite`. Tests de cette livraison exécutés avec Node 22.16.0 sur Linux.

```sh
node server/index.js
```

Ouvrir `http://localhost:3000`. Windows : `LANCER.cmd`. Ne pas désactiver les protections d’un PC scolaire. Le serveur affiche les adresses réseau candidates ; leur accessibilité dépend du réseau et n’a pas été testée sur les postes de l’école.

**Aucune dépendance npm externe à installer.** HTML/CSS/JS natifs, HTTP Node, événements SSE. `npm run build` vérifie la syntaxe ; il ne génère pas de dossier `dist`.

```sh
npm run build
npm test
npm run test:smoke
```

Pour déployer la mise à jour existante : **[DEPLOIEMENT-GEMINI.md](DEPLOIEMENT-GEMINI.md)**. Le prompt prêt à envoyer se trouve dans `PROMPT-POUR-GEMINI.txt`.

## Ce qui est jouable

| Jeu | Fonctionnement |
|---|---|
| **Poker Texas Hold’em** | 2 à 6 sièges, salons privés, lien/code, solo contre 1 à 5 robots, blindes, mises, relances, tapis, pots secondaires et partage. Classique ou « Mains favorisées ». |
| **Blackjack** | Seul ou à plusieurs contre le même croupier automatique ; six jeux de cartes, As 1/11, S17, naturel 3:2, doubler. Pas de split, assurance, abandon ou mises annexes dans cette version. |
| **Roulette européenne** | Un zéro, résultat partagé par les joueurs de la table ; solo, salons, numéros pleins, douzaines, rouge/noir, pair/impair, moitié basse/haute. |
| **Cristaux** | 25 cases, 1/3/5 mines ; révéler, récupérer, ou annuler avant la première case. Plateau fixé côté serveur. |
| **Dice** | Choisir 10 à 90 % de chances puis lancer ; résultat uniforme de 0,00 à 99,99. Le dé 3D est décoratif, pas un dé physique à six résultats. |
| **Plinko** | Bille animée sur 12 rangées ; 12 choix binaires serveur, 13 cases d’arrivée et multiplicateurs affichés. |

Les trois mini-jeux sont **solo** ; les comptes partagent le même portefeuille que les tables multijoueurs. Ils ne sont pas des salles de mini-jeux synchronisées.

### Règles et montants

Tous les montants du serveur sont des **centimes entiers**, jamais une somme autoritaire fournie par le navigateur. Les gains sont distingués du retour total, qui inclut la mise.

- Compte : 1 000 € fictifs de départ, une seule fois par création de compte. Pas de paiement, dépôt, retrait, transfert vers une devise réelle, récompense ou achat de jetons.
- Tapis d’entrée : 200 € par défaut, prélevés sur le portefeuille disponible ; ce n’est pas un deuxième capital offert. Réglable à la création et complétable entre les mains.
- Blackjack : mises de 5 à 200 €, multiples de 5. Le croupier reste sur tous les 17, même souples. Dépasser 21 fait perdre immédiatement. Un naturel bat un 21 de trois cartes ou plus. Doubler prélève une deuxième mise et donne une seule carte.
- Roulette : mises en euros entiers, de 1 à 200 € au total par tour, au plus 25 positions distinctes. Un plein retourne 36 fois la mise, une douzaine 3 fois, une chance simple 2 fois. Zéro perd pour toutes les chances simples. Les colonnes sont prises en charge dans le moteur mais ne sont pas proposées sur le tapis visuel de cette version. Pas de cheval, carré ou panier.
- Mini-jeux : 1 à 200 € par tour. Le coefficient mathématique de retour avant arrondi des centimes est 97 % pour Dice/Plinko et pour une stratégie de récupération à un nombre de cristaux fixé à l’avance. **Ce n’est pas une promesse de résultat sur une session.** Les probabilités, retours et limites sont affichés dans l’interface.
- Crédit de secours : 1 000 € fictifs quand le total est inférieur à 5 €, au maximum une fois par 24 heures. Enregistré distinctement des gains.

### Poker « Mains favorisées »

L’option est visible à la création et demande un accord explicite avant de rejoindre. Elle choisit parmi **24 mélanges** celui qui améliore un score collectif des **mains de départ** (paire, cartes hautes, assorties, proches). Le score prend particulièrement en compte la main la plus faible de la table.

Cela favorise les départs intéressants en moyenne, **sans garantir une bonne main à chaque personne**. Le serveur ne consulte ni les soldes ni les identités pour choisir un gagnant ; il n’examine pas le futur tableau pour imposer le vainqueur. Il n’ajoute pas de cartes en double. Les robots suivent la même distribution. Le mode classique reste disponible. Le blackjack n’est pas modifié par cette option.

## Interface et immersion

Identité originale noir profond, lavande et menthe, tapis en relief, cartes à deux faces en CSS 3D, dos de cartes, jetons, dé 3D, roue et bille, cases Cristaux animées. Les éléments sont locaux, sans image ou police distante obligatoire.

Les cartes se retournent progressivement (environ une seconde par défaut), avec un décalage entre cartes. Les mêmes nœuds sont conservés lors des mises à jour SSE : une actualisation de solde ne redistribue pas visuellement toute la table. Les montants des gains nets apparaissent **au centre de l’écran**, puis disparaissent. Pas de faux « gagné » sur une perte nette.

Mode animations cinématiques, rapides ou réduites ; prise en compte de la préférence système. Sons discrets désactivés par défaut. Tutoriel français court et règles de chaque jeu consultables. Ordinateur et mobile, sans moteur WebGL imposé.

## Comptes et portefeuille

Inscription avec identifiant, pseudo et mot de passe (10–128 caractères). Pas d’adresse e-mail. Utiliser un mot de passe différent des autres services. Sessions en cookies HttpOnly et mots de passe hachés scrypt. En production HTTPS : cookie Secure. Déconnexion conseillée sur les ordinateurs partagés.

Le portefeuille distingue : **disponible**, **engagé**, opérations, mises, retours et ajustements. Le montant engagé est une valeur de référence comptable, pas un gain garanti. Dans une main de poker en cours, une mise peut être dans le pot ; elle n’est plus dans le tapis immédiatement affiché.

On ne peut pas engager le même capital dans deux tables à la fois. En revanche, le disponible hors table peut servir aux mini-jeux. Quitter ou se déconnecter **ne supprime pas une perte** : le serveur termine la main selon les temporisations puis libère le tapis restant.

L’historique visible présente les **50 dernières opérations**. L’API accepte un `offset` ; l’export administrateur contient le registre entier. Pas encore de pagination interactive de l’historique.

### Persistance réelle : différence importante

En local : SQLite dans `data/club-royal.sqlite`, dossier non public et exclu de Git. Garder ce fichier et ses sauvegardes. Une base ouverte exige des procédures de sauvegarde SQLite cohérentes ; ne pas copier seulement le fichier principal en oubliant le WAL en cours.

Sur un hébergement à système de fichiers éphémère : configurer `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN`, ou un **véritable** disque persistant avec `DATA_FILE` et `PERSISTENT_STORAGE=1`. Le serveur refuse une publication en mode production sans cette configuration et sans propriétaire. Mettre le drapeau à 1 ne transforme pas un disque éphémère en disque durable.

Les comptes, sessions, opérations, explorations Cristaux et réservations de tapis sont persistants. Les **mains des tables ne sont pas sauvegardées pour reprise au milieu d’un tour** : au redémarrage, les mains interrompues sont annulées et les tapis du dernier état complètement réglé sont restitués. Les salons doivent être recréés. Une exploration Cristaux active se retrouve après reconnexion/redémarrage.

La base distante est programmée via l’API HTTP documentée de libSQL/Turso. L’adaptateur a été testé contre un simulateur protocolaire utilisant un vrai SQLite local, **pas avec un compte Turso hébergé**. Cette validation reste obligatoire au déploiement.

## Ton compte administrateur

Le premier inscrit ne devient jamais administrateur. Aucun mot de passe public « admin/admin » n’existe.

Avant la première publication, définir côté serveur :

```dotenv
ADMIN_USER=waaxsi
ADMIN_PASSWORD_HASH=<hash scrypt généré>
```

Commande interactive locale (saisie masquée, affiche uniquement le hash) :

```sh
npm run admin:hash
```

Pour que Gemini génère les identifiants sans les afficher :

```sh
node scripts/admin-hash.mjs --generate --username waaxsi --out CHEMIN_ABSOLU_PRIVE_EXTERIEUR_AU_PROJET.json
```

Le dossier de destination doit déjà exister. Le générateur refuse un chemin dans le projet et refuse d’écraser un fichier existant. Il crée un fichier privé contenant identifiant, mot de passe aléatoire et hash. **Ne pas publier ce fichier, le coller dans un chat ou l’envoyer dans Git.** Sur Windows, vérifier aussi ses autorisations d’accès.

Au premier démarrage configuré, le propriétaire est créé dans la base. Les variables de bootstrap ne changent pas silencieusement son mot de passe s’il existe déjà. Un identifiant déjà pris par un joueur bloque le bootstrap plutôt que de promouvoir cet inconnu.

L’espace administrateur permet de consulter tous les comptes, rechercher, ajouter/retirer/fixer le **disponible**, suspendre/réactiver un joueur, révoquer ses sessions, lui attribuer un mot de passe temporaire avec changement obligatoire, voir le registre, fermer une table, annuler une exploration Cristaux, publier un message et fermer les nouvelles parties/inscriptions pour maintenance. Les changements demandent un motif et sont audités. Les tapis engagés ne sont pas écrasés par un changement du disponible. Les cartes privées ne sont jamais affichées à l’administrateur.

Pas de validation e-mail, CAPTCHA, authentification à deux facteurs ni récupération automatique d’un compte propriétaire perdu. Les corrections manuelles de la base demandent une sauvegarde et l’intervention du responsable technique.

## Tests et limites honnêtes

Voir `docs/VERIFICATIONS.md` et `docs/apercus-v2/rapport-ui.json`. Les tests livrés sont reproductibles. La V2 a été vérifiée localement ; **le réseau scolaire, Windows, le vrai domaine Render et une vraie base Turso ne l’ont pas été dans cette livraison**.

L’architecture est volontairement celle d’un **petit serveur de classe mono-instance**, pas celle d’une plateforme commerciale : un snapshot JSON atomique dans la base, au plus 500 comptes, des registres conservés, un plafond de 32 Mio qui arrête les écritures plutôt que d’effacer les opérations. La capacité peut être atteinte avant 500 comptes suivant le volume de jeux. Il faut prévoir export/sauvegarde/archivage avec validation avant saturation ; aucune purge destructrice automatique n’est fournie. Plusieurs réplicas sont interdits. Les limites de l’hébergeur et de la base peuvent être plus basses.

Les tests ne remplacent pas un audit de sécurité indépendant ni un test de charge. Aucune certification « casino », bancaire, légale ou de conformité à un hébergeur n’est revendiquée. Ce projet n’est pas conçu pour de l’argent réel.

## Repères

- `public/` : site et graphismes originaux, seul dossier servi.
- `server/` : comptes, stockage, jeux et serveur HTTP/SSE.
- `tests/` : suites de tests, sans accès à tes comptes hébergeur.
- `scripts/` : lancement, hash propriétaire, smoke et tests visuels.
- `docs/ARCHITECTURE.md` : architecture et règles de persistance.
- `docs/BASE-V1-SHA256.json` : empreintes de la base V1 utilisée pour faciliter une fusion.
- `docs/v1/` : rapports historiques V1, pas des preuves de tests V2.
- `CHANGELOG.md` : fichiers et modifications principales.
