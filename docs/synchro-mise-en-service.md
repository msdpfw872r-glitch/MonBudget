# Synchronisation chiffrée : mise en service et tests sur iPad

- Version : 1.0
- Auteur : FRE (Fidag)
- Date : 2026-11-09
- Version de l'app : 0.9.0

## 1. Console Firebase (une seule fois)

Projet `monbudgetapp-98452`.

1. **Firestore** : base créée en `europe-west6` (Zurich), mode production.
2. **Règles de sécurité** : copier le contenu de [`firestore.rules`](../firestore.rules) dans
   Console Firebase › Firestore Database › **Règles**, puis **Publier**.
   Autre possibilité, avec la ligne de commande Firebase (depuis la racine du dépôt) :
   ```
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules
   ```
   (`firebase.json` et `.firebaserc` sont déjà dans le dépôt.)
   Vérification : Console › Firestore › Règles › **Terrain de jeu des règles** : une lecture de
   `/users/BgSfJCtyQ5TL0YRxWEOJG0YmFp22/records/x` non authentifiée doit être **refusée**,
   authentifiée avec cet UID **autorisée**, avec un autre UID **refusée**.
3. **Authentication** › Méthode de connexion : **Adresse e-mail/Mot de passe** activée ; l'utilisateur
   (UID `BgSfJCtyQ5TL0YRxWEOJG0YmFp22`) existe.
4. **Authentication** › Paramètres › Actions de l'utilisateur : **décocher « Activer la création (inscription) »**
   (personne ne peut créer de compte depuis l'app).
5. (Conseillé) Google Cloud Console › API et services › Identifiants › clé « Browser key » :
   restriction **Référents HTTP** `https://msdpfw872r-glitch.github.io/*`. La clé n'est pas secrète,
   mais cela évite qu'elle serve ailleurs.
6. Pas de Cloud Storage, pas de Cloud Functions : l'offre gratuite Spark suffit.

## 2. Premier iPad (celui qui crée le coffre)

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 1 | Ouvrir l'app depuis l'écran d'accueil, Réglages › **Synchronisation entre les iPad** | Écran « Se connecter » | ☐ |
| 2 | Mauvais mot de passe | « Adresse e-mail ou mot de passe incorrect. » | ☐ |
| 3 | Bon e-mail et mot de passe | Écran rouge « la phrase de passe ne peut pas être retrouvée » et formulaire « Créer le coffre » | ☐ |
| 4 | Phrase trop courte, puis deux phrases différentes | Message clair à chaque fois, rien n'est créé | ☐ |
| 5 | Phrase correcte ×2, nom « iPad de … », cocher « J'ai compris », Créer, « Oui, elle est écrite » | « Synchronisation active », puis 0 changement en attente | ☐ |
| 6 | Console Firestore › `users/{uid}/records` | Documents avec seulement `v`, `iv`, `ct`, `updatedAt`, `deleted`, `syncedAt` ; noms illisibles ; **aucun texte lisible** (ni commerçant, ni montant) | ☐ |
| 7 | **Activer Face ID** (nom de l'iPad) | Fenêtre Face ID « Mon Budget » (une ou deux fois) ; puis « Face ID est activé sur cet iPad » ; un document `keys/pk_…` apparaît | ☐ |
| 8 | **Verrouiller**, revenir à l'Accueil | Bandeau orange « Synchronisation en pause » | ☐ |
| 9 | **Déverrouiller avec Face ID** | Le bandeau disparaît | ☐ |
| 10 | Fermer l'app complètement (balayer vers le haut), la rouvrir | L'app s'ouvre avec les données (sans Face ID) ; bandeau « en pause » ; Face ID → synchro | ☐ |

## 3. Hors ligne

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 11 | Mode Avion, trier 2 opérations | L'app fonctionne normalement ; Réglages › Synchronisation : « 2 changements en attente » (ou plus) et « Pas de connexion à Internet… » | ☐ |
| 12 | Couper le mode Avion, revenir dans l'app | Quelques secondes plus tard : 0 en attente | ☐ |
| 13 | Mode Avion, fermer et rouvrir l'app | L'app s'ouvre (SDK en cache) ; Face ID → « Pas de connexion à Internet… », rien de perdu | ☐ |

## 4. Deuxième iPad (celui de Maman)

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 14 | Installer l'app (Safari › Partager › Sur l'écran d'accueil), Réglages › Synchronisation, se connecter (même compte) | Écran « Ouvrir les données du cloud » (pas de création de coffre) | ☐ |
| 15 | Mauvaise phrase de passe | « Phrase de passe incorrecte… » | ☐ |
| 16 | Bonne phrase de passe (nom « iPad de Maman ») | Les opérations, règles, catégories du premier iPad apparaissent | ☐ |
| 17 | Activer Face ID sur cet iPad | Un deuxième document `keys/pk_…` | ☐ |
| 18 | Trier une opération sur l'iPad 2 ; sur l'iPad 1, revenir dans l'app | L'opération est triée aussi sur l'iPad 1 (Accueil / Journal mis à jour) | ☐ |
| 19 | Modifier la même opération sur les deux iPad (hors ligne l'un des deux), puis reconnecter | La modification la plus récente gagne partout | ☐ |
| 20 | Annuler un import sur l'iPad 1 | Les opérations disparaissent aussi sur l'iPad 2 | ☐ |

## 5. Phrase de passe de secours

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 21 | Sur un iPad : Se déconnecter de cet iPad (confirmer) | Plus de bandeau ; les données restent sur l'iPad | ☐ |
| 22 | Se reconnecter, ouvrir **avec la phrase de passe** (sans Face ID) | Synchronisation active, données intactes | ☐ |
| 23 | Réactiver Face ID | Fonctionne | ☐ |

## 6. Sauvegarde fichier et restauration

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 24 | Restaurer une sauvegarde sur l'iPad 1 | L'écran rouge mentionne « ces données remplaceront aussi celles du cloud et de l'autre iPad » | ☐ |
| 25 | Après restauration, synchro, puis ouvrir l'iPad 2 | L'iPad 2 a exactement les données de la sauvegarde | ☐ |

## 7. Si quelque chose ne va pas

- **Face ID ne se propose pas** : iPadOS trop ancien pour l'extension PRF ; la phrase de passe fonctionne toujours.
- **« Ce compte n'a pas accès aux données »** : règles Firestore non publiées ou autre UID (§ 1.2).
- **« La limite gratuite du jour est atteinte »** : quota Spark (20 000 écritures / 50 000 lectures par jour) ; reprise le lendemain, rien n'est perdu.
- Les données sont toujours sur chaque iPad : en cas de doute, **Sauvegarder maintenant** avant d'essayer autre chose.

---
Historique
- 1.0 (2026-11-09, FRE (Fidag)) : version initiale.
