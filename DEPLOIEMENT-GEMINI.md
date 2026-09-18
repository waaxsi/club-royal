# Handoff Gemini / Antigravity — publier la V2 existante

## Mission

**Le code de la V2 est écrit. Ne recrée pas le site et ne lui substitue pas un autre template.** Reprends CLUB ROYAL, fusionne la livraison, configure les vrais services et publie sur l’adresse existante. Utilise tes outils autorisés. N’annonce que les vérifications réellement exécutées.

Adresse précédemment annoncée : `https://club-royal-game.onrender.com`.
Dépôt précédemment annoncé : `waaxsi/club-royal`.
Dossier Windows précédemment annoncé : `C:\Users\Admin\.gemini\antigravity\scratch\club-royal`.
Archive V2 : **`Club-Royal-V2-Immersion-Admin.zip`** dans les Téléchargements, éventuellement suffixée `(1)` par le navigateur.

Ces emplacements proviennent du contexte fourni : **inspecte ce qui existe réellement**. La V2 a été préparée depuis le ZIP original V1, pas depuis tous les commits qui peuvent avoir été ajoutés depuis le dernier compte rendu. Les protections de transport connues du déploiement précédent ont été réimplémentées, mais compare le dépôt actuel avant de remplacer un fichier.

## 1 · Inventaire, sauvegarde et fusion

Détecte le vrai dossier Downloads/Téléchargements Windows. Choisis la plus récente archive correspondant exactement à la V2, pas un autre téléchargement récent. Vérifie le ZIP, extrais dans un nouveau dossier de travail. Ne remplace aucun `.env`, `.git`, dossier `data`, sauvegarde ou fichier privé de l’ancien projet.

Lis `README.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/VERIFICATIONS.md` et le présent document. Le fichier `docs/BASE-V1-SHA256.json` contient les empreintes de la base de départ. Il sert à distinguer les changements V2 de modifications intermédiaires apportées dans le dépôt live.

Avant toute fusion : vérifie l’état Git et les changements non committés, sauvegarde-les sans écrasement, crée une branche de mise à jour dédiée. Compare les fichiers. Transfère le code V2 tout en conservant les variables privées et les corrections live non redondantes. Ne laisse pas d’anciennes routes anonymes donnant libre accès aux mises ou à l’administration.

Ne copie jamais le journal Antigravity contenant un ancien token dans le dépôt ou les nouveaux rapports. Ne publie pas les données de comptes. Ne touche pas à d’autres projets.

## 2 · Réparer les points de sécurité antérieurs

Le compte rendu précédent signalait un **jeton Render exposé dans des commandes**. Vérifie sa révocation/expiration via les moyens officiels ; ne reproduis jamais sa valeur. Si nécessaire, ouvre les paramètres Render et demande seulement la validation humaine indispensable. Une nouvelle connexion ne révoque pas automatiquement un ancien token. Ne lis pas ni n’imprime des fichiers de credentials pour les copier dans un chat.

Le dépôt avait été rendu public. Vérifie d’abord que l’intégration GitHub de Render peut accéder à **ce dépôt privé**, puis rétablis sa visibilité privée et vérifie un vrai déploiement depuis celui-ci. Ne casse pas la connexion au service en le rendant privé sans configurer les droits. N’accorde pas l’accès à tous les autres dépôts si ce n’est pas nécessaire.

Pas de suppression de service/dépôt, de token affiché, de secrets committés ni de réécriture destructive de l’historique sans validation. S’il y a un secret dans Git, révoquer d’abord ; discuter ensuite de la correction d’historique.

## 3 · Vérifier localement sans toucher à la base live

Cette V2 utilise Node natif, des SSE et zéro dépendance npm d’exécution. Il n’y a pas de React, Vite, Socket.IO ni dossier dist. `public` seul ne suffit pas.

```sh
npm run build
npm test
npm run test:smoke
```

Les tests automatiques créent leurs propres serveurs/bases isolées. Les valeurs de test présentes dans `tests` et `scripts/ui-server.mjs` ne sont jamais des credentials de production. Ne copie pas leurs utilisateurs dans le vrai déploiement.

Pour le navigateur, installer les dépendances de **test uniquement** dans un environnement autorisé : Python, `playwright`, `httpx`, et Chromium/Chrome. Puis lancer :

```sh
python scripts/test-ui.py
```

Ce mode fait une navigation normale. Le flag `--adapted` existe pour l’environnement de préparation qui bloquait même la navigation localhost : il ne constitue pas un test de cookies/navigation native ou du domaine publié. Ne l’utilise pas pour prétendre avoir validé le site public. Ne change aucune politique de sécurité de l’école.

Fais une vraie ouverture locale avec création de comptes et navigation native sur le PC Windows. Fixe un bug bloquant si tu en trouves un ; ne réécris pas les fonctionnalités et ne supprime pas les tests pour les faire passer.

## 4 · Configurer le stockage DURABLE avant publication

La V1 conservait les tables en mémoire. La V2 ajoute des comptes et un portefeuille persistant : **une base SQLite sur le disque éphémère d’un Render gratuit ferait perdre les comptes après redémarrage**.

Le connecteur distant est déjà implémenté dans `server/storage.js` pour libSQL/Turso SQL-over-HTTP `/v2/pipeline`. Crée ou utilise une **base dédiée au projet**, avec un token serveur limité à la base quand l’offre le permet. Vérifie la documentation et les conditions actuelles du fournisseur, la compatibilité SQL et les quotas/coûts AVANT de créer des ressources. N’active pas de facturation ou d’option payante sans accord. Ne prétends pas que le coût restera nul pour toute charge.

Variables de production :

| Variable | Valeur à configurer |
|---|---|
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | L’adresse HTTPS réelle existante du site |
| `TURSO_DATABASE_URL` | URL libSQL/Turso/HTTPS de la base dédiée |
| `TURSO_AUTH_TOKEN` | Token privé côté serveur uniquement |
| `ADMIN_USER` | Identifiant propriétaire, par défaut souhaité `waaxsi` |
| `ADMIN_PASSWORD_HASH` | Hash scrypt généré par le script fourni |
| `TRUST_PROXY_HOPS` | Nombre réellement vérifié de proxies de confiance, pas une valeur devinée |
| `PORT` | Valeur injectée par l’hébergeur, ne pas la figer arbitrairement |

La table `cr_snapshot` se crée automatiquement au premier démarrage. **Une seule instance/worker peut utiliser cette base.** Aucun PM2 cluster. Une instance de staging doit utiliser une **autre base** : ouvrir la même base prend possession du stockage et invalide le processus précédent.

Ne lance pas un serveur local avec la base de production pour « juste vérifier » pendant une partie. Teste le vrai connecteur sur une base temporaire séparée avant bascule. Exécute au minimum inscription, lecture/écriture de solde, double action identique, réouverture après arrêt, puis reprise d’un Cristaux et restitution d’un tapis interrompu. Les tests fournis simulent le protocole distant ; **ils ne prouvent pas que ton compte hébergé est correctement configuré**.

Alternative possible : vrai disque persistant avec `DATA_FILE` dessus et `PERSISTENT_STORAGE=1`. Cette solution peut exiger une offre payante : demander l’accord. **Ne mets jamais `PERSISTENT_STORAGE=1` uniquement pour supprimer l’erreur sur un disque éphémère.** Le code fourni ne possède pas de connecteur PostgreSQL ; ne renseigne pas une URL Postgres dans les variables Turso.

Prévois une sauvegarde privée et suis les quotas et le volume du snapshot. L’export admin n’est pas une sauvegarde complète d’authentification. Le système vise une classe, pas une plateforme commerciale. Voir les limites de 32 Mio, 500 comptes et registres non purgés dans l’architecture.

## 5 · Créer le vrai propriétaire sans mot de passe exposé

Aucun premier inscrit ne devient admin et aucun mot de passe par défaut n’est fourni. Utilise :

```sh
node scripts/admin-hash.mjs --generate --username waaxsi --out CHEMIN_ABSOLU_VERS_UN_DOSSIER_PRIVE_EXTERIEUR_AU_PROJET.json
```

Le dossier privé doit exister ; le script refuse un fichier situé dans le projet et refuse l’écrasement. Ne passe pas le mot de passe en argument de commande. Lis les champs avec un script sans les imprimer et configure seulement le nom et le **hash** dans l’environnement du service. Le token de base reste lui aussi une variable privée.

Donne au propriétaire accès au fichier privé local ou à une méthode sûre convenue ; ne colle pas ses valeurs dans un journal ou dans ta réponse. Explique où retrouver son identifiant et son mot de passe. Vérifie les permissions Windows. N’envoie pas ce fichier à GitHub ou au serveur statique.

Le bootstrap crée le compte au premier démarrage. Il ne remplace pas le mot de passe d’un admin déjà existant. Une collision avec un joueur préexistant exige une intervention explicite, jamais une promotion automatique de ce joueur. Configure le propriétaire **avant d’ouvrir les inscriptions au public**.

## 6 · Migration V1 → V2

La V1 n’avait pas ces comptes durables. Les sessions anonymes, soldes de table et pseudos V1 ne permettent pas une migration sécurisée de propriété vers les nouveaux comptes. Par défaut, annoncer une nouvelle connexion/inscription V2, avec 1 000 € fictifs par compte. Ne jamais importer un solde fourni par localStorage, une capture d’écran ou un client arbitraire comme autorité.

Préviens avant la bascule si des parties V1 sont actives, laisse-les se terminer si possible et n’efface pas silencieusement une vraie base existante. Si une V2 a déjà été installée, conserve sa base et ses comptes, ne relance pas une « remise à zéro ».

## 7 · Publier le serveur existant

Préserve le service, le domaine et le dépôt existants. Le fichier `render.yaml` est un **modèle de configuration**, pas une instruction de créer un service supplémentaire. Valide-le avec la version courante du CLI et vérifie le nom de région/runtime/plan et la version Node maintenue utilisée. Version testée lors de cette livraison : Node 22.16.0.

Commande build : `npm run build`. Commande start : `npm start`. Contrôle santé : `/api/health`. Un seul processus Node écoute sur `0.0.0.0:$PORT`. Ne déploie pas uniquement le frontend sur un hébergement statique. Configurer `PUBLIC_BASE_URL` permet les invitations correctes.

Les headers SSE `no-transform` et `X-Accel-Buffering: no` sont déjà codés. Vérifie néanmoins le vrai proxy et les délais du fournisseur. Aucun tunnel temporaire dépendant du PC, aucun contournement réseau scolaire. Pas de méthodes de keep-alive artificielles pour contourner les conditions du plan.

Déploie, attends l’état réellement opérationnel, contrôle les logs sans secrets et l’adresse HTTPS. Un simple build vert ou un statut de plateforme ne remplace pas les essais ci-dessous.

## 8 · Vérifier le domaine publié avant d’annoncer « terminé »

Avec deux sessions navigateur indépendantes (et un compte admin séparé), contrôler :

1. Le site et les assets V2, version `2.0.0` sur `/api/health`, cookies natifs et navigation HTTPS.
2. Création d’un compte, déconnexion/reconnexion, même portefeuille. Invitation avec la vraie URL, sans login requis au compte d’hébergement.
3. Table de poker avec deux joueurs, mains classiques puis favorisées avec accord explicite ; une main complète, cartes adverses non transmises, résultat net central, retournement 3D progressif.
4. Blackjack : règles inchangées, montant de mise, carte cachée du croupier non transmise, règlement. Roulette : mise de deux joueurs, même numéro final, bonne animation, paiement du bon résultat, pas de pari accepté après verrouillage.
5. Cristaux, Dice et Plinko : débit/crédit sur le même compte, résultat affiché cohérent. Une requête dupliquée ne redébite pas.
6. Compte admin : ajouter/retirer/fixer le disponible, motif/audit, mise à jour visible chez le joueur ; accès admin rejeté pour le joueur ; suspension et révocation ; aucun secret ou carte privée dans l’export.
7. Actualisation/reconnexion sans deuxième siège. Si le serveur est redémarré de façon annoncée : comptes/soldes toujours présents, réservations des mains interrompues rendues selon la règle, Cristaux actif restauré. Ne pas prétendre reprendre la main de poker au même instant : ce n’est pas implémenté.
8. SSE progressifs sur le domaine réel. Fonctionnement après arrêt du serveur local. Vue ordinateur et mobile, pas d’erreur JS bloquante ni bouton inaccessible. Un navigateur étroit n’équivaut pas à un vrai téléphone : nommer ce qui a été testé.

En cas de problème bloquant, corrige au strict nécessaire, relance les tests et redéploie. N’invente aucun résultat. Garde les scripts utiles au lieu de les supprimer après une exécution.

## 9 · Livraison à l’utilisateur

Ouvre le lien réel et donne : URL vérifiée, accès privé aux identifiants du propriétaire, fonctions publiées, tests réussis, limites et seule action humaine restante s’il y en a une. Ne demande pas au propriétaire d’écrire du code ou d’exécuter une longue liste de commandes : utilise tes outils et ne l’interromps que pour une connexion/autorisation/facturation qui lui appartient.

Écris dans le projet un `DEPLOIEMENT-EFFECTUE.md` sans secret, avec la révision Git, l’hébergeur, le mode de base, les tests publics et la procédure de retour arrière préservant les données. Un lien stable ne garantit pas l’absence de mise en veille ou d’interruption. Aucun « garanti sans bug », « fair-play certifié », « conforme à tous les hébergeurs » ou « gratuit pour toujours ».

## Documents primaires à vérifier

- Render, limites du plan gratuit : https://render.com/docs/free
- Render, disques persistants : https://render.com/docs/disks
- Render, connexion GitHub : https://render.com/docs/github
- Turso, protocole SQL HTTP : https://docs.turso.tech/sdk/http/reference
- Node, SQLite natif : https://nodejs.org/api/sqlite.html

L’absence de facturation autorisée ou d’accès à un service ne se contourne pas. Ouvre l’étape officielle correspondante et demande l’action humaine minimale.
