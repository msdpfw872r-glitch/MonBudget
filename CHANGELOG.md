# Historique des versions

## 0.4.4 — 2026-11-09 — FRE (Fidag)
- À trier : « C'est quoi ? » n'est plus qu'**une étiquette** (« Choisir une catégorie… » ou la catégorie choisie). En la touchant, une fenêtre s'ouvre avec la **loupe**, le choix **« Derniers utilisés » / « De A à Z »** (retenu d'une fois à l'autre) et toutes les catégories, une par ligne : celles du bon genre (dépenses ou rentrées) d'abord.
- À trier sur iPad : les blocs du formulaire ne se tassent plus quand il est long (boutons coupés, texte qui dépassait de la case « Toujours classer ») : le formulaire défile.
- Texte au singulier : « L'autre opération de ce commerce en attente sera classée aussi. »
- Chaque opération classée garde la date de son classement (pour proposer les catégories récentes).
- 47 tests automatiques.

## 0.4.3 — 2026-11-08 — FRE (Fidag)
- À trier sur iPad : l'écran tient dans la hauteur de l'écran ; la liste des opérations et le formulaire défilent **chacun de leur côté**. La liste garde sa position et l'opération choisie reste visible.
- Barre latérale étroite sur les iPad jusqu'à 1280 px de large (icône avec le mot en dessous, comme les onglets) : plus de place pour la liste et le formulaire. La liste est de nouveau affichée dès 900 px.
- Lignes de la liste plus compactes : nom sur une ligne (coupé avec « … » s'il est long), date et nombre de fois en dessous.

## 0.4.2 — 2026-11-08 — FRE (Fidag)
- À trier : loupe « Chercher une catégorie » (sans tenir compte des accents ; plusieurs mots possibles, par ex. « caisse mal »).
- À trier : ordre « Commerces fréquents d'abord » (par défaut) ou « Par date ». La case « Toujours classer » indique combien d'autres opérations du même commerce seront classées en même temps.
- À trier (iPad) : les lignes de la liste ne se chevauchent plus ; montants sur une seule ligne ; liste limitée aux 50 suivantes pour rester fluide avec plus de 1000 opérations. La liste n'apparaît que si l'écran est assez large (1150 px et plus) ; sinon le détail prend toute la largeur avec « 1 sur 739 ».
- 46 tests automatiques.

## 0.4.1 — 2026-11-08 — FRE (Fidag)
- UBS : l'export « Transactions » est accepté en **CSV** comme en Excel. Importer le même relevé dans les deux formats ne crée pas de doublon.
- Lecteur CSV sans dépendance (`app/src/core/csv.js`) : séparateur « ; », « , » ou tabulation deviné, guillemets, encodages UTF-8, UTF-16 et Windows-1252 (accents d'Excel).
- Variantes UBS prévues, à confirmer sur un vrai fichier : en-têtes anglais / allemands, colonnes « Débit » / « Crédit », « Description1…3 », IBAN au-dessus du tableau, numéro de carte complet ramené à ****1234, règlement reçu sur une carte (ni rentrée ni dépense).
- 44 tests automatiques.

## 0.4.0 — 2026-11-08 — FRE (Fidag)
- Import UBS de bout en bout : choisir le fichier, l'app reconnaît la banque, demande une seule fois à qui appartient chaque carte (****1234), montre le résumé (trouvées, classées toutes seules, à trier, déjà importées), puis importe.
- Anti-doublon : réimporter le même fichier ou des périodes qui se chevauchent n'ajoute rien.
- Annulation d'un import entier (avec confirmation).
- Écran « À trier » : une opération à la fois, « Pour qui ? » puis « C'est quoi ? », case « Toujours classer X comme ça » ; liste + détail sur iPad. Pour un achat par carte, la titulaire est proposée d'avance.
- Règles retenues : classement automatique au prochain import (clé identique, sinon la plus longue contenue) ; les autres opérations en attente du même commerce sont classées aussitôt. Règles modifiables et supprimables dans Réglages.
- Cartes UBS de Maman et de Papa (deux comptes « carte ») avec facture commune prélevée par LSV sur le compte UBS : le prélèvement est reconnu et n'est pas compté dans les totaux ; les achats des deux cartes y sont rattachés automatiquement quand le total tombe juste, sinon à cocher dans « Factures de carte » (l'écart est affiché).
- Mes comptes : à qui est la carte, compte sur lequel la facture est prélevée, numéros reconnus dans les fichiers.
- Les données d'une version précédente reçoivent les nouvelles cartes et la catégorie « Paiement de la facture de carte » sans rien perdre.
- 36 tests automatiques.

## 0.3.0 — 2026-11-08 — FRE (Fidag)
- Données enregistrées sur l'appareil (IndexedDB, `app/src/data/db.js`), conservées après fermeture de l'app ; Safari est prié de ne pas les effacer (`navigator.storage.persist()`).
- Données de départ (`seed.json`) installées au premier lancement seulement : les modifications ne sont jamais écrasées.
- Réglages : « Pour qui » (nom, couleur), « Mes comptes » (nom, compte ou carte, banque), « Mes catégories » (nom, dépense ou rentrée, « ne pas compter dans les totaux », mettre de côté).
- Suppression toujours confirmée, et refusée en mots simples si l'élément est encore utilisé par des opérations ou des règles.
- Couleurs proposées pour les personnes toutes lisibles (contraste ≥ 4,5:1, vérifié par un test).
- 21 tests automatiques.

## 0.2.0 — 2026-11-08 — FRE (Fidag)
- Coquille de l'app installable (PWA) dans `app/` : navigation iPad (barre latérale, ≥ 900 px) et iPhone (onglets en bas), écrans Accueil, À trier, Journal, Résumé (vides), Importer et Réglages en fenêtre centrée sur iPad.
- Police Atkinson Hyperlegible copiée dans l'app (licence OFL), couleurs de la maquette, aucune requête vers Internet (Content-Security-Policy `default-src 'self'`).
- Fonctionne hors ligne (service worker) ; bandeau « Nouvelle version disponible — Mettre à jour ».
- Icônes 180/192/512, manifeste « Mon Budget ».
- Affichage suisse : `CHF 1’234.50`, « mardi 14 octobre » (`app/src/core/format.js`).
- Code déplacé de `src/` vers `app/src/`.
- GitHub Actions : tests (Node 22) à chaque push ; publication sur GitHub Pages depuis `main`, seulement si les tests passent.
- 12 tests automatiques.

## 0.1.1 — 2026-11-08 — FRE (Fidag)
- Brief de l'agent (`CLAUDE.md`), maquette dans `docs/maquette/`, données de départ `src/data/seed.json`, `.gitignore` anti-données bancaires.

## 0.1.0 — 2026-11-08 — FRE (Fidag)
- Lecteur Excel (.xlsx) sans dépendance.
- Outils communs : montants et dates au format suisse, clé commerçant, empreinte anti-doublon.
- Import UBS « Transactions » (Excel), testé sur un export anonymisé d'octobre 2026.
- 6 tests automatiques.
