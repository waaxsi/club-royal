# Vérifications V2 — 18 septembre 2026

## Résultat de cette livraison

**103 tests automatisés réussis, 0 échec, 0 ignoré.** La commande `npm test` exécute uniquement les suites `*.test.js` ; les modules utilitaires ne sont pas comptés comme des tests. Journal brut : `resultats-tests-v2.txt`.

Environnement réel : Linux, Node.js 22.16.0, Chromium installé dans l’environnement de préparation. Aucun accès aux identifiants du propriétaire, au serveur Render ou à une vraie base Turso n’a été utilisé pour ces tests.

| Vérification | Exécuté / résultat |
|---|---|
| `npm run build` | 32 fichiers JavaScript vérifiés, sans bundler ni installation de dépendances. |
| `npm test` | 103 tests, tous réussis : moteurs V1 conservés et tests V2 supplémentaires. |
| `npm run test:smoke` | Vrai serveur HTTP temporaire : page, santé, création de compte, tables des trois jeux, Dice/Plinko, Cristaux et historique. |
| HTTP/SSE multijoueur | Deux vrais clients HTTP indépendants, cookies et jetons CSRF, main complète, données partagées et confidentialité des cartes. |
| Roulette | Paiements de toutes les catégories codées sur les 37 numéros ; verrouillage pendant la rotation et résultat commun. |
| Dice | 40 000 vérifications d’issues (10 000 issues pour chacune de quatre probabilités), seuil et paiement. |
| Plinko | Les 4 096 chemins binaires des 12 rangées, nombre de chemins par case, paiement et espérance avant arrondi. |
| Cristaux | Disposition fixe, secrets cachés, mines, récupération, annulation et calcul combinatoire des paiements. |
| Poker favorisé | Choix réel parmi 24 distributions, uniquement sur les mains privées de départ ; intégrité du paquet. |
| Comptabilité | Réservations, gains, tapis, changement de jeu, demandes répétées, pertes lors d’un départ, annulation, remboursement de reprise et état restauré après erreur. |
| Stockage local | Vrai fichier SQLite, fermeture/réouverture, comptes/sessions/Cristaux et exclusion de l’ancienne instance. |
| Adaptateur distant | API HTTP simulée sur un vrai SQLite local ; paramètres typés, CAS, réponse perdue après COMMIT et panne ambiguë. Pas le service Turso réel. |
| Administration | Contrôle du rôle, crédit audité visible en SSE, suspension, reset de mot de passe et changement obligatoire, export sans secrets, maintenance. |
| Bootstrap / production | Pas de premier inscrit admin, refus sans propriétaire/HTTPS/stockage déclaré durable, cookie Secure et données réseau masquées. Générateur privé testé sans mot de passe imprimé. |

## Contrôles d’interface exécutés

Script reproductible : `scripts/test-ui.py`. Le rapport JSON et **19 captures** sont dans `docs/apercus-v2/`.

Trois contextes de navigateur indépendants ont été utilisés : deux joueurs et un propriétaire de test. Les parcours portent sur l’accueil et l’authentification, une table de poker à deux joueurs avec consentement au mode favorisé, une main complète et son overlay central, le blackjack, la roulette, Cristaux avec récupération, Dice, Plinko, le registre du portefeuille et une modification administrative visible dans la session du joueur.

Les mêmes éléments de cartes restent présents après un changement d’état ; une matrice 3D intermédiaire pendant le retournement a été vérifiée. La taille réelle des cases Cristaux a été contrôlée. Les anciens overlays disparaissent lors d’un changement de jeu. La bille de roulette et Plinko affiche le résultat envoyé par le serveur.

Formats contrôlés : **1440 × 1000** et **390 × 844**. Résultat : aucune erreur JavaScript de page relevée, aucun débordement horizontal dans les captures contrôlées. Les mises en page ont aussi été regardées visuellement ; cela n’est pas un audit complet d’accessibilité ni une mesure de performances sur tous les appareils.

### Limite précise du test navigateur

La politique du Chromium fourni interdisait la navigation par URL, même vers localhost. Elle n’a pas été modifiée. Les vrais fichiers HTML/CSS/JS ont été rendus dans une page locale de test ; un adaptateur explicite a relié les appels HTTP et **de vrais flux SSE** à un serveur Node loopback isolé. Les sessions et communications sont réelles, mais **les mécanismes natifs de navigation, cookies, origines, chargement des modules et HTTPS du navigateur ne sont pas validés par cet adaptateur**.

Les tests HTTP séparés ont bien vérifié les routes, en-têtes, cookies émis et protections serveur. Gemini doit lancer la version sans `--adapted` dans un navigateur normal, puis tester le domaine public.

## Ce qui n’a PAS été fait

- Aucun déploiement de cette V2 sur Render ; le lien public existant n’a pas été testé avec ce nouveau code.
- Aucune connexion à un vrai compte Turso ; ses identifiants, ses quotas et sa conservation après redémarrage doivent être vérifiés.
- Pas de test Windows ou sur un vrai téléphone, ni de connexion entre PC de l’école.
- Pas de modification de ton dépôt GitHub, de tes permissions ou de révocation effective du token précédemment signalé. Ces étapes sont dans le handoff Gemini.
- Pas de test de charge de centaines d’utilisateurs, d’audit de sécurité indépendant, de certification ou de garantie d’absence de défaut.

## Contrôle de l’archive extraite

Le ZIP a été extrait dans un nouveau dossier, les empreintes des fichiers vérifiées, puis `npm run build`, les **103 tests** et le smoke relancés avec succès, sans `npm install`. Le véritable point d’entrée `node server/index.js` a également été lancé depuis cette copie : page servie, inscription, mini-jeu, sauvegarde SQLite, arrêt SIGTERM, redémarrage et récupération du même solde et de la même session vérifiés. Ces opérations restent locales sous Linux, pas sur Windows/Render.

## Reproduction

```sh
npm run build
npm test
npm run test:smoke
```

Les tests ne réclament aucun secret réel et n’utilisent aucune base de production. Pour les tests visuels normaux, dans un environnement autorisé disposant de Python, Playwright, httpx et Chromium :

```sh
python scripts/test-ui.py
```

Le mode de préparation utilisé ici était `python scripts/test-ui.py --adapted`. Ce mode est limité à un serveur loopback.

Les logs historiques sous `docs/v1/` décrivent l’ancienne livraison. Ils ne sont pas additionnés aux tests V2 et ne prouvent pas le fonctionnement de la version publiée.
