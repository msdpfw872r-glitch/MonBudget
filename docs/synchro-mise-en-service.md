# App verrouillée et synchronisation chiffrée : mise en service et tests sur iPad / iPhone

- Version : 2.0
- Auteur : FRE (Fidag)
- Date : 2026-11-09
- Version de l'app : 0.10.3

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

## 2. Premier appareil (crée l'espace chiffré)

Toujours ouvrir l'app depuis **l'icône de l'écran d'accueil** (Safari et l'icône ont des données séparées).

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 1 | Ouvrir l'app | Écran **Bienvenue** (e-mail, mot de passe) ; rien de l'app n'est visible | ☐ |
| 2 | Mauvais mot de passe | « Adresse e-mail ou mot de passe incorrect. » | ☐ |
| 3 | Bon e-mail et mot de passe | Écran rouge « Choisissez votre phrase de secours » (si un espace existe déjà : « Ouvrir vos données sur cet appareil », voir § 4) | ☐ |
| 4 | Phrase trop courte, puis deux phrases différentes | Message clair, rien n'est créé | ☐ |
| 5 | Phrase ×2, nom de l'appareil, « J'ai compris », Créer, « Oui, elle est écrite » | « Ouvrir l'app avec Face ID ? » | ☐ |
| 6 | **Activer Face ID** | Fenêtre Face ID « Mon Budget » (une ou deux fois), puis l'Accueil | ☐ |
| 7 | Console Firestore › `users/{uid}/records` | Documents illisibles (`v`, `iv`, `ct`, `updatedAt`, `deleted`, `syncedAt`) | ☐ |
| 8 | Réglages › **Compte et synchronisation** | L'e-mail, « Dernière synchronisation », 0 en attente, Face ID activé | ☐ |

## 3. Verrouillage

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 9 | Quitter l'app, regarder le sélecteur d'apps | L'aperçu de Mon Budget ne montre aucun chiffre | ☐ |
| 10 | Revenir avant 1 minute | L'app est toujours ouverte | ☐ |
| 11 | Revenir après plus d'1 minute | « Mon Budget est verrouillé » ; Face ID se propose tout seul (sinon toucher « Ouvrir avec Face ID ») | ☐ |
| 12 | Fermer l'app complètement (balayer vers le haut), la rouvrir | Écran verrouillé, Face ID | ☐ |
| 13 | Sur l'écran verrouillé : « Utiliser la phrase de secours » | Ouvre l'app avec la phrase | ☐ |
| 14 | Réglages › Compte › **Verrouiller maintenant** | Écran verrouillé tout de suite | ☐ |

## 4. Hors ligne

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 15 | Mode Avion, fermer et rouvrir l'app | Écran verrouillé ; **Face ID ouvre l'app sans Internet** | ☐ |
| 16 | Trier 2 opérations en mode Avion | Réglages › Compte : changements en attente + « Pas de connexion à Internet… » | ☐ |
| 17 | Couper le mode Avion, revenir dans l'app | Quelques secondes plus tard : 0 en attente | ☐ |

## 5. Deuxième appareil (iPad de Maman, iPhone)

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 18 | Installer l'app (Safari › Partager › Sur l'écran d'accueil), l'ouvrir depuis l'icône, se connecter (même compte) | « Ouvrir vos données sur cet appareil » | ☐ |
| 19 | Mauvaise phrase de secours | « Phrase de secours incorrecte… » | ☐ |
| 20 | Bonne phrase, puis Activer Face ID | Les données du premier appareil apparaissent | ☐ |
| 21 | Trier une opération ici ; rouvrir l'app sur le premier appareil | L'opération est triée là aussi | ☐ |
| 22 | Modifier la même opération sur les deux (l'un hors ligne), puis reconnecter | La modification la plus récente gagne partout | ☐ |

## 6. Déconnexion et sauvegarde fichier

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 23 | Réglages › Compte › **Se déconnecter et effacer cet appareil** | Confirmation (avertit si des changements n'ont pas pu partir) ; puis écran Bienvenue | ☐ |
| 24 | Se reconnecter sur ce même appareil, phrase de secours | Les données reviennent depuis le cloud | ☐ |
| 25 | Restaurer une sauvegarde fichier | L'écran rouge dit que les données remplaceront aussi celles des autres appareils ; après synchro, l'autre appareil a les mêmes données | ☐ |

## 7. Si quelque chose ne va pas

- **Face ID ne se propose pas** : iPadOS / iOS trop ancien pour l'extension PRF ; la phrase de secours fonctionne toujours.
- **Un espace existe déjà** (essai avec la version 0.9) : se connecter puis taper la phrase choisie à ce moment-là.
- **« Ce compte n'a pas accès aux données »** : règles Firestore non publiées ou autre UID (§ 1.2).
- **« La limite gratuite du jour est atteinte »** : quota Spark (20 000 écritures / 50 000 lectures par jour) ; reprise le lendemain, rien n'est perdu.
- En cas de doute, **Sauvegarder maintenant** (fichier) avant d'essayer autre chose : ne pas se déconnecter s'il reste des changements en attente.

---
Historique
- 1.0 (2026-11-09, FRE (Fidag)) : version initiale.
- 2.0 (2026-11-09, FRE (Fidag)) : app verrouillée (0.10) : connexion au premier lancement, verrouillage après une minute, déconnexion qui efface.
