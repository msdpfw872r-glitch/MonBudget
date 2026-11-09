# Historique des versions

## 0.10.1 — 2026-11-09 — FRE (Fidag)
- « Vraie app », étape 2 : **verrou** (`app/src/core/verrou.js`). Création de l'espace chiffré au premier appareil, arrivée d'un appareil suivant avec la phrase de passe ; clés gardées enveloppées sur l'appareil pour que **Face ID marche sans Internet** ; phrase de passe changée ailleurs reprise depuis le cloud ; règle de verrouillage après une minute hors de l'app. Pas encore branché sur les écrans.

## 0.10.0 — 2026-11-09 — FRE (Fidag)
- « Vraie app », étape 1 : **base chiffrée sur l'appareil** (`app/src/data/coffre.js`). Une fois l'app déverrouillée, les données sont en mémoire ; chaque modification est aussitôt chiffrée dans IndexedDB (noms illisibles, contenu AES-GCM). Reprise des anciennes données en clair, effacement complet de l'appareil. Pas encore branché sur les écrans.
- Base IndexedDB version 4 (tables « coffre » et « appareil »).

## 0.9.1 — 2026-11-09 — FRE (Fidag)
- Réglages : **Synchronisation entre appareils** placée tout en haut (sur iPhone, elle était sous la sauvegarde et il fallait faire défiler).
- Textes de la synchronisation valables pour l'iPad **et l'iPhone** (« cet appareil », « Nom de cet appareil »).

## 0.9.0 — 2026-11-09 — FRE (Fidag)
- **Synchronisation chiffrée de bout en bout entre les deux iPad** (Firebase, offre gratuite), étape 7 : finitions et mise en service.
  - Données chiffrées sur l'iPad (AES-GCM 256) avant tout envoi ; Firebase ne voit ni montants, ni libellés, ni identifiants.
  - Ouverture par **Face ID** (passkey de chaque iPad, extension PRF) ou par la **phrase de passe de secours** (PBKDF2, 600 000 itérations).
  - L'app reste utilisable hors ligne ; les changements partent au retour du réseau ; la plus récente modification gagne.
  - Restauration d'une sauvegarde : l'écran rouge prévient que les données remplaceront aussi celles du cloud et de l'autre iPad.
- Mise en service Firebase (règles, inscription désactivée, clé limitée au site) et **checklist de tests sur iPad** : `docs/synchro-mise-en-service.md`.
- Brief 1.7.0.

## 0.8.6 — 2026-11-09 — FRE (Fidag)
- Synchronisation chiffrée, étape 6 : **écrans et Face ID**.
  - Réglages › **Synchronisation entre les iPad** : connexion (e-mail + mot de passe), création du coffre avec avertissement rouge (« sans la phrase de passe ni Face ID, les données du cloud sont irrécupérables », case « J'ai compris » et dernière vérification), ouverture par phrase de passe, activation de **Face ID** sur chaque iPad (passkey + PRF), état (dernière synchro, changements en attente), Synchroniser maintenant, Verrouiller, Se déconnecter.
  - Accueil : bandeau « Synchronisation en pause » avec bouton **Déverrouiller avec Face ID**.
  - Envoi automatique quelques secondes après chaque modification, au retour du réseau et quand l'app revient au premier plan ; les écrans Accueil, Journal et Résumé se mettent à jour quand des changements arrivent de l'autre iPad.
  - La clé des données reste en mémoire seulement (jamais écrite) ; les réglages de Face ID de l'iPad ne vont jamais dans une sauvegarde fichier.

## 0.8.5 — 2026-11-09 — FRE (Fidag)
- Synchronisation chiffrée, étape 5 : **SDK Firebase 13.2.0 copié dans l'app** (`app/vendor/firebase/13.2.0/` : app, auth, Firestore « lite »), sans CDN ; empreintes et procédure dans `LISEZMOI.txt`. Mis en cache pour le hors ligne, chargé seulement si la synchronisation est utilisée.
- Adaptateur `app/js/cloud.js` : connexion e-mail + mot de passe (session gardée sur l'appareil, un seul compte accepté), lecture des changements depuis la dernière fois, écriture par lots. Messages d'erreur en mots simples.
- Sécurité : la page n'autorise le réseau que vers `firestore.googleapis.com`, `identitytoolkit.googleapis.com` et `securetoken.googleapis.com` ; aucun script externe.

## 0.8.4 — 2026-11-09 — FRE (Fidag)
- Synchronisation chiffrée, étape 4 : **moteur de synchronisation** (`app/src/core/synchro.js`), sans Firebase encore.
  - Coffre : création de la clé des données, ouverture par phrase de passe ou par passkey (Face ID), ajout d'une passkey par appareil, changement de phrase de passe.
  - Fusion « dernière écriture gagnante » par enregistrement ; suppressions transmises ; envoi par lots de 400 ; ce qui est modifié pendant l'envoi repart la fois suivante ; hors ligne, la file attend.
  - Premier iPad : toutes les données existantes partent (migration). Deuxième iPad : reçoit tout, le cloud gagne, ses propres ajouts partent.
  - Documents du cloud liés à leur nom : un document falsifié ou déplacé est refusé.
- Restaurer une sauvegarde fichier : à la prochaine synchro, ces données **remplacent** celles du cloud (y compris suppressions). L'état de synchro d'un appareil n'est jamais mis dans une sauvegarde.
- 111 tests automatiques (faux cloud en mémoire).

## 0.8.3 — 2026-11-09 — FRE (Fidag)
- Synchronisation chiffrée, étape 3 : **module de chiffrement** (`app/src/core/chiffrement.js`, Web Crypto seulement). Clé des données (AES-GCM 256, nouvelle valeur d'initialisation à chaque chiffrement), gardée en mémoire en clés non exportables ; enveloppe par phrase de passe (PBKDF2-SHA256, 600 000 itérations) et par passkey (secret PRF → HKDF-SHA256) ; noms de documents illisibles (HMAC). Pas encore branché sur l'app.
- 100 tests automatiques.

## 0.8.2 — 2026-11-09 — FRE (Fidag)
- Synchronisation chiffrée, étape 2 : **suivi des changements** sur l'appareil (base version 3). Chaque modification reçoit une date (`updatedAt`) et est notée dans une file d'envoi (`outbox`) ; une suppression laisse une trace. Rien n'est encore envoyé. Les données existantes sont gardées telles quelles.
- La file d'envoi n'est pas mise dans les sauvegardes fichiers ; une restauration rend les données restaurées « les plus récentes ».
- 93 tests automatiques.

## 0.8.1 — 2026-11-09 — FRE (Fidag)
- Synchronisation chiffrée, étape 1 : conception (`docs/specs/synchro.md`), règles Firestore (`firestore.rules`, un seul compte autorisé), configuration Firebase publique (`app/js/firebase-config.js`), brief 1.6.0. Rien ne change encore dans l'app.

## 0.8.0 — 2026-11-09 — FRE (Fidag)
- **Relevés camt.053** (format standard des banques suisses, versions .04 et .08), selon la spécification `docs/specs/camt053.md` : une opération par détail de transaction (sinon par écriture), montant signé, extourne inversée, **nom de la contrepartie** (créancier pour un paiement, débiteur pour une rentrée, bénéficiaire final d'abord), référence QR / SCOR ou communication, type d'opération en mots simples (virement, prélèvement LSV, carte, bancomat, frais).
- Un relevé camt.053 peut aller dans **n'importe quel compte bancaire** de l'app (UBS, BCVs…) : l'app reconnaît l'IBAN, ou demande une fois.
- Les règles retenues se font sur le **vrai bénéficiaire** (« Caisse Maladie Exemple SA ») et plus sur « Ordre e-Bill ».
- Contrôles affichés à l'import : « Soldes vérifiés : le relevé est complet » ou écart signalé ; paiement groupé sans détail ; somme du détail différente de l'écriture.
- Anti-doublon par référence de la banque : réimporter un relevé qui reprend des jours déjà importés (« données déjà téléchargées ») n'ajoute rien.
- Écritures non comptabilisées (en attente) : pas importées, comptées à part.
- Nom affiché des opérations : le commerçant ou la contrepartie quand la banque les donne (Swisscard, camt.053).
- Lecteur XML sans dépendance (`app/src/core/xml.js`) ; fichiers d'exemple **construits selon la norme** (à confirmer sur un vrai relevé).
- 87 tests automatiques.

## 0.7.0 — 2026-11-09 — FRE (Fidag)
- **BCVs** : import du relevé de compte (fichier CSV de l'e-banking : en-tête « Relevé de compte… », colonnes Date ; Libellé ; Montant ; Valeur, accents Windows, dates JJ.MM.AA). Le prélèvement « Débit LSV SWISSCARD … » est reconnu comme facture de carte (pas compté dans les totaux).
- **Mastercard Swisscard** : import des transactions (colonnes Date transaction, Description, Commerçant, Numéro de carte, Montant, Débit/Crédit, Statut…). Plusieurs cartes dans le même fichier (****1234). Montant d'origine en monnaie étrangère gardé en note. Le paiement de la facture reçu sur la carte n'est pas compté comme une rentrée.
- Opérations Swisscard **« En suspens »** : pas importées (le montant peut encore changer) ; leur nombre est indiqué, elles viendront au prochain import.
- Facture Mastercard **payée par le compte BCVs** : les achats des cartes Swisscard sont rattachés au prélèvement LSV automatiquement quand le total tombe juste.
- Import : quand un fichier contient deux cartes inconnues, l'app demande pour chacune ; nouveau choix **« Une autre carte : l'ajouter »**, puis « À qui est cette carte ? ».
- Règles Swisscard d'après le **commerçant** (« Migros » pour tous les magasins Migros).
- Textes qui ne disent pas qui a été payé (« Crédit », « Ordre e-Bill », « Ordre permanent », TWINT…) : « Toujours classer » **décoché d'office**, avec une explication.
- Les données d'une version précédente sont mises à jour (compte BCVs, facture Mastercard payée par la BCVs).
- Fichiers d'exemple **inventés** (même forme que les vrais exports) ; vérifié aussi sur les vrais fichiers, sans les ajouter au dépôt.
- 78 tests automatiques.

## 0.6.1 — 2026-11-09 — FRE (Fidag)
- Sauvegarde avec un raccourci : l'app affichait « La sauvegarde a été annulée » alors que le raccourci avait bien enregistré le fichier (l'iPad répond à l'app de la même façon pour un raccourci et pour une annulation). L'app demande maintenant **« Le fichier a-t-il bien été enregistré ? »** — « Oui, c'est enregistré » note la sauvegarde, « Non » ne note rien.
- Plus de petit fichier « texte » de 38 octets à côté de la sauvegarde : seul le fichier `.json` est envoyé au menu Partager (le titre était reçu par le raccourci comme un 2e fichier). Même chose pour les exports du Journal et du Résumé.
- Guide Raccourcis complété.

## 0.6.0 — 2026-11-09 — FRE (Fidag)
- **Sauvegarder maintenant** (Réglages, et bandeau de l'accueil) : fichier `MonBudget_AAAA-MM-JJ_HH-MM-SS-mmm.json` — date et heure jusqu'à la milliseconde, deux sauvegardes n'ont jamais le même nom — avec toutes les données, les règles et les versions. Ouvre le menu Partager de l'iPad (« Enregistrer dans Fichiers » ou un raccourci) ; sinon téléchargement. Annuler le partage ne compte pas comme une sauvegarde.
- **Restaurer une sauvegarde** : choix du fichier, puis écran rouge bien visible « Attention : toutes vos données vont être supprimées et remplacées », avec ce qui sera supprimé (aujourd'hui dans l'app) et ce qui sera remis (dans la sauvegarde), bouton « Sauvegarder d'abord les données d'aujourd'hui », case « J'ai compris » obligatoire, bouton « Remplacer toutes mes données », puis une dernière vérification. Si la restauration échoue en cours de route, les données d'avant sont remises.
- Fichiers refusés en mots simples (pas une sauvegarde, abîmée, incomplète, version plus récente).
- **Rappel** sur l'accueil : jamais sauvegardé, dernière sauvegarde il y a plus de 30 jours, ou import depuis la dernière sauvegarde.
- Guide pas à pas **« Sauvegarder avec l'app Raccourcis »** : dossier iCloud Drive, raccourci dans le menu Partager, rappel automatique chaque semaine.
- 72 tests automatiques.

## 0.5.2 — 2026-11-09 — FRE (Fidag)
- **Toucher un montant affiche les opérations qui le composent** : « Il reste / Il manque », « Rentrées », « Dépenses », chaque barre (« Où va l'argent », « Dépenses pour qui ? », « D'où vient l'argent »), chaque case du tableau « Mois par mois », et « Voir lesquelles » pour les opérations pas comptées. Sur l'Accueil aussi.
- La fenêtre « Détail » montre la période, le nombre d'opérations et le total (toujours égal au montant touché) ; toucher une opération permet de la modifier, et les chiffres se mettent à jour.
- Petit signe « › » après chaque montant cliquable et phrase d'aide « Touchez un montant pour voir les opérations qui le composent ».
- 65 tests automatiques.

## 0.5.1 — 2026-11-09 — FRE (Fidag)
- **Périodes** dans le Journal et le Résumé : « Semaine » (lundi → dimanche), « Mois », « Année », « Tout » et « Dates » (du… au…, avec le calendrier). Boutons « ‹ … » / « … › » pour la période précédente ou suivante (même durée pour des dates choisies).
- Résumé : « Il reste cette semaine / ce mois-ci / cette année / sur la période » ; tableau **« Mois par mois »** (rentrées, dépenses, reste) dès que la période couvre plusieurs mois.
- Journal : **loupe « Chercher une opération »** : commerce, texte de la banque, catégorie, personne, compte, date (JJ.MM.AAAA) ou montant (« 64.80 » ou « 64,80 »), sans tenir compte des accents ; plusieurs mots possibles. Le total des opérations trouvées s'affiche.
- Journal : « Exporter » envoie exactement les opérations affichées (période, personne, recherche) ; Résumé : « Exporter » la période choisie.
- 64 tests automatiques.

## 0.5.0 — 2026-11-09 — FRE (Fidag)
- **Journal** : les opérations du mois, du plus récent au plus ancien ; boutons « ‹ Septembre » / « Novembre › » pour changer de mois ; filtre « Tout le monde / Maman / Papa / Ménage » ; tableau sur iPad, liste sur iPhone. Les opérations pas encore triées sont marquées « À trier », les virements et factures de carte « pas compté dans les totaux ».
- **Modifier une opération** depuis le Journal (ou l'Accueil) : pour qui, c'est quoi ; si elle avait été classée par une règle, l'app demande « Changer aussi la règle ? ».
- **Résumé du mois** : « Il reste ce mois-ci » (ou « Il manque ce mois-ci » si les dépenses dépassent les rentrées), rentrées, dépenses ; « Où va l'argent » (6 plus grosses catégories + autres) ; « Dépenses pour qui ? » ; « D'où vient l'argent » ; même filtre par personne.
- Totaux justes : virements, épargne et factures de carte exclus (les achats faits avec les cartes comptent une fois, pour leur personne) ; les opérations pas encore triées ne sont pas comptées et sont signalées.
- **Exporter le mois** : fichier pour Numbers ou Excel (« Enregistrer dans Fichiers »), une ligne par opération et les totaux.
- **Accueil** : chiffres du mois, opérations à trier, factures à vérifier, dernières opérations, dépenses pour qui.
- 56 tests automatiques.

## 0.4.6 — 2026-11-09 — FRE (Fidag)
- À trier sur iPad : le titre et le choix de l'ordre (« Fréquents d'abord » / « Par date ») sont en haut de la colonne de gauche, au-dessus de la liste ; le formulaire de droite commence tout en haut de l'écran.
- À trier sur iPhone : en haut du formulaire, « Opération 2 sur 7 », boutons « Précédente » / « Suivante » et « Liste » ; la liste s'ouvre dans une fenêtre avec loupe (« Chercher un commerce ») et le choix de l'ordre. Toucher une opération l'ouvre.
- L'ordre des opérations choisi est retenu d'une fois à l'autre.

## 0.4.5 — 2026-11-09 — FRE (Fidag)
- À trier : « Pour qui ? » garde ses gros boutons de couleur jusqu'à 6 personnes ; au-delà, une seule étiquette ouvre la même fenêtre de choix que les catégories (loupe, « Derniers utilisés » / « De A à Z », une personne par ligne avec sa couleur).
- 48 tests automatiques.

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
