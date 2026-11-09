/**
 * chiffrement.js — Chiffrement de bout en bout pour la synchronisation (Web Crypto uniquement).
 *
 * Version : 0.8.3
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Voir docs/specs/synchro.md, § 3.
 *   - DEK : 32 octets aléatoires, AES-GCM 256, IV aléatoire de 12 octets à chaque chiffrement.
 *   - Une fois ouverte, la DEK n'existe plus que sous forme de clés NON extractibles
 *     (AES-GCM pour les données, HMAC dérivée par HKDF pour les noms de documents).
 *   - Enveloppe « phrase de passe » : PBKDF2-SHA256 (≥ 600 000 itérations, sel 16 o) → AES-GCM.
 *   - Enveloppe « passkey » : secret PRF (WebAuthn) → HKDF-SHA256 → AES-GCM.
 * Rien ici n'écrit la DEK ni ne la journalise. Fonctionne dans Safari et dans Node 22 (tests).
 *
 * Historique :
 *   0.8.3  FRE (Fidag)  Première version.
 */

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const MIN_ITERATIONS = 600000;
export const MIN_PASSPHRASE = 12;
const DOC_ID_INFO = 'MonBudget doc-id v1';
export const PRF_INFO = 'MonBudget DEK wrap v1';
const AAD_PASSPHRASE = 'MonBudget enveloppe phrase v1';
const AAD_PASSKEY = 'MonBudget enveloppe passkey v1';

/** Erreur à montrer telle quelle (mots simples). */
export class ChiffrementError extends Error {}

// ---------- Outils ----------

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function toB64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(text) {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export const toB64url = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Phrase de passe sous une forme stable (accents écrits de la même façon sur tous les appareils). */
export const normalizePassphrase = (p) => String(p ?? '').normalize('NFC').trim();

/** Message si la phrase de passe est trop faible, sinon null. */
export function passphraseProblem(p) {
  const s = normalizePassphrase(p);
  if (s.length < MIN_PASSPHRASE) return `La phrase de passe doit avoir au moins ${MIN_PASSPHRASE} caractères. Par exemple quatre mots : « vélo jardin soleil 1954 ».`;
  if (new Set(s).size < 5) return 'La phrase de passe est trop simple. Choisissez plusieurs mots différents.';
  return null;
}

// ---------- DEK ----------

/** Nouvelle clé de données (octets bruts : à envelopper puis effacer). */
export const generateDek = () => randomBytes(32);

/**
 * Ouvre la DEK : clés non extractibles. Les octets bruts sont effacés.
 * @param {Uint8Array} raw
 * @returns {Promise<{aes: CryptoKey, hmac: CryptoKey}>}
 */
export async function openDek(raw) {
  try {
    const aes = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const base = await subtle().importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    const hmac = await subtle().deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(DOC_ID_INFO) },
      base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'],
    );
    return { aes, hmac };
  } finally {
    raw.fill(0);
  }
}

// ---------- Données ----------

/** Chiffre un objet JSON. `aad` lie le texte chiffré à son emplacement (un document copié ailleurs est refusé). */
export async function encryptJson(keys, obj, aad) {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, keys.aes, enc.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJson(keys, { iv, ct }, aad) {
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(aad) }, keys.aes, fromB64(ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new ChiffrementError('Des données du cloud n’ont pas pu être lues (clé différente ou données abîmées).');
  }
}

/** Nom de document : HMAC(store/id), 40 caractères hexadécimaux. L'identifiant local n'est jamais visible. */
export async function docId(keys, store, id) {
  const sig = await subtle().sign('HMAC', keys.hmac, enc.encode(`${store}/${id}`));
  return toHex(sig).slice(0, 40);
}

// ---------- Enveloppes ----------

async function aesFrom(bytes) {
  return subtle().importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function seal(wrapKey, dekRaw, aad) {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, wrapKey, dekRaw);
  return { iv: toB64(iv), wrappedDek: toB64(ct) };
}

async function unseal(wrapKey, env, aad) {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(env.iv), additionalData: enc.encode(aad) }, wrapKey, fromB64(env.wrappedDek));
  return new Uint8Array(pt);
}

async function passphraseKey(passphrase, salt, iterations) {
  const base = await subtle().importKey('raw', enc.encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Enveloppe la DEK avec la phrase de passe. */
export async function wrapWithPassphrase(dekRaw, passphrase, { iterations = MIN_ITERATIONS, now = new Date() } = {}) {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new ChiffrementError(problem);
  if (iterations < MIN_ITERATIONS) throw new ChiffrementError('Réglage de sécurité trop faible.');
  const salt = randomBytes(16);
  const key = await passphraseKey(passphrase, salt, iterations);
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), ...(await seal(key, dekRaw, AAD_PASSPHRASE)), createdAt: now.toISOString() };
}

/** Ouvre l'enveloppe « phrase de passe » → octets bruts de la DEK (à passer à openDek). */
export async function unwrapWithPassphrase(env, passphrase) {
  // Une enveloppe modifiée pour affaiblir le calcul est refusée.
  if (env?.v !== 1 || env.kdf !== 'PBKDF2-SHA256' || !(env.iterations >= MIN_ITERATIONS)) {
    throw new ChiffrementError('La clé enregistrée dans le cloud n’est pas valable.');
  }
  const key = await passphraseKey(passphrase, fromB64(env.salt), env.iterations);
  try {
    return await unseal(key, env, AAD_PASSPHRASE);
  } catch {
    throw new ChiffrementError('Phrase de passe incorrecte. Vérifiez les majuscules et les espaces, puis réessayez.');
  }
}

async function prfKey(prfSecret, hkdfSalt, info) {
  const base = await subtle().importKey('raw', prfSecret, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Nom du document d'une passkey : pk_ + 16 caractères hex de SHA-256(credentialId). */
export async function passkeyDocName(credentialId) {
  const h = await subtle().digest('SHA-256', credentialId instanceof Uint8Array ? credentialId : fromB64(credentialId));
  return `pk_${toHex(h).slice(0, 16)}`;
}

/**
 * Enveloppe la DEK avec le secret PRF d'une passkey.
 * @param {Uint8Array} dekRaw
 * @param {Uint8Array} prfSecret  32 octets rendus par l'extension PRF
 * @param {{credentialId: Uint8Array, prfSalt: Uint8Array, label?: string}} opts
 */
export async function wrapWithPrf(dekRaw, prfSecret, { credentialId, prfSalt, label = '', now = new Date() }) {
  const hkdfSalt = randomBytes(32);
  const key = await prfKey(prfSecret, hkdfSalt, PRF_INFO);
  return {
    v: 1, credentialId: toB64url(credentialId), prfSalt: toB64(prfSalt), hkdfSalt: toB64(hkdfSalt), info: PRF_INFO,
    ...(await seal(key, dekRaw, AAD_PASSKEY)), label, createdAt: now.toISOString(),
  };
}

export async function unwrapWithPrf(env, prfSecret) {
  if (env?.v !== 1 || env.info !== PRF_INFO) throw new ChiffrementError('La clé de cet appareil n’est pas valable.');
  const key = await prfKey(prfSecret, fromB64(env.hkdfSalt), env.info);
  try {
    return await unseal(key, env, AAD_PASSKEY);
  } catch {
    throw new ChiffrementError('Face ID n’a pas pu ouvrir les données. Utilisez la phrase de passe.');
  }
}
