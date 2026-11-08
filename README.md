# Mon Budget

Petite web app (iPad / iPhone) pour tenir le journal des dépenses et recettes à partir des relevés bancaires.

- Version : 0.1.1
- Auteur : FRE (Fidag)

## Contenu actuel

| Fichier | Rôle |
|---|---|
| `src/core/xlsx.js` | Lecture des fichiers Excel (.xlsx) sans dépendance, dans Safari et Node |
| `src/core/text.js` | Montants suisses, dates, clé commerçant (règles), empreinte anti-doublon |
| `src/importers/ubs.js` | Import de l'export « Transactions » UBS (Excel) |
| `tests/` | Tests automatiques et fichiers d'exemple anonymisés |

## Lancer les tests

```
npm test
```
(Node 18 ou plus récent ; aucune installation de paquet nécessaire.)

## Import UBS — ce qui est géré

- En-têtes en français, recherchés dans les 25 premières lignes (lignes de titre tolérées).
- Montants `8'700.00`, `-2’550.00`, `1 234,50` ou vraies cellules numériques.
- Dates `31.10.2026` ou vraies dates Excel.
- Compte (IBAN) et cartes UBS (`****1234`) dans le même fichier.
- Paiement de la facture de carte repéré (`isCardBillPayment`) pour ne pas compter deux fois les achats de la carte.
- Empreinte par opération : réimporter un fichier ou des périodes qui se chevauchent ne crée pas de doublon ; deux achats identiques le même jour restent distincts.

## À venir

- BCVs (camt.053), Swisscard Mastercard (CSV)
- Règles retenues, catégories, interface (voir la maquette)
