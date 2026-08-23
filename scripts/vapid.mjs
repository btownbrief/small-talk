// Generates a VAPID key pair for web push. Paste the public key into
// js/net.js (VAPID_PUBLIC_KEY) and set both as Supabase secrets (see
// supabase/functions/st-notify/index.ts). Run once; never commit the private key.
import { generateKeyPairSync } from 'node:crypto';
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64'), Buffer.from(pub.y, 'base64')]);
console.log('VAPID_PUBLIC_KEY=' + b64(raw));
console.log('VAPID_PRIVATE_KEY=' + b64(Buffer.from(priv.d, 'base64')));
