/**
 * passkey.js — Face ID / Touch ID par passkey (WebAuthn) avec l'extension PRF.
 *
 * Version : 0.14.3
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
 *   0.10.2 FRE (Fidag)  Messages : « phrase de secours ».
 *   0.14.2 FRE (Fidag)  Création : ne plus refuser quand l'appareil ne dit pas « enabled » ; essai réel du secret
 *                       (second Face ID / Touch ID). Messages « Face ID ou Touch ID ».
 *   0.14.3 FRE (Fidag)  Message clair quand la clé est dans une app de mots de passe externe (pas de secret PRF).
 */

import { RP_ID, RP_NAME } from './firebase-config.js';
import { randomBytes, fromB64 } from '../src/core/chiffrement.js';

/** Erreur à montrer telle quelle. */
export class PasskeyError extends Error {}

/** La clé existe mais ne donne pas son secret : le plus souvent, elle est dans une app de mots de passe externe. */
const NO_PRF = 'La clé « Mon Budget » a bien été enregistrée, mais l’endroit où elle est gardée ne permet pas d’ouvrir les données. '
  + 'C’est le cas de la plupart des apps de mots de passe autres que celle d’Apple (Proton Pass, 1Password, Bitwarden…). '
  + 'Supprimez cette clé dans cette app, puis réessayez en choisissant « Mots de passe » (Apple) pour l’enregistrer. La phrase de secours reste possible.';

const bytes = (buf) => {
  if (!buf) return null;
  if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  return new Uint8Array(buf).slice();
};

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
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return new PasskeyError('Face ID ou Touch ID a été annulé. Réessayez, ou utilisez la phrase de secours.');
  if (e?.name === 'InvalidStateError') return new PasskeyError('Cet appareil a déjà une clé Face ID ou Touch ID pour Mon Budget.');
  if (e?.name === 'SecurityError') return new PasskeyError('Face ID ou Touch ID ne fonctionne que depuis l’adresse officielle de l’app.');
  return new PasskeyError('Face ID ou Touch ID n’a pas marché. Utilisez la phrase de secours.');
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
  if (!first) throw new PasskeyError(NO_PRF);
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
  const credentialId = new Uint8Array(cred.rawId);
  // Certains appareils donnent le secret dès la création. Sinon (et même si l'appareil ne dit pas
  // « enabled »), on essaie vraiment : un second Face ID / Touch ID lit le secret.
  let prfSecret = bytes(ext?.results?.first);
  if (!prfSecret) {
    try {
      prfSecret = await getPrfSecret(credentialId, prfSalt);
    } catch (e) {
      if (e instanceof PasskeyError && /annulé/.test(e.message)) throw e;
      throw new PasskeyError(NO_PRF);
    }
  }
  return { credentialId, prfSalt, prfSecret };
}
