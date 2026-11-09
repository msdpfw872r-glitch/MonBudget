/**
 * verrou.js — Verrou de l'app : espace chiffré, clés gardées (enveloppées) sur l'appareil,
 * déverrouillage par Face ID ou phrase de passe, même sans Internet ; verrouillage automatique.
 *
 * Version : 0.10.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Table « appareil », enregistrement « cles » (lisible AVANT déverrouillage, rien de secret en clair) :
 *   { id: 'cles', uid, email, passphraseEnv, passkey: { credentialId, prfSalt, label, env } | null, createdAt }
 *   - passphraseEnv : copie de l'enveloppe « phrase de passe » du cloud (PBKDF2 600 000) ;
 *   - passkey.env   : la clé des données enveloppée par le secret PRF de la passkey de CET appareil
 *                     (gardée seulement sur l'appareil : Face ID marche hors ligne).
 * Ne dépend pas du navigateur (testable dans Node).
 *
 * Historique :
 *   0.10.1 FRE (Fidag)  Première version.
 */

import * as K from './chiffrement.js';
import * as S from './synchro.js';

export const DEVICE_ID = 'cles';
/** Verrouillage automatique après une minute hors de l'app. */
export const AUTO_LOCK_MS = 60 * 1000;

/** Faut-il verrouiller au retour dans l'app ? */
export const shouldLock = (hiddenAt, now = Date.now(), delay = AUTO_LOCK_MS) => hiddenAt != null && now - hiddenAt >= delay;

/** Clés de l'appareil, ou null si l'appareil n'est pas encore configuré. */
export async function readDevice(phys) {
  return (await phys.get('appareil', DEVICE_ID)) ?? null;
}

async function saveDevice(phys, patch) {
  const cur = (await readDevice(phys)) ?? { id: DEVICE_ID, createdAt: new Date().toISOString(), passkey: null };
  const next = { ...cur, ...patch, id: DEVICE_ID };
  await phys.put('appareil', next);
  return next;
}

/**
 * Premier appareil : crée l'espace chiffré (clé des données enveloppée par la phrase de passe, dans le cloud
 * et sur l'appareil).
 * @returns {Promise<{aes: CryptoKey, hmac: CryptoKey}>}
 */
export async function createSpace(phys, remote, passphrase, user) {
  const keys = await S.createVault(remote, passphrase);
  await saveDevice(phys, { uid: user.uid, email: user.email ?? '', passphraseEnv: await remote.getKey('passphrase'), passkey: null });
  return keys;
}

/** Appareil suivant : ouvre l'espace existant avec la phrase de passe et garde l'enveloppe sur l'appareil. */
export async function joinSpace(phys, remote, passphrase, user) {
  const env = await remote.getKey('passphrase');
  if (!env) throw new K.ChiffrementError('Aucun espace chiffré dans le cloud pour ce compte.');
  const keys = await K.openDek(await K.unwrapWithPassphrase(env, passphrase));
  await saveDevice(phys, { uid: user.uid, email: user.email ?? '', passphraseEnv: env, passkey: null });
  return keys;
}

/**
 * Face ID sur cet appareil : la clé des données est enveloppée par le secret PRF de la passkey.
 * Demande la phrase de passe (la clé ouverte n'est pas exportable). Marche hors ligne.
 * @param {{credentialId: Uint8Array, prfSalt: Uint8Array, prfSecret: Uint8Array, label?: string}} pk
 */
export async function addDevicePasskey(phys, passphrase, pk) {
  const dev = await readDevice(phys);
  if (!dev?.passphraseEnv) throw new K.ChiffrementError('Cet appareil n’est pas encore configuré.');
  const raw = await K.unwrapWithPassphrase(dev.passphraseEnv, passphrase);
  try {
    const env = await K.wrapWithPrf(raw, pk.prfSecret, { credentialId: pk.credentialId, prfSalt: pk.prfSalt, label: pk.label ?? '' });
    await saveDevice(phys, { passkey: { credentialId: env.credentialId, prfSalt: env.prfSalt, label: pk.label ?? '', env } });
  } finally {
    raw.fill(0);
  }
}

/** Retire Face ID de cet appareil (la phrase de passe reste). */
export async function removeDevicePasskey(phys) {
  await saveDevice(phys, { passkey: null });
}

/** Déverrouille avec le secret PRF (Face ID). */
export async function unlockWithPrf(phys, prfSecret) {
  const dev = await readDevice(phys);
  if (!dev?.passkey) throw new K.ChiffrementError('Face ID n’est pas activé sur cet appareil. Utilisez la phrase de passe.');
  return K.openDek(await K.unwrapWithPrf(dev.passkey.env, prfSecret));
}

/**
 * Déverrouille avec la phrase de passe : d'abord l'enveloppe de l'appareil (hors ligne) ; si elle refuse
 * et que le cloud est joignable, celle du cloud (phrase changée sur un autre appareil), qui remplace alors
 * la copie locale.
 */
export async function unlockWithPassphrase(phys, passphrase, remote = null) {
  const dev = await readDevice(phys);
  if (!dev?.passphraseEnv) throw new K.ChiffrementError('Cet appareil n’est pas encore configuré.');
  try {
    return await K.openDek(await K.unwrapWithPassphrase(dev.passphraseEnv, passphrase));
  } catch (e) {
    if (!remote) throw e;
    let env;
    try { env = await remote.getKey('passphrase'); } catch { throw e; }
    if (!env || JSON.stringify(env) === JSON.stringify(dev.passphraseEnv)) throw e;
    const keys = await K.openDek(await K.unwrapWithPassphrase(env, passphrase));
    await saveDevice(phys, { passphraseEnv: env });
    return keys;
  }
}
