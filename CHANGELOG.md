# Historique des versions

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
