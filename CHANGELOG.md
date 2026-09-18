# CLUB ROYAL 2.0.0 — modifications livrées

## Interface remplacée

- `public/index.html`, `styles.css`, `app.js` : nouveau salon, six jeux, navigation, pages compte/portefeuille/admin, responsive, tutoriels.
- `public/cards-ui.js` : cartes à faces conservées entre les états, retournement progressif en 3D.
- `public/effects.js` : gain net au centre, compteur, particules légères, audio optionnel, respect du mouvement réduit, nettoyage lors des changements de page.
- `public/art.js`, `favicon.svg` : identité et illustrations locales originales, roue, gemmes, dé 3D et Plinko.

## Serveur et données

- `server/index.js` : routes V2 authentifiées, cookies, CSRF, streaming SSE, limitations et démarrage production protégé.
- `hub.js`, `hub-rooms.js` : comptes, portefeuille partagé, réservations, historique, administration et rapprochement des tables.
- `storage.js`, `security.js` : stockage SQLite/libSQL-Turso HTTP, écritures atomiques mono-instance, mots de passe scrypt et sessions.
- `roulette.js`, `minigames.js` : nouveaux moteurs de jeux.
- `boost.js` : meilleure distribution collective de départ au poker, annoncée et optionnelle.
- `poker.js`, `blackjack.js` : conservation des règles et ajouts ciblés de montants en centimes/affichage euro. Les règles du blackjack ne sont pas favorisées.

## Livraison et vérification

- Scripts de hash propriétaire, syntaxe, suites automatisées, smoke et tests navigateur reproductibles.
- `.env.example`, `.node-version`, `render.yaml`, lanceurs Windows, README et handoff Gemini.
- Test de l’adaptateur Turso contre un simulateur HTTP sur SQLite ; vrai hébergeur à vérifier.
- Captures de 6 jeux, accueil, portefeuille et administration, ordinateur/mobile.
- Rapports V1 séparés sous `docs/v1`, empreintes de la base dans `docs/BASE-V1-SHA256.json`.

## Non inclus / à faire au déploiement

Publication du service réel, connexion à une base durable hébergée, création du vrai propriétaire, contrôle des autorisations GitHub/Render, révocation de l’ancien token signalé, tests publics natifs et Windows. Pas de mots de passe réels ou tokens d’hébergement dans le ZIP. Pas de garantie de copie exacte du dépôt live : Gemini doit comparer et fusionner ses changements intermédiaires.
