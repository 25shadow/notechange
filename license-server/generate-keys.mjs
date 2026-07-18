import { generateKeyPairSync } from 'node:crypto';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
console.log(`LICENSE_PRIVATE_KEY_PEM=${JSON.stringify(privateKey.export({ type: 'pkcs8', format: 'pem' }))}`);
console.log(`NOTECHANGE_LICENSE_PUBLIC_KEY=${JSON.stringify(publicKey.export({ type: 'spki', format: 'pem' }))}`);
