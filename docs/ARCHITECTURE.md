# Architecture V2 — petit serveur de classe, un seul processus

## Transport et responsabilités

Node natif sert `public/index.html`, les modules et styles autorisés, ainsi que `/api/*`. Le multijoueur utilise de vraies connexions **SSE** pour les états et du **HTTP JSON** pour les actions. Ce n’est pas une application Socket.IO/WebSocket ni React/Vite. Un même domaine HTTPS doit couvrir page, API et SSE ; les clients utilisent des chemins relatifs.

`server/index.js` : sessions HTTP, validation d’origine, protection CSRF, limitation des tentatives, routes, SSE et contrôles de déploiement. Un flux envoie uniquement la vue publique du compte concerné. Les cartes adverses et la carte cachée du croupier ne partent pas au navigateur. `server/hub.js` : file d’exécution sérialisée, comptes, registre, règles d’accès, idempotence, réservations et rapprochement des résultats. `hub-rooms.js` adapte les moteurs V1 au portefeuille et à la roulette. `poker.js`, `blackjack.js`, `roulette.js`, `minigames.js` sont les règles de jeu. `boost.js` choisit les mains de départ favorisées, uniquement au poker.

## Unité et comptabilité

Tous les montants : **centimes entiers sûrs**. Les calculs combinatoires de minis utilisent BigInt avant l’arrondi final au centime. Entrer à une table réserve un montant dans `escrows` et débite exactement autant le disponible. Le `balance` de cette réservation est le tapis de référence après la dernière main complètement réglée.

Le moteur conserve les tapis courants et pots pendant une main. À `results`, `reconcile()` calcule les écarts de tapis et inscrit les résultats une seule fois par main, puis met à jour les réservations. À la sortie, seule la réservation réelle est rendue. Un siège quittant une main reste lié au compte jusqu’à la fin. Les robots n’ont pas de comptes persistants : leurs jetons représentent de la monnaie de jeu, pas une monnaie globalement à somme constante.

Les mini-jeux atomiques débitent, tirent le résultat et créditent dans la même mutation durable. Cristaux réserve la mise une fois, sauvegarde les mines et cases ouvertes à chaque action puis crédite lors du cash-out ou de l’annulation autorisée. Son plateau caché reste exclusivement côté serveur.

Un identifiant d’action, son empreinte et sa réponse sont conservés. Deux appels identiques ne déclenchent pas un deuxième débit ; réutiliser l’identifiant avec une autre action est rejeté. Les IDs de main et séquence du tour empêchent les actions de table périmées. L’interface réessaie au plus une fois une requête perdue, avec le même identifiant.

## Stockage et déploiement

`server/storage.js` expose `SnapshotStore` :

- SQLite natif (`node:sqlite`) sur fichier local durable, WAL et `synchronous=FULL`.
- Adaptateur distant à l’API libSQL/Turso `/v2/pipeline`, JSON typé, autorisation serveur HTTPS. Aucun token côté client.

Une table `cr_snapshot` contient une seule ligne avec `revision`, `owner`, `payload`. L’écriture remplace atomiquement le snapshot JSON via `UPDATE … WHERE owner=? AND revision=? RETURNING revision`. Une nouvelle instance prend possession du stockage et invalide l’ancienne. Ce mécanisme est un garde-fou lors d’un remplacement, **pas un mécanisme multi-réplicas**.

Le serveur sérialise lectures et mutations ; une réponse portant sur un solde modifié n’est publiée qu’après confirmation du stockage. Une réponse HTTP perdue après COMMIT est réconciliée en relisant l’ID de commit. En cas d’ambiguïté persistante, les mises s’arrêtent (échec fermé), pas de débit répété au hasard. En cas d’erreur confirmée, l’état local sauvegardé avant la mutation est restauré.

Les tables en direct restent en mémoire. Au redémarrage, les réservations persistées sont libérées : une main interrompue est annulée, la dernière main entièrement réglée reste prise en compte. Une fermeture administrative d’une table annule de la même manière une main non réglée et inscrit le motif. Les explorations Cristaux sont restaurées, pas les salons.

**Staging et production doivent avoir des bases séparées** : démarrer un test sur la base live en prendrait possession et fermerait les écritures du serveur live. Un seul processus, pas de PM2 cluster, worker multiplié ou deuxième service actif sur cette même base. Arrêt SIGTERM/SIGINT : arrêter les connexions, fermer/restituer les tables si encore propriétaire, fermer le stockage.

## Authentification et administration

Mots de passe scrypt N=32768, r=8, p=1, sel aléatoire, clé 64 octets ; comparaison constante. Les cookies sont HttpOnly/SameSite=Strict et Secure en production HTTPS. Les tokens bruts ne sont conservés que dans les cookies ; la base stocke leurs empreintes SHA-256. Sessions de 7 jours, au plus 5 par compte. Profil/administration protégés côté serveur, pas uniquement par le menu.

Le bootstrap propriétaire exige `ADMIN_USER` et `ADMIN_PASSWORD_HASH`. Aucun « premier visiteur admin ». Collision avec un compte joueur : refus. Changement de mot de passe ou reset : sessions révoquées. Le reset d’un joueur impose de changer le mot de passe avant de jouer. On ne peut pas s’autopromouvoir depuis un payload client.

Chaque ajustement administratif demande un motif. Ajouter/retirer/fixer modifie uniquement le disponible, pas un tapis actif. Suspension, réinitialisation, fermeture de table, annulation Cristaux et paramètres sont audités. Export : comptes publics, registre, audit — sans hashes, tokens ni plateau de mines caché. Il reste un document personnel à conserver en privé.

Origines : `PUBLIC_BASE_URL` explicite en production, aucun `X-Forwarded-Host` arbitraire utilisé pour créer un lien. `TRUST_PROXY_HOPS` vaut zéro en local et doit être vérifié devant le proxy. Quotas par compte et quotas IP distincts, afin de ne pas traiter tous les élèves derrière le même routeur comme une seule session. Le site n’expose pas les adresses LAN du serveur en production.

## Interface

`cards-ui.js` conserve les éléments par room/main/siège/index et anime leurs deux faces via rotateY/backface-visibility. `effects.js` gère résultats centraux, comptage progressif, son optionnel et mouvement réduit ; le changement de page retire le résultat de l’ancien jeu. `art.js` dessine la roue de 37 secteurs, les gemmes et Plinko en SVG, sans assets externes. `app.js` compose les pages et les événements ; l’apparence n’est jamais la source d’un résultat financier.

## Limites et coûts à surveiller

Maximum 500 comptes dans le code, un snapshot limité à 32 Mio, listes de sessions/actions/registre dans ce snapshot. Le registre et les clés d’idempotence s’accumulent volontairement ; aucun effacement comptable automatique. Les écritures réécrivent le snapshot entier ; charge, temps de hachage, trafic distant et quotas hébergeur augmentent avec son volume. L’interface ne fournit pas encore un outil d’archivage/restauration tout-en-un.

Avant un usage soutenu, prévoir des sauvegardes privées cohérentes, suivre la taille et les quotas, et remplacer le stockage par un schéma relationnel transactionnel à lignes séparées si nécessaire. Le code ne promet ni 500 utilisateurs simultanés, ni 24/7, ni coût nul permanent. Les chemins d’échec du stockage ont été testés localement, le service distant doit être testé en situation réelle.
