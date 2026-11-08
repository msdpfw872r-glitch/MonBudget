# Mon Budget

Petite web app (iPad / iPhone) pour tenir le journal des dépenses et recettes à partir des relevés bancaires.

- Version : 0.4.1
- Auteur : FRE (Fidag)

## Contenu actuel

| Fichier | Rôle |
|---|---|
| `app/` | L'app publiée (page unique, styles, service worker, manifeste, police, icônes) |
| `app/js/main.js` | Navigation et écrans |
| `app/js/ecran-reglages.js` | Écrans Réglages (personnes, comptes, catégories) |
| `app/src/data/db.js` | Stockage sur l'appareil (IndexedDB ; version en mémoire pour les tests) |
| `app/src/core/reglages.js` | Données de départ et règles de modification des réglages |
| `app/src/core/csv.js` | Lecture des fichiers CSV (encodage, séparateur) |
| `app/src/core/import.js` | Import de bout en bout : lecture, comptes et cartes, doublons, annulation |
| `app/src/core/regles.js` | Règles retenues (classement automatique) |
| `app/src/core/cartes.js` | Factures de carte : rattacher les achats au prélèvement LSV |
| `app/js/ecran-importer.js`, `ecran-trier.js`, `ecran-factures.js` | Écrans Importer, À trier, Factures de carte |
| `app/src/core/xlsx.js` | Lecture des fichiers Excel (.xlsx) sans dépendance, dans Safari et Node |
| `app/src/core/text.js` | Montants suisses, dates, clé commerçant (règles), empreinte anti-doublon |
| `app/src/core/format.js` | Affichage : `CHF 1’234.50`, « mardi 14 octobre » |
| `app/src/importers/ubs.js` | Import de l'export « Transactions » UBS (Excel) |
| `app/src/data/seed.json` | Personnes, comptes et catégories de départ |
| `.github/workflows/` | Tests à chaque push, publication GitHub Pages depuis `main` |
| `tests/` | Tests automatiques et fichiers d'exemple anonymisés |

## Essayer l'app sur l'ordinateur

```
npm start
```
puis ouvrir http://localhost:8080 (Python 3 requis).

## Lancer les tests

```
npm test
```
(Node 18 ou plus récent ; aucune installation de paquet nécessaire.)

## Import UBS — ce qui est géré

- Export « Transactions » en Excel (.xlsx) **ou en CSV** (séparateur et encodage devinés).

- En-têtes en français, recherchés dans les 25 premières lignes (lignes de titre tolérées).
- Montants `8'700.00`, `-2’550.00`, `1 234,50` ou vraies cellules numériques.
- Dates `31.10.2026` ou vraies dates Excel.
- Compte (IBAN) et cartes UBS (`****1234`) dans le même fichier.
- Paiement de la facture de carte repéré (`isCardBillPayment`) pour ne pas compter deux fois les achats de la carte.
- Empreinte par opération : réimporter un fichier ou des périodes qui se chevauchent ne crée pas de doublon ; deux achats identiques le même jour restent distincts.

## À venir

- Journal, Résumé du mois, export (0.5.0)
- Sauvegarde / restauration (0.6.0)
- BCVs (camt.053), Swisscard Mastercard (CSV)
