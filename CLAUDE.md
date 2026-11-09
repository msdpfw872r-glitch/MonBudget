# CLAUDE.md — Brief de l'agent : « Mon Budget »

- Version du brief : 1.6.0
- Auteur : FRE (Fidag)
- Date : 2026-11-08

Historique du brief :
- 1.0.0 — FRE (Fidag) — Première version.
- 1.1.0 — FRE (Fidag) — § 2.1 fait : le dépôt existe déjà sous le nom `msdpfw872r-glitch/MonBudget` (public) ; adresse publiée `https://msdpfw872r-glitch.github.io/MonBudget/` (chemins relatifs obligatoires dans l'app). Structure `app/` en place depuis la v0.2.0.
- 1.2.0 — FRE (Fidag) — Décisions de l'utilisateur (v0.4.0) : Maman et Papa ont chacun leur carte UBS (deux comptes « carte »), la facture est commune et prélevée par LSV sur le compte UBS ; les achats par carte sont rattachés à ce prélèvement (voir § 4, « Cartes et factures »). L'agent peut mettre `main` à jour pour publier chaque étape.
- 1.3.0 — FRE (Fidag) — Décision de l'utilisateur (v0.6.0) : nom de la sauvegarde jusqu'à la milliseconde (jamais deux fois le même) ; restauration avec écran de confirmation bien visible ; sauvegarde utilisable avec un raccourci Apple (menu Partager).
- 1.4.0 — FRE (Fidag) — Formats réels reçus (v0.7.0) : la BCVs fournit un relevé **CSV** (pas camt.053, abandonné) ; Swisscard un CSV français avec colonne Débit/Crédit et Statut. Opérations « En suspens » non importées. Les titulaires des cartes Swisscard sont choisis dans l'app.
- 1.5.0 — FRE (Fidag) — camt.053 ajouté (v0.8.0) selon la spécification `docs/specs/camt053.md` (v1.0) : importable dans n'importe quel compte bancaire, contrepartie comme nom d'opération et clé des règles.
- 1.6.0 — FRE (Fidag) — **Synchronisation chiffrée de bout en bout** vers Firebase (option A : un compte, deux iPad) : voir `docs/specs/synchro.md`. Le réseau est autorisé vers Firebase seulement ; les données n'y sont jamais en clair. SDK Firebase copié dans le dépôt (pas de CDN). La règle « aucune requête réseau » du § 4 est remplacée par celle-ci.

Lis ce fichier en entier avant de commencer. Il fait foi sur tout le reste du dépôt.

---

## 1. Le projet en deux phrases

Une petite web app installée sur l'écran d'accueil de l'iPad (usage principal) et de l'iPhone d'une retraitée suisse de 70 ans, francophone, qui ne connaît ni Microsoft 365 ni Google. Elle y importe les relevés de ses banques (UBS, BCVs, Mastercard Swisscard), classe chaque opération **pour qui** (Maman, Papa, Ménage) et **quoi** (catégorie), et l'app **retient ses choix** pour classer seule les fois suivantes.

## 2. Ta mission

### 2.1 Mise en place GitHub (à faire en premier)

1. Vérifie l'accès GitHub : `gh auth status`. S'il n'est pas connecté, **arrête-toi** et demande à l'utilisateur de lancer `gh auth login` (tu ne peux pas le faire à sa place).
2. Crée le dépôt **public** `mon-budget` sur le compte de l'utilisateur, à partir de ce dossier :
   `gh repo create mon-budget --public --source . --remote origin --description "Journal des dépenses et recettes — web app iPad/iPhone"`
   - Public est un choix voulu : GitHub Pages est gratuit uniquement pour les dépôts publics. Le dépôt ne contient que du code, **jamais de données bancaires réelles** (voir § 8).
   - Si le nom est déjà pris : arrête-toi et demande.
3. Identité des commits dans ce dépôt uniquement :
   `git config user.name "FRE (Fidag)"` et comme e-mail l'adresse *noreply* GitHub du compte (`gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'`).
4. Active GitHub Pages en déploiement par GitHub Actions (workflow `.github/workflows/pages.yml` qui publie le dossier `app/`), puis :
   `gh api -X POST repos/{owner}/mon-budget/pages -f build_type=workflow` (ou `PUT` si Pages existe déjà).
5. Ajoute un workflow `.github/workflows/tests.yml` qui lance `npm test` (Node 22) à chaque push. Le déploiement Pages ne part que si les tests passent.
6. Donne à l'utilisateur l'adresse publiée (`https://<login>.github.io/mon-budget/`).

### 2.2 Développer l'app par étapes

Livre étape par étape (§ 7). À la fin de chaque étape : tests verts, version incrémentée, `CHANGELOG.md` à jour, tag git `vX.Y.Z`, push, site redéployé, et un court message à l'utilisateur sur ce qu'il peut tester sur l'iPad.

## 3. Ce qui existe déjà (v0.1.0) — à conserver

| Chemin | Contenu |
|---|---|
| `src/core/xlsx.js` | Lecteur .xlsx sans dépendance (DecompressionStream), Safari 16.4+ et Node 18+ |
| `src/core/text.js` | `parseAmount` (CHF `8'700.00`), `parseDateCH`, `merchantKey` (clé des règles), `fingerprint` (anti-doublon) |
| `src/importers/ubs.js` | Import UBS « Transactions » Excel : `detect`, `parse`, `onlyNew` |
| `src/data/seed.json` | Personnes, comptes et 39 catégories en français (rentes AVS/LPP, caisse maladie, etc.) |
| `tests/` | 6 tests `node:test` + fichiers d'exemple anonymisés |
| `docs/maquette/` | Maquette validée (voir § 5) |

Structure cible : déplace `src/` sous `app/src/` (l'app publiée = le dossier `app/`), garde `tests/` à la racine, et adapte les imports et `package.json`.

## 4. Architecture imposée

- **Web app statique**, HTML + CSS + JavaScript (modules ES), **sans framework ni étape de build**. Pas de npm à l'exécution.
- **Aucune requête réseau** une fois l'app chargée, **sauf la synchronisation chiffrée vers Firebase** (`firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com` ; voir `docs/specs/synchro.md`) : pas de CDN (SDK Firebase copié dans `app/vendor/`), pas d'analytics, pas de police Google en ligne. La police **Atkinson Hyperlegible** (licence OFL) est copiée en `.woff2` dans `app/fonts/`. Ajoute une Content-Security-Policy stricte (`default-src 'self'`).
- **PWA** : `manifest.webmanifest` (nom « Mon Budget », `display: standalone`, icônes 180/192/512), service worker qui met l'app en cache pour fonctionner hors ligne. Mise à jour : afficher « Nouvelle version disponible — Mettre à jour ».
- **Données** : IndexedDB sur l'appareil (petit wrapper maison, pas de dépendance). Appelle `navigator.storage.persist()`. Rien ne quitte l'appareil en clair : seulement la sauvegarde que la personne fait elle-même et la synchronisation **chiffrée de bout en bout** (clé jamais connue de Firebase).
- **Cible** : Safari iPadOS / iOS 16.4 et plus. iPad paysage d'abord, iPad portrait et iPhone ensuite.
- **Langue** : toute l'interface en français. Montants au format suisse `CHF 1’234.50` (apostrophe typographique). Dates « mardi 14 octobre ».

### Modèle de données (IndexedDB)

| Store | Champs principaux |
|---|---|
| `people` | id, name, color |
| `accounts` | id, name, kind (`compte`/`carte`), importFormat |
| `categories` | id, name, type (`depense`/`recette`), excludeFromTotals, archived |
| `transactions` | id (= empreinte), accountId, date, description, merchantKey, amount, currency, bankCategory, personId, categoryId, status (`a-trier`/`classee`), ruleId, importId, isCardBillPayment, note |
| `rules` | id, merchantKey, personId, categoryId, createdAt, lastUsedAt, hits |
| `imports` | id, accountId, fileName, format, date, period, counts (trouvées, nouvelles, auto-classées, à trier, doublons) |
| `settings` | lastBackupAt, schemaVersion, … |

### Règles retenues (cœur de l'app)

1. À l'import, pour chaque nouvelle opération : règle dont `merchantKey` est identique → classée automatiquement (`status: classee`).
2. Sinon, règle dont la clé est contenue dans celle de l'opération (la plus longue gagne).
3. Sinon → `a-trier`. La catégorie bancaire (`bankCategory`) n'est qu'un indice affiché, jamais appliquée seule (les catégories UBS sont peu fiables : un loyer y apparaît en « Transferts entre comptes »).
4. Dans « À trier », la case « Toujours classer *X* comme ça » (cochée par défaut) crée ou met à jour la règle.
5. Corriger une opération déjà classée par une règle propose : « Changer aussi la règle ? ».
6. Les paiements de facture de carte (`isCardBillPayment`) et les virements entre ses propres comptes vont dans une catégorie `excludeFromTotals` : les achats de la carte ne doivent pas être comptés deux fois.
7. Une règle peut être modifiée ou supprimée dans Réglages.

### Cartes et factures (v0.4.0)

- Chaque carte est un compte `carte` avec `personId` (titulaire, proposé d'avance dans « À trier ») et `billPaidFrom` (compte sur lequel la facture est prélevée). Seed : `carte-ubs-maman`, `carte-ubs-papa`, facture payée par `ubs`.
- `accounts.bankRefs` : références lues dans les fichiers (IBAN, `****1234`). Inconnues → une question par référence à l'import, puis retenues. Les vrais numéros ne sont jamais dans le dépôt.
- Le prélèvement (`isCardBillPayment`) va dans la catégorie `paiement-facture-carte` (`isCardBill`, `excludeFromTotals`).
- Les achats des cartes portent `cardBillId` = id du prélèvement. Rattachement automatique si une suite continue d'achats (par date, non rattachés, avant le prélèvement) a exactement le même total ; sinon l'écran « Factures de carte » permet de cocher, avec l'écart affiché.
- Totaux : les achats comptent (chacun pour sa personne), jamais le prélèvement.

### Sauvegarde

- Bouton « Sauvegarder maintenant » : fichier `MonBudget_AAAA-MM-JJ_HH-MM-SS-mmm.json` (heure locale jusqu'à la milliseconde : jamais deux fois le même nom) (tout : données + règles + version du schéma) partagé avec `navigator.share({ files })`, pour qu'elle choisisse « Enregistrer dans Fichiers » puis iCloud Drive. Repli : téléchargement.
- « Restaurer une sauvegarde » : `<input type="file">`, aperçu (« 1’204 opérations, 87 règles, sauvegarde du 5 novembre »), écran rouge « toutes vos données vont être supprimées et remplacées » avec case « J'ai compris » obligatoire puis dernière vérification, remplacement ; retour à l'état d'avant si la restauration échoue.
- Raccourcis Apple : une web app ne peut pas être pilotée en arrière-plan ; la sauvegarde passe par le menu Partager, où un raccourci de l'utilisateur enregistre le fichier dans le dossier de son choix (guide dans Réglages).
- Bandeau de rappel sur l'accueil si la dernière sauvegarde a plus de 30 jours ou après un import.

## 5. Interface — suivre la maquette

Les écrans sont dans `docs/maquette/` (fichiers `.dc.html` d'un outil de design : lis le HTML et les styles en ligne comme une spécification, ils ne s'ouvrent pas seuls dans un navigateur). `canvas.json` donne l'ordre et la taille des écrans.

- iPhone 390×844 : `Main`, `Importer`, `Trier`, `Journal`, `Resume`, `Reglages`.
- iPad paysage 1180×820 : `iPad-Accueil`, `iPad-Trier`, `iPad-Journal`, `iPad-Resume`. Importer et Réglages s'ouvrent en fenêtre centrée sur iPad.
- **Une seule base de code responsive** : barre latérale (≥ 900 px de large), barre d'onglets en bas (< 900 px).

Principes non négociables (personne de 70 ans) :

- Texte de 19 px minimum (15 px pour les libellés d'onglets), zones tactiles d'au moins 56 px de haut.
- Toujours un mot à côté d'une icône. Icônes SVG au trait, **pas d'emoji**.
- Une seule question à la fois pour trier. Pas de geste caché (pas de balayage obligatoire, pas d'appui long).
- Contraste 4,5:1 minimum. Ne jamais distinguer par la couleur seule.
- Messages d'erreur en mots simples avec la marche à suivre (« Ce fichier ne vient pas d'UBS. Vérifiez le compte choisi. »). Jamais de jargon (pas de « CSV », « XML », « parser » à l'écran ; dire « le fichier de la banque »).
- Confirmation avant toute suppression ; annulation possible d'un import entier.

Couleurs : fond `#F3F6F4`, surfaces `#FFFFFF`, texte `#1C2826`, texte secondaire `#4F5E5B`, traits `#D9E1DE`, accent `#1D6F61`, accent doux `#E1F0EC`, alerte fond `#FFF1E0` / texte `#8A4B00`. Personnes : Maman `#8A3466`, Papa `#2D5B99`, Ménage `#8C5A00`. Rayons 16–24 px.

## 6. Formats bancaires

| Banque | Format | État |
|---|---|---|
| UBS | Export « Transactions » Excel (.xlsx), en-têtes français : Date de transaction, Numéro de compte ou de carte, Description, Revenu ou dépense, Montant, Monnaie, Catégorie | **Fait** (v0.1.0). Le fichier peut mélanger le compte et une carte UBS (`****1234`). |
| BCVs | Relevé de compte **CSV** : en-tête (« Relevé de compte jusqu'au », « N° de compte », nom, adresse), puis `Date;Libellé;Montant;Valeur` ; « ; », Windows-1252, dates JJ.MM.AA. La facture Swisscard y est prélevée par « Débit LSV SWISSCARD ». | **Fait** (v0.7.0, `importers/bcvs.js`). |
| camt.053 (toutes banques) | XML ISO 20022, versions .04 et .08 — voir `docs/specs/camt053.md`. | **Fait** (v0.8.0, `importers/camt053.js`) sur fichiers construits selon la norme : **à confirmer sur un vrai relevé**. |
| Mastercard (Swisscard) | CSV : `Date transaction, Description, Commerçant, Numéro de carte, Monnaie, Montant, Monnaie étrangère, Montant étranger, Débit/Crédit, Statut, Catégorie de commerçant, Catégorie enregistrée` ; « , », guillemets, montants positifs + Débit/Crédit ; plusieurs cartes. | **Fait** (v0.7.0, `importers/swisscard.js`, alias EN/DE). « En suspens » non importées. |

Chaque importateur expose la même interface que `ubs.js` : `FORMAT_ID`, `FORMAT_LABEL`, `detect(rows|text)`, `parse(...)` → `{ transactions, warnings, period, accounts }`. L'écran d'import détecte le format automatiquement et vérifie qu'il correspond au compte choisi.

## 7. Étapes de livraison

| Version | Contenu | Fini quand |
|---|---|---|
| 0.2.0 | Dépôt, Pages, CI, coquille PWA (navigation iPad/iPhone, police, couleurs, écrans vides), installable | L'adresse s'ouvre sur iPad, « Sur l'écran d'accueil » fonctionne, hors ligne OK |
| 0.3.0 | IndexedDB + données de départ (`seed.json`), Réglages : comptes, personnes, catégories | Données conservées après fermeture de l'app |
| 0.4.0 | Import UBS de bout en bout + écran « À trier » + règles retenues | Réimporter le même fichier = 0 nouvelle opération ; une règle créée classe seule au 2ᵉ import |
| 0.5.0 | Journal (filtres par personne et mois) + Accueil + Résumé du mois + export du mois (CSV pour Numbers/Excel) | Totaux justes, virements exclus |
| 0.6.0 | Sauvegarde / restauration + rappel | Restauration sur un autre appareil identique à l'original |
| 0.7.0 | BCVs camt.053 | Tests sur fichier anonymisé réel |
| 0.8.0 | Swisscard CSV | Tests sur fichier anonymisé réel |
| 1.0.0 | Relecture accessibilité, page d'aide en français simple (comment exporter depuis chaque banque, comment sauvegarder), guide d'installation | L'utilisateur valide sur l'iPad de sa maman |

## 8. Règles de travail

- **Conventions de l'auteur** : chaque fichier de code commence par un en-tête avec `Version`, `Auteur : FRE (Fidag)`, `Date` et un `Historique` (une ligne par modification : version, FRE (Fidag), description). Versionnement sémantique, `CHANGELOG.md` en français, `package.json` et l'app (affichée dans Réglages) à la même version.
- Commits et messages en français, petits et clairs.
- **Jamais de vraies données bancaires dans le dépôt** (il est public). Ajoute un `.gitignore` qui exclut `*.xml`, `*.csv`, `*.xlsx`, `*.json` de sauvegarde, sauf `tests/fixtures/**` et `src/data/seed.json`. Tout fichier d'exemple doit être anonymisé (noms, IBAN, numéros de carte remplacés).
- Tests : `node --test` pour toute la logique (importateurs, règles, totaux, sauvegarde). La logique ne dépend pas du DOM pour pouvoir être testée dans Node.
- Pas de dépendance npm sans demander.

**Arrête-toi et demande à l'utilisateur** avant : toute action payante ; toute modification du compte GitHub hors de ce dépôt ; supprimer ou réécrire l'historique (`push --force`) ; si un fichier bancaire réel non anonymisé t'est fourni (ne le commite pas) ; si un format bancaire réel contredit ce brief.

## 9. Ce que l'utilisateur fournira plus tard

- Un export camt.053 BCVs anonymisé.
- Un export CSV Swisscard anonymisé.
- 2–3 vrais libellés d'opérations (pour régler `merchantKey`).
- À qui appartient la carte UBS (Maman / Papa) pour proposer le bon « pour qui ».
