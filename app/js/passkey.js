/**
 * passkey.js — Face ID / Touch ID par passkey (WebAuthn) avec l'extension PRF.
 *
 * Version : 0.8.6
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * La passkey ne sert pas à se connecter : son secret PRF (32 octets, différent pour chaque
 * passkey et chaque « sel ») ouvre l'enveloppe de la clé des données (voir synchro.js).
 * Passkey de plateforme (trousseau iCloud), vérification de l'utilisateur obligatoire,
 * rpId = domaine exact du site publié.
 *
 * Historique :
 *   0.8.6  FRE (Fidag)  Première version.
 */

import { RP_ID, RP_NAME } from './firebase-config.js';
import { randomBytes, fromB64 } from '../src/core/chiffrement.js';

/** Erreur à montrer telle quelle. */
export class PasskeyError extends Error {}

const bytes = (buf) => (buf ? new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer) : null);

/** L'appareil peut-il avoir une passkey de plateforme (Face ID / Touch ID) ? */
export async function passkeyAvailable() {
  try {
    if (!window.PublicKeyCredential || !window.isSecureContext) return false;
    if (location.hostname !== RP_ID && location.hostname !== 'localhost') return false;
    const caps = await PublicKeyCredential.getClientCapabilities?.();
    if (caps && caps['extension:prf'] === false) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function webauthnError(e) {
  if (e instanceof PasskeyError) return e;
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return new PasskeyError('Face ID a été annulé. Réessayez, ou utilisez la phrase de passe.');
  if (e?.name === 'InvalidStateError') return new PasskeyError('Cet iPad a déjà une clé Face ID pour Mon Budget.');
  if (e?.name === 'SecurityError') return new PasskeyError('Face ID ne fonctionne que depuis l’adresse officielle de l’app.');
  return new PasskeyError('Face ID n’a pas marché. Utilisez la phrase de passe.');
}

/**
 * Lit le secret PRF d'une passkey existante (demande Face ID).
 * @param {Uint8Array|string} credentialId
 * @param {Uint8Array|string} prfSalt
 * @returns {Promise<Uint8Array>} 32 octets
 */
export async function getPrfSecret(credentialId, prfSalt) {
  const id = typeof credentialId === 'string' ? fromB64(credentialId) : credentialId;
  const salt = typeof prfSalt === 'string' ? fromB64(prfSalt) : prfSalt;
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        rpId: RP_ID === location.hostname ? RP_ID : location.hostname,
        challenge: randomBytes(32), // pas de serveur à convaincre : seul le secret PRF compte
        allowCredentials: [{ type: 'public-key', id, transports: ['internal', 'hybrid'] }],
        userVerification: 'required',
        timeout: 120000,
        extensions: { prf: { eval: { first: salt } } },
      },
    });
  } catch (e) {
    throw webauthnError(e);
  }
  const first = bytes(cred?.getClientExtensionResults?.().prf?.results?.first);
  if (!first) throw new PasskeyError('Cet iPad ne permet pas d’utiliser Face ID pour ouvrir les données. Utilisez la phrase de passe.');
  return first;
}

/**
 * Crée la passkey de cet appareil et lit son secret PRF (un ou deux Face ID).
 * @param {string} label  ex. « iPad de Maman »
 * @returns {Promise<{credentialId: Uint8Array, prfSalt: Uint8Array, prfSecret: Uint8Array}>}
 */
export async function createPasskey(label) {
  const prfSalt = randomBytes(32);
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        rp: { id: RP_ID === location.hostname ? RP_ID : location.hostname, name: RP_NAME },
        user: { id: randomBytes(16), name: `Mon Budget — ${label}`, displayName: label },
        challenge: randomBytes(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        attestation: 'none',
        timeout: 120000,
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    });
  } catch (e) {
    throw webauthnError(e);
  }
  const ext = cred.getClientExtensionResults?.().prf;
  if (!ext?.enabled) throw new PasskeyError('Cet iPad ne permet pas d’utiliser Face ID pour ouvrir les données (mise à jour d’iPadOS nécessaire). La phrase de passe reste possible.');
  const credentialId = new Uint8Array(cred.rawId);
  // Certains appareils donnent le secret dès la création ; sinon, un second Face ID le lit.
  const prfSecret = bytes(ext.results?.first) ?? await getPrfSecret(credentialId, prfSalt);
  return { credentialId, prfSalt, prfSecret };
}
