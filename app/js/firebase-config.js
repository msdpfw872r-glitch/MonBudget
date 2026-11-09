/**
 * firebase-config.js — Configuration publique du projet Firebase (synchronisation chiffrée).
 *
 * Version : 0.8.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Ces valeurs ne sont PAS secrètes (elles identifient le projet) : la sécurité repose sur
 * les règles Firestore (firestore.rules, un seul compte autorisé) et sur le chiffrement de bout en bout.
 *
 * Historique :
 *   0.8.1  FRE (Fidag)  Première version.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBYQT882bULJLoFQeZaGDsylDYRhpr3U8k',
  authDomain: 'monbudgetapp-98452.firebaseapp.com',
  projectId: 'monbudgetapp-98452',
  storageBucket: 'monbudgetapp-98452.firebasestorage.app',
  messagingSenderId: '590995531671',
  appId: '1:590995531671:web:2fab69f1301adeb0db06d2',
};

/** Seul compte autorisé (option A : un compte, utilisé sur les deux iPad). */
export const ALLOWED_UID = 'BgSfJCtyQ5TL0YRxWEOJG0YmFp22';

/** Identifiant de la passkey (WebAuthn) : le domaine exact du site publié. */
export const RP_ID = 'msdpfw872r-glitch.github.io';
export const RP_NAME = 'Mon Budget';
