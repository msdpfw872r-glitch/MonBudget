/**
 * synchro-service.js — État de la synchronisation dans l'app : connexion, déverrouillage, envois automatiques.
 *
 * Version : 0.9.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * La clé des données (DEK) n'existe qu'ici, en mémoire, sous forme de clés non exportables,
 * jusqu'à « Verrouiller » ou la fermeture de l'app. Elle n'est jamais écrite ni affichée.
 * Réglage local « appareil » : passkey de cet iPad (identifiant et sel PRF, non secrets).
 * Événement « synchro-etat » sur document à chaque changement d'état ;
 * « donnees-recues » quand des changements d'un autre iPad ont été appliqués.
 *
 * Historique :
 *   0.8.6  FRE (Fidag)  Première version.
 *   0.9.1  FRE (Fidag)  Textes « appareil » au lieu de « iPad » (iPhone aussi).
 */

import { getDb } from './store.js';
import * as cloud from './cloud.js';
import * as pk from './passkey.js';
import * as S from '../src/core/synchro.js';
import { toB64, ChiffrementError } from '../src/core/chiffrement.js';

const DEVICE_ID = 'appareil';
const DELAY_MS = 3000;

const state = {
  /** 'inactif' (jamais configuré) | 'verrouille' | 'actif' */
  phase: 'inactif',
  user: null,
  busy: false,
  lastError: '',
  lastResult: null,
};
let keys = null;
let remote = null;
let timer = null;

const emit = () => document.dispatchEvent(new CustomEvent('synchro-etat', { detail: getState() }));
export const getState = () => ({ ...state, unlocked: Boolean(keys) });

export async function deviceSettings() {
  return (await (await getDb()).get('settings', DEVICE_ID)) ?? null;
}
async function saveDevice(patch) {
  const db = await getDb();
  await db.put('settings', { ...((await db.get('settings', DEVICE_ID)) ?? { id: DEVICE_ID }), ...patch });
}

/** Message d'erreur en mots simples. */
export function messageOf(e) {
  if (e instanceof ChiffrementError || e instanceof pk.PasskeyError || e instanceof cloud.CloudError) return e.message;
  return cloud.friendlyError(e);
}

/** Au démarrage : rien n'est chargé si la synchronisation n'a jamais été configurée. */
export async function init() {
  const db = await getDb();
  db.onChange = () => scheduleSync();
  const dev = await deviceSettings();
  state.phase = dev?.configured ? 'verrouille' : 'inactif';
  emit();
  window.addEventListener('online', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(0); });
}

/* ---------- Connexion ---------- */

export async function currentUser() {
  state.user = await cloud.currentUser();
  return state.user;
}

export async function signIn(email, password) {
  state.user = await cloud.signIn(email, password);
  remote = null;
  emit();
  return state.user;
}

async function getRemote() {
  const user = state.user ?? await currentUser();
  if (!user) throw new cloud.CloudError('Connectez-vous d’abord (Réglages › Synchronisation).');
  remote ??= await cloud.firestoreRemote(user.uid);
  return remote;
}

/** Le coffre (clé dans le cloud) existe-t-il déjà ? */
export async function vaultExists() {
  return S.vaultExists(await getRemote());
}

/* ---------- Coffre ---------- */

async function opened(k) {
  keys = k;
  state.phase = 'actif';
  state.lastError = '';
  await saveDevice({ configured: true });
  emit();
  scheduleSync(0);
}

/** Premier iPad : crée le coffre avec la phrase de passe. */
export async function createVault(passphrase) {
  await opened(await S.createVault(await getRemote(), passphrase));
}

export async function unlockWithPassphrase(passphrase) {
  await opened(await S.unlockWithPassphrase(await getRemote(), passphrase));
}

/** Face ID : à appeler directement dans le geste (toucher le bouton). */
export async function unlockWithFaceId() {
  const dev = await deviceSettings();
  if (!dev?.credentialId || !dev?.prfSalt) throw new pk.PasskeyError('Face ID n’est pas encore activé sur cet appareil. Utilisez la phrase de passe.');
  const secret = await pk.getPrfSecret(dev.credentialId, dev.prfSalt);
  try {
    const r = await getRemote();
    await opened(await S.unlockWithPasskey(r, dev.credentialId, secret));
  } finally {
    secret.fill(0);
  }
}

/** Active Face ID sur cet iPad (demande la phrase de passe : la clé ouverte n'est pas exportable). */
export async function enableFaceId(passphrase, label) {
  const r = await getRemote();
  // Vérifie la phrase AVANT de créer la passkey (sinon une passkey inutile resterait dans le trousseau).
  await S.unlockWithPassphrase(r, passphrase);
  const p = await pk.createPasskey(label);
  try {
    await S.addPasskey(r, passphrase, { ...p, label });
    await saveDevice({ configured: true, credentialId: toB64(p.credentialId), prfSalt: toB64(p.prfSalt), label });
  } finally {
    p.prfSecret.fill(0);
  }
  emit();
}

/** Oublie la clé (mémoire) : il faudra Face ID ou la phrase de passe pour synchroniser. */
export function lock() {
  keys = null;
  clearTimeout(timer);
  if (state.phase === 'actif') state.phase = 'verrouille';
  emit();
}

/** Déconnexion : la clé et l'état de synchro de cet iPad sont oubliés ; les données restent sur l'iPad. */
export async function signOut() {
  lock();
  await cloud.signOutCloud();
  const db = await getDb();
  await S.resetSyncState(db);
  await db.delete('settings', DEVICE_ID);
  state.user = null;
  state.phase = 'inactif';
  remote = null;
  emit();
}

/* ---------- Envois ---------- */

/** Synchronise bientôt (les modifications rapprochées partent ensemble). */
export function scheduleSync(delay = DELAY_MS) {
  if (!keys) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

export async function syncNow() {
  if (!keys) throw new ChiffrementError('La synchronisation est verrouillée.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    state.lastError = cloud.friendlyError({ code: 'unavailable' });
    emit();
    return null;
  }
  state.busy = true;
  emit();
  try {
    const db = await getDb();
    const r = await getRemote();
    const res = await S.syncNow(db, r, keys, { uid: state.user.uid });
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

/** Nombre de changements pas encore envoyés. */
export async function pendingCount() {
  return S.pendingCount(await getDb());
}

export const faceIdAvailable = () => pk.passkeyAvailable();
