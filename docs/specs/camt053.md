# Spécification : lecture des relevés camt.053 (Swiss Payment Standards / SIX)

- Version : 1.0
- Auteur : FRE (Fidag)
- Date : 2026-11-09
- Objet : instructions pour un agent chargé d'extraire les mouvements et les noms des contreparties (créanciers/débiteurs) d'un fichier camt.053 émis par une banque suisse.
- Mise en œuvre dans l'app : `app/src/importers/camt053.js` (v0.8.0), lecteur XML `app/src/core/xml.js`, tests `tests/camt053.test.mjs`.

> Dans l'app, la « sortie » n'est pas un fichier CSV (§ 5) mais les opérations importées : les colonnes du § 5 deviennent des champs de chaque opération (`counterparty`, `reference`, `communication`, `operationCode`, `bankRef`, `endToEndId`, `alert`…). Les contrôles du § 6 sont affichés en mots simples dans l'écran d'import.

---

## 1. Contexte

- Format : XML ISO 20022 `camt.053` (Bank-to-Customer Statement), relevé de compte de fin de journée.
- Les banques suisses suivent les Implementation Guidelines SIX (Swiss Payment Standards).
- Versions rencontrées : `camt.053.001.04` (ancienne) et `camt.053.001.08` (actuelle). **Le parseur doit gérer les deux.**
- Namespace : `urn:iso:std:iso:20022:tech:xsd:camt.053.001.0X`. **Ignorer le namespace** (recherche par nom local de balise), car il change selon la version.
- Un fichier peut contenir plusieurs comptes (`Stmt`) et des centaines de mouvements (`Ntry`).

## 2. Arborescence

```
Document
└── BkToCstmrStmt
    ├── GrpHdr                       En-tête du message
    │   ├── MsgId                    Identifiant du fichier
    │   └── CreDtTm                  Date/heure de création
    └── Stmt  [1..n]                 Un relevé par compte
        ├── Id                       Identifiant du relevé
        ├── ElctrncSeqNb             Numéro de séquence
        ├── FrToDt/FrDtTm, ToDtTm    Période couverte
        ├── Acct
        │   ├── Id/IBAN              IBAN du compte
        │   ├── Ccy                  Devise du compte
        │   └── Ownr/Nm              Titulaire
        ├── Bal  [n]                 Soldes
        │   ├── Tp/CdOrPrtry/Cd      OPBD = ouverture, CLBD = clôture,
        │   │                        CLAV = disponible, PRCD = clôture précédente
        │   ├── Amt (@Ccy)
        │   ├── CdtDbtInd            CRDT / DBIT (signe du solde)
        │   └── Dt/Dt
        ├── TxsSummry                Totaux (nb et somme crédits/débits)
        └── Ntry  [0..n]             Une écriture = une ligne du relevé
            ├── NtryRef
            ├── Amt (@Ccy)           Toujours POSITIF
            ├── CdtDbtInd            CRDT = entrée, DBIT = sortie
            ├── RvslInd              true = extourne (inverser le sens)
            ├── Sts                  BOOK (v04 : texte ; v08 : Sts/Cd)
            ├── BookgDt/Dt           Date de comptabilisation
            ├── ValDt/Dt             Date de valeur
            ├── AcctSvcrRef          Référence banque
            ├── BkTxCd               Code du type d'opération
            │   ├── Domn/Cd                  ex. PMNT
            │   ├── Domn/Fmly/Cd             ex. ICDT, RCDT, RDDT, CCRD
            │   ├── Domn/Fmly/SubFmlyCd      ex. DMCT, ESCT, AUTT, POSD
            │   └── Prtry/Cd                 Code propriétaire de la banque
            ├── AddtlNtryInf         Libellé texte de l'écriture
            └── NtryDtls  [0..n]
                ├── Btch/NbOfTxs     Nombre de transactions si ordre groupé
                └── TxDtls  [0..n]   Détail par transaction
                    ├── Refs
                    │   ├── MsgId, PmtInfId, InstrId
                    │   ├── EndToEndId
                    │   ├── AcctSvcrRef
                    │   └── UETR
                    ├── Amt (@Ccy), CdtDbtInd   (absents si identiques à Ntry)
                    ├── AmtDtls/InstdAmt, TxAmt (devises, conversion)
                    ├── Chrgs                   Frais
                    ├── RltdPties               *** CONTREPARTIES ***
                    │   ├── Dbtr                Débiteur (celui qui paie)
                    │   ├── DbtrAcct/Id/IBAN
                    │   ├── UltmtDbtr
                    │   ├── Cdtr                Créancier (celui qui reçoit)
                    │   ├── CdtrAcct/Id/IBAN
                    │   └── UltmtCdtr
                    ├── RltdAgts
                    │   ├── DbtrAgt/FinInstnId/BICFI
                    │   └── CdtrAgt/FinInstnId/BICFI
                    ├── RmtInf                  Communication
                    │   ├── Ustrd               Texte libre
                    │   └── Strd/CdtrRefInf
                    │       ├── Tp/CdOrPrtry/Prtry = QRR  (référence QR)
                    │       ├── Tp/CdOrPrtry/Cd    = SCOR (référence ISO 11649)
                    │       └── Ref
                    └── AddtlTxInf              Infos complémentaires texte
```

## 3. Différence importante v04 / v08 (parties)

| Élément | camt.053.001.04 | camt.053.001.08 |
|---|---|---|
| Nom du créancier | `RltdPties/Cdtr/Nm` | `RltdPties/Cdtr/Pty/Nm` |
| Nom du débiteur | `RltdPties/Dbtr/Nm` | `RltdPties/Dbtr/Pty/Nm` |
| Adresse | `Cdtr/PstlAdr/...` | `Cdtr/Pty/PstlAdr/...` |
| Statut écriture | `Sts` (texte) | `Sts/Cd` |
| BIC | `BIC` | `BICFI` |

Règle : chercher `Nm` sous `Cdtr` **à n'importe quelle profondeur** (`Cdtr//Nm`) pour couvrir les deux versions. Idem pour `Dbtr`.

## 4. Règles d'extraction

### 4.1 Une ligne de sortie par transaction
- Si `Ntry` contient un ou plusieurs `TxDtls` → **une ligne par `TxDtls`**.
- Si `Ntry` n'a aucun `TxDtls` → une ligne pour le `Ntry`.
- Montant d'une transaction : `TxDtls/Amt` si présent, sinon `Ntry/Amt`.
- Sens : `TxDtls/CdtDbtInd` si présent, sinon `Ntry/CdtDbtInd`.

### 4.2 Montant signé
- `DBIT` → montant négatif ; `CRDT` → montant positif.
- Si `RvslInd = true` → inverser le signe obtenu.

### 4.3 Contrepartie (le point clé)
- Mouvement **DBIT** (je paie) → contrepartie = **créancier** :
  1. `UltmtCdtr//Nm` s'il existe (bénéficiaire final)
  2. sinon `Cdtr//Nm`
  3. IBAN : `CdtrAcct/Id/IBAN`
- Mouvement **CRDT** (je reçois) → contrepartie = **débiteur** :
  1. `UltmtDbtr//Nm`
  2. sinon `Dbtr//Nm`
  3. IBAN : `DbtrAcct/Id/IBAN`
- Si aucun nom trouvé : extraire du texte de `AddtlTxInf`, puis de `AddtlNtryInf`, et marquer `source_nom = texte`.
- Cas sans contrepartie (frais bancaires, intérêts, retraits) : contrepartie = libellé de `AddtlNtryInf`, `source_nom = banque`.

> Mise en œuvre : pour une extourne, la contrepartie suit le sens **d'origine** de l'écriture (le créancier d'un paiement extourné), seul le signe du montant est inversé.

### 4.4 Paiements groupés
- Si `Btch/NbOfTxs > 1` **et** aucun `TxDtls` → paiement groupé sans détail.
- Produire une seule ligne avec `alerte = GROUPE_SANS_DETAIL`.
- Le détail par créancier se trouve alors dans un fichier **camt.054** (avis de débit), à demander à la banque ou à activer dans l'e-banking.

### 4.5 Référence de paiement
- `Strd/CdtrRefInf/Ref` (QRR ou SCOR) en priorité.
- Sinon `Ustrd` (texte libre, peut apparaître plusieurs fois : concaténer).

### 4.6 Type d'opération (indicatif)
| Code (Domn/Fmly/SubFmly) | Signification |
|---|---|
| PMNT/ICDT/... | Virement émis |
| PMNT/RCDT/... | Virement reçu |
| PMNT/IDDT/... ou RDDT/... | Prélèvement (LSV / Debit Direct) |
| PMNT/CCRD/POSD | Paiement par carte |
| PMNT/CCRD/CWDL | Retrait au bancomat |
| ACMT/... ou .../CHRG | Frais / opérations de compte |

Les banques utilisent aussi des codes `Prtry` propres : les conserver tels quels.

## 5. Format de sortie (CSV, séparateur `;`, UTF-8)

| Colonne | Source |
|---|---|
| iban_compte | Stmt/Acct/Id/IBAN |
| date_compta | Ntry/BookgDt/Dt |
| date_valeur | Ntry/ValDt/Dt |
| montant | signé (règle 4.2) |
| devise | @Ccy |
| sens | CRDT / DBIT |
| contrepartie_nom | règle 4.3 |
| contrepartie_iban | règle 4.3 |
| contrepartie_adresse | PstlAdr (ville + pays au minimum) |
| source_nom | xml / texte / banque |
| reference | règle 4.5 |
| communication | Ustrd |
| code_operation | BkTxCd (concaténé Domn/Fmly/SubFmly) |
| libelle_banque | AddtlNtryInf |
| ref_banque | AcctSvcrRef |
| end_to_end_id | Refs/EndToEndId |
| alerte | GROUPE_SANS_DETAIL, EXTOURNE, NOM_MANQUANT, vide sinon |

## 6. Contrôles obligatoires

1. **Rapprochement des soldes** par `Stmt` : `OPBD + somme(montants signés des Ntry) = CLBD`. Signaler tout écart.
2. Seules les écritures `Sts = BOOK` comptent dans le rapprochement (ignorer PDNG/INFO).
3. Somme des `TxDtls` d'un `Ntry` = montant du `Ntry` (sinon alerte).
4. Pas de doublon : clé unique `AcctSvcrRef` + `EndToEndId`, utile si plusieurs fichiers se chevauchent.
5. Rapport final : nombre de lignes, nombre de contreparties distinctes, nombre d'alertes par type.

## 7. Robustesse

- Toutes les balises sauf `Amt`, `CdtDbtInd` et `BookgDt` peuvent être absentes : ne jamais planter sur un champ manquant.
- Normaliser les noms (espaces, majuscules) pour regrouper un même créancier.
- Encodage : UTF-8 ; conserver les accents.
- Particularités de banque : si une balise attendue est vide, inspecter un échantillon du fichier et adapter, sans modifier les règles 4.1 à 4.3.

## 8. Référence

Swiss Payment Standards, Implementation Guidelines « Cash Management » (camt.052 / camt.053 / camt.054), SIX Interbank Clearing : à consulter pour la version en vigueur.

---
Historique des versions
- 1.0 (2026-11-09, FRE (Fidag)) : version initiale.
