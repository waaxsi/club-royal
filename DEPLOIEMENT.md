# Déploiement et Exploitation — CLUB ROYAL

## 1. Hébergement et Choix d'Architecture

- **Hébergeur :** Render (Web Service Node.js natif).
- **Région :** Frankfurt (eu-central) / Oregon.
- **Environnement d'exécution :** Node.js >= 22 (Node 24).
- **Plan :** Gratuit (Free Tier) — 0 €, sans engagement de carte bancaire, sans frais cachés.
- **Type de service :** `Web Service` avec écoute sur `0.0.0.0` et prise en charge du port dynamique `process.env.PORT`.
- **Réseau & Protocole :** Origine unique HTTPS pour l'interface statique, l'API REST JSON et les flux d'événements serveur **Server-Sent Events (SSE)**.
- **Optimisation SSE :** En-têtes `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` et `Connection: keep-alive` configurés pour garantir la diffusion fluide et instantanée des événements de jeu sans mise en tampon intermédiaire par le proxy.

---

## 2. Caractéristiques et Limites du Service

- **Stockage en mémoire :** Toutes les tables et sessions sont conservées dans la mémoire vive du processus Node.js unique. Un redémarrage du serveur efface les tables actives ; les joueurs déconnectés reçoivent un message clair invitant à rejoindre ou créer une nouvelle table.
- **Mise en veille (Cold Start) :** Sur le plan gratuit Render, le conteneur s'endort automatiquement après 15 minutes d'inactivité totale. La première visite après inactivité prend entre 30 et 50 secondes pour réveiller le serveur. Une fois réveillé, le jeu est instantané.
- **Quotas gratuits :** 750 heures d'instance gratuites par mois (suffisant pour un service permanent) et 100 Go de bande passante mensuelle.
- **Jetons 100 % fictifs :** Jeu strictement récréatif et éducatif pour la classe, sans argent réel, sans micropaiement et conforme aux conditions d'utilisation des hébergeurs.

---

## 3. Sécurité et Protections Réseau

- **Confidentialité des cartes :** Le serveur filtre rigoureusement chaque vue joueur (`RoomManager.view()`). Les cartes privées adverses ne sont jamais transmises sur le réseau avant l'abattage (showdown).
- **Anti-collusion & Anti-abus :**
  - Validation stricte des tours, numéros de main et séquences d'action côté serveur.
  - Limitation de débit (Rate Limiting) : découplée par jeton d'authentification pour les actions de jeu et par IP validée pour la création/rejointe de table, afin de ne pas bloquer une classe entière partageant la même connexion réseau scolaire ou le même proxy.
  - Masquage des adresses IP internes LAN sur `/api/info` en production.
  - En-têtes HTTP de sécurité stricts (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy).

---

## 4. Procédure de Mise à Jour

1. Modifier le code dans le dossier du projet.
2. Vérifier la syntaxe et les tests :
   ```sh
   npm run build
   npm test
   ```
3. Valider les changements avec Git :
   ```sh
   git add .
   git commit -m "Mise à jour : description des changements"
   git push origin main
   ```
4. Render détecte automatiquement le nouveau commit sur la branche `main` et redéploie le Web Service sans intervention supplémentaire.

---

## 5. Synthèse des Vérifications Effectuées

- **Tests unitaires et d'intégration :** 69 tests automatisés natifs réussis (100 % de réussite).
- **Parcours vérifiés :**
  - Page d'accueil, affichage dynamique et guide/tutoriel express.
  - Poker solo contre 3 robots avec gestion des mises et relances.
  - Blackjack solo contre le croupier avec respect des règles S17.
  - Création de salon privé avec code à 6 caractères.
  - Multijoueur à 2 sessions indépendantes avec vérification stricte de l'isolation des cartes privées.
  - Navigateur Google Chrome réel (mode automatisé CDP) : 0 erreur JavaScript en console, interface réactive et complète.
