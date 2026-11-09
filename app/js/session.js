/**
 * session.js — Session de l'app : connexion, espace chiffré, verrouillage / déverrouillage, synchronisation.
 *
 * Version : 0.12.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Phases : 'demarrage' → 'connexion' (appareil pas configuré) → 'ouvert' ⇄ 'verrouille'.
 * La clé des données n'existe qu'ici, en mémoire, sous forme de clés non exportables, tant que l'app
 * est ouverte. Une minute hors de l'app → verrouillage (la mémoire déchiffrée est abandonnée).
 * Événements sur document : « session » (changement de phase ou d'état de synchro),
 * « donnees-recues » (changements arrivés d'un autre appareil).
 *
 * Historique :
 *   0.10.2 FRE (Fidag)  Première version (remplace synchro-service.js).
 *   0.12.0 FRE (Fidag)  Copies de sécurité en ligne (faire, lister, relire, supprimer).
 */

import { physicalDb, openWithKeys, lockDb, getDb } from './store.js';
import * as cloud from './cloud.js';
import * as pk from './passkey.js';
import * as S from '../src/core/synchro.js';
import * as V from '../src/core/verrou.js';
import * as C from '../src/core/copies.js';
import { APP_VERSION } from './version.js';
import { wipeDevice } from '../src/data/coffre.js';
import { ChiffrementError } from '../src/core/chiffrement.js';

const SYNC_DELAY_MS = 3000;

const state = {
  phase: 'demarrage',
  busy: false,
  lastError: '',
  lastResult: null,
};
let keys = null;
let remote = null;
let user = null;
let timer = null;
let hiddenAt = null;

const emit = () => document.dispatchEvent(new CustomEvent('session', { detail: getState() }));
export const getState = () => ({ ...state });

/** Message d'erreur en mots simples. */
export function messageOf(e) {
  if (e instanceof ChiffrementError || e instanceof pk.PasskeyError || e instanceof cloud.CloudError) return e.message;
  return cloud.friendlyError(e);
}

export async function device() {
  return V.readDevice(await physicalDb());
}

function setPhase(phase) {
  state.phase = phase;
  emit();
}

/* ---------- Démarrage et verrouillage automatique ---------- */

export async function start() {
  const dev = await device();
  setPhase(dev ? 'verrouille' : 'connexion');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else {
      if (state.phase === 'ouvert' && V.shouldLock(hiddenAt)) lock();
      else scheduleSync(0);
      hiddenAt = null;
    }
  });
  window.addEventListener('online', () => scheduleSync(0));
}

/** Verrouille : la clé et les données déchiffrées sont oubliées. */
export function lock() {
  keys = null;
  clearTimeout(timer);
  lockDb();
  if (state.phase === 'ouvert') setPhase('verrouille');
}

async function opened(k) {
  keys = k;
  const db = await openWithKeys(k);
  db.onChange = () => scheduleSync();
  state.lastError = '';
  setPhase('ouvert');
  scheduleSync(0);
}

/* ---------- Connexion et espace chiffré ---------- */

async function getRemote() {
  user ??= await cloud.currentUser();
  if (!user) throw new cloud.CloudError('Reconnectez-vous pour synchroniser (Réglages › Compte).');
  remote ??= await cloud.firestoreRemote(user.uid);
  return remote;
}

/**
 * Connexion (premier lancement, ou session Firebase expirée).
 * @returns {Promise<'creer'|'rejoindre'>} ce qu'il faut faire ensuite sur un appareil neuf
 */
export async function signIn(email, password) {
  user = await cloud.signIn(email, password);
  remote = null;
  const dev = await device();
  if (dev && dev.uid !== user.uid) throw new cloud.CloudError('Cet appareil appartient à un autre compte.');
  return (await S.vaultExists(await getRemote())) ? 'rejoindre' : 'creer';
}

export async function currentUser() {
  user ??= await cloud.currentUser();
  return user;
}

/** Premier appareil : crée l'espace chiffré et ouvre l'app. */
export async function createSpace(passphrase) {
  const r = await getRemote();
  await opened(await V.createSpace(await physicalDb(), r, passphrase, user));
}

/** Appareil suivant : ouvre l'espace existant et ouvre l'app (les données arrivent du cloud). */
export async function joinSpace(passphrase) {
  const r = await getRemote();
  await opened(await V.joinSpace(await physicalDb(), r, passphrase, user));
}

/* ---------- Face ID ---------- */

export const faceIdAvailable = () => pk.passkeyAvailable();

/** Active Face ID sur cet appareil (demande la phrase de passe). */
export async function enableFaceId(passphrase, label) {
  const p = await physicalDb();
  // Vérifie la phrase AVANT de créer la passkey (sinon une passkey inutile resterait dans le trousseau).
  await V.unlockWithPassphrase(p, passphrase);
  const created = await pk.createPasskey(label);
  try {
    await V.addDevicePasskey(p, passphrase, { ...created, label });
  } finally {
    created.prfSecret.fill(0);
  }
  emit();
}

export async function disableFaceId() {
  await V.removeDevicePasskey(await physicalDb());
  emit();
}

/** Déverrouille avec Face ID (à appeler dans le geste « toucher le bouton »). */
export async function unlockWithFaceId() {
  const dev = await device();
  if (!dev?.passkey) throw new pk.PasskeyError('Face ID n’est pas activé sur cet appareil. Utilisez la phrase de secours.');
  const secret = await pk.getPrfSecret(dev.passkey.credentialId, dev.passkey.prfSalt);
  try {
    await opened(await V.unlockWithPrf(await physicalDb(), secret));
  } finally {
    secret.fill(0);
  }
}

/** Déverrouille avec la phrase de passe (sans Internet si possible). */
export async function unlockWithPassphrase(passphrase) {
  let r = null;
  try { if (navigator.onLine !== false) r = await getRemote(); } catch { /* hors ligne ou déconnecté : copie locale */ }
  await opened(await V.unlockWithPassphrase(await physicalDb(), passphrase, r));
}

/* ---------- Déconnexion ---------- */

/** Nombre de changements pas encore envoyés. */
export async function pendingCount() {
  if (state.phase !== 'ouvert') return 0;
  return S.pendingCount(await getDb());
}

/** Déconnexion : tout ce qui est sur l'appareil est effacé (les données restent dans le cloud). */
export async function signOut() {
  lock();
  clearTimeout(timer);
  try { await cloud.signOutCloud(); } catch { /* hors ligne : la session sera oubliée avec l'appareil */ }
  await wipeDevice(await physicalDb());
  keys = null; user = null; remote = null;
  setPhase('connexion');
}

/* ---------- Copies de sécurité en ligne ---------- */

function needKeys() {
  if (!keys) throw new ChiffrementError('L’app est verrouillée.');
  return keys;
}

/** Fait une copie en ligne (horodatée, 10 au plus) avec un commentaire facultatif. */
export async function makeCloudCopy(comment = '') {
  const k = needKeys();
  const r = await getRemote();
  const dev = await device();
  return C.createCloudCopy(await getDb(), r, k, { uid: user.uid, comment, device: dev?.passkey?.label ?? '', appVersion: APP_VERSION });
}

export async function cloudCopies() {
  const k = needKeys();
  const r = await getRemote();
  return C.listCloudCopies(r, k, { uid: user.uid });
}

/** Relit une copie en ligne : renvoie la sauvegarde, à remettre par l'écran rouge de restauration. */
export async function readCloudCopy(copy) {
  const k = needKeys();
  const r = await getRemote();
  return C.readCloudCopy(r, k, { uid: user.uid, id: copy.id, parts: copy.parts });
}

export async function deleteCloudCopy(copy) {
  await C.deleteCloudCopy(await getRemote(), copy);
}

/* ---------- Synchronisation ---------- */

export function scheduleSync(delay = SYNC_DELAY_MS) {
  if (!keys) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

export async function syncNow() {
  if (!keys) throw new ChiffrementError('L’app est verrouillée.');
  if (navigator.onLine === false) {
    state.lastError = cloud.friendlyError({ code: 'unavailable' });
    emit();
    return null;
  }
  const k = keys;
  state.busy = true;
  emit();
  try {
    const db = await getDb();
    const r = await getRemote();
    const res = await S.syncNow(db, r, k, { uid: user.uid });
    state.lastResult = { ...res, at: new Date().toISOString() };
    state.lastError = '';
    if (res.applied) document.dispatchEvent(new CustomEvent('donnees-recues', { detail: res }));
    return res;
  } catch (e) {
    state.lastError = messageOf(e);
    throw e;
  } finally {
    state.busy = false;
    emit();
  }
}
