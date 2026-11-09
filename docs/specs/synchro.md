# Conception : synchronisation chiffrée de bout en bout (Firebase)

- Version : 1.0
- Auteur : FRE (Fidag)
- Date : 2026-11-09
- Version de l'app concernée : 0.8.1 → 0.9.0

## 1. Objectif et décisions

- Sauvegarde / synchronisation **chiffrée de bout en bout** vers Firebase (offre gratuite Spark). Firebase ne voit jamais de données en clair.
- **Option A** : un seul compte Firebase (UID `BgSfJCtyQ5TL0YRxWEOJG0YmFp22`), utilisé sur les deux iPad (celui de l'auteur et celui de sa maman). Chaque iPad crée sa propre passkey ; la phrase de passe de secours est commune.
- **SDK Firebase 13.2.0 copié dans le dépôt** (`app/vendor/firebase/13.2.0/`), pas de CDN : l'app démarre hors ligne, la CSP n'autorise aucun script externe.
- **Cache local en clair** (IndexedDB, protégé par le code de l'iPad) : l'app s'ouvre comme avant ; le déverrouillage (Face ID ou phrase de passe) sert à synchroniser.
- Pas de Cloud Storage, pas de Cloud Functions.

## 2. Données dans Firestore

```
users/{uid}/keys/passphrase           enveloppe de la DEK par la phrase de passe
users/{uid}/keys/pk_{h}               une enveloppe par passkey (h = 16 premiers caractères hex de SHA-256(credentialId))
users/{uid}/records/{docId}           un document chiffré par enregistrement
```

### Enregistrement (`records/{docId}`)

| Champ | Contenu |
|---|---|
| `v` | 1 |
| `iv` | 12 octets aléatoires (base64) |
| `ct` | AES-GCM( { store, id, data \| null, updatedAt, deleted } ), données authentifiées `users/{uid}/records/{docId}/v1` |
| `updatedAt` | date de la modification (ms, horloge de l'appareil) : « dernière écriture gagnante » |
| `deleted` | vrai pour une suppression (trace) |
| `syncedAt` | heure du serveur (`serverTimestamp()`) : sert à ne relire que ce qui a changé |

- `docId` = HMAC-SHA256(clé dérivée de la DEK, `store/id`) en hexadécimal (40 caractères). Les identifiants locaux (ex. `2026-10-03|-6480|****1111|MIGROS M SION|0`) ne sont **jamais** visibles par Firebase.
- Tables synchronisées : `people`, `accounts`, `categories`, `transactions`, `rules`, `imports`. Restent sur l'appareil : `settings` (dates de sauvegarde, état de synchro…) et `outbox`.

### Enveloppes de la clé

| Document | Champs |
|---|---|
| `keys/passphrase` | `v`, `kdf: "PBKDF2-SHA256"`, `iterations` (≥ 600 000), `salt` (16 o), `iv`, `wrappedDek`, `createdAt` |
| `keys/pk_{h}` | `v`, `credentialId` (base64url), `prfSalt` (32 o), `hkdfSalt` (32 o), `info`, `iv`, `wrappedDek`, `label`, `createdAt` |

## 3. Chiffrement (Web Crypto uniquement)

- **DEK** : 32 octets aléatoires (AES-GCM 256). Elle chiffre toutes les données ; IV aléatoire de 12 octets à chaque chiffrement.
- Au déverrouillage, la DEK est importée comme clé AES-GCM **non extractible** ; une clé HMAC (noms de documents) en est dérivée par HKDF-SHA256 (`info = "MonBudget doc-id v1"`). Les octets bruts sont ensuite effacés de la mémoire. La DEK n'est jamais écrite (ni IndexedDB, ni Firestore en clair, ni journaux).
- **Enveloppe phrase de passe** : PBKDF2-SHA256, 600 000 itérations, sel aléatoire de 16 octets → clé AES-GCM 256 → chiffrement de la DEK.
- **Enveloppe passkey** : passkey de plateforme (trousseau iCloud), `rpId = "msdpfw872r-glitch.github.io"`, `userVerification: "required"`, extension **PRF** (`eval.first = prfSalt`). Le secret PRF (32 octets) passe dans HKDF-SHA256 (`salt = hkdfSalt`, `info = "MonBudget DEK wrap v1"`) → clé AES-GCM 256 → chiffrement de la DEK.
- Si PRF n'est pas pris en charge : phrase de passe seule (message clair).
- Ajouter une passkey plus tard demande la phrase de passe (la DEK courante n'est pas extractible).
- **Perte de la phrase de passe ET de toutes les passkeys = données du cloud irrécupérables** : affiché en rouge à la configuration, avec case « J'ai compris » obligatoire. (Les données restent sur l'iPad et dans les sauvegardes fichiers.)

## 4. Synchronisation

- **Suivi local** (schéma IndexedDB 3) : chaque écriture sur une table synchronisée reçoit `updatedAt` et une entrée dans `outbox` ; une suppression laisse une entrée `outbox` « supprimé ».
- **Au déverrouillage** puis à chaque modification (et au retour en ligne) :
  1. relire les documents dont `syncedAt` > dernière heure serveur vue ;
  2. déchiffrer ; pour chaque enregistrement, garder le plus récent (`updatedAt`) — **dernière écriture gagnante** ;
  3. chiffrer et écrire les entrées de `outbox` (lots de 400) ; les retirer de `outbox` si elles n'ont pas changé entre-temps.
- **Premier lancement / nouvel appareil** : toutes les données locales sont mises dans `outbox`, puis fusionnées (migration des données existantes).
- **Restaurer une sauvegarde fichier** : les données restaurées deviennent les plus récentes et remplacent celles du cloud (avertissement dans l'écran de restauration).
- Hors ligne : l'app fonctionne normalement ; `outbox` garde les changements jusqu'au retour du réseau.

## 5. Sécurité

- `firestore.rules` : lecture / écriture seulement si `request.auth.uid == "BgSfJCtyQ5TL0YRxWEOJG0YmFp22"` et sous `users/{ce uid}/…` ; tout le reste refusé.
- Connexion : `signInWithEmailAndPassword`, persistance `browserLocalPersistence`, pas d'inscription (désactivée dans la console).
- CSP : `script-src 'self'` ; `connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com`.
- La configuration Firebase (`apiKey`…) n'est pas secrète.

## 6. Quotas Spark (ordre de grandeur)

- Migration de ~1 400 enregistrements ≈ 1 400 écritures (limite 20 000 / jour).
- Ensuite : seulement les changements (lectures incrémentales par `syncedAt`).

## 7. Tests

- Automatiques (Node) : suivi des changements, chiffrement (enveloppes, mauvaise phrase, IV uniques, noms HMAC), fusion « dernière écriture gagnante », migration, suppressions, file hors ligne, avec un faux Firestore en mémoire.
- Sur iPad (checklist) : connexion, création de la passkey (PRF), déverrouillage, hors ligne, phrase de passe de secours, second iPad.

---
Historique
- 1.0 (2026-11-09, FRE (Fidag)) : version initiale.
