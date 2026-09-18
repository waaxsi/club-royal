# Sources et périmètre

## Base du projet

Cette V2 reprend l’archive fournie dans cette conversation `Club-Royal-Poker-Blackjack.zip`. Les empreintes des fichiers de départ sont dans `BASE-V1-SHA256.json`. Le journal d’Antigravity a fourni le contexte du service Render et les modifications de transport annoncées. Ce journal contenait un secret ; il n’est PAS inclus dans cette livraison.

Le code écrit ici, les graphismes CSS/SVG, les probabilités calculées dans les moteurs et les résultats de tests V2 sont des éléments de cette livraison, pas des assertions empruntées au compte rendu V1. Voir `VERIFICATIONS.md`.

## Documentation technique primaire consultée

- Node.js — module SQLite : https://nodejs.org/api/sqlite.html
- Turso — SQL over HTTP, protocole et URL : https://docs.turso.tech/sdk/http/reference
- Render — hébergement gratuit, stockage éphémère et mises en veille : https://render.com/docs/free
- Render — disques persistants : https://render.com/docs/disks
- Render — intégration GitHub : https://render.com/docs/github

Ces pages décrivent des services et peuvent évoluer. Les vérifier à nouveau au déploiement. L’adaptateur distant ne remplace pas une vérification réelle avec la base du compte propriétaire.

## Inspiration des mini-jeux

Le choix des mécaniques Dice, mines et Plinko reprend des catégories courantes d’interfaces de casino mentionnées par l’utilisateur. Les règles visibles et les formules exactes de CETTE implémentation sont définies par `server/minigames.js`, testées dans `tests/casino-v2.test.js` et expliquées dans l’interface. Aucun code, logo, capture, son, modèle 3D ou asset de Stake, MyStake ou Evolution n’est redistribué. Aucun lien d’affiliation ni paiement.
