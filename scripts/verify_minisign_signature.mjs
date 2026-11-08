#!/usr/bin/env node
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function decodeBase64(value, label) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Invalid base64 in ${label}`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error(`Non-canonical base64 in ${label}`);
  return decoded;
}

function decodePublicKey(encoded) {
  const decoded = decodeBase64(encoded, 'configured public key envelope').toString('utf8');
  const lines = decoded.trimEnd().split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: minisign public key: ')) {
    throw new Error('Invalid configured Minisign public key envelope');
  }
  const key = decodeBase64(lines[1], 'configured public key');
  if (key.length !== 42 || key.subarray(0, 2).toString('ascii') !== 'Ed') {
    throw new Error('Unsupported configured Minisign public key');
  }
  return key;
}

async function digestFile(path) {
  const digest = createHash('blake2b512');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest();
}

async function main() {
  const [, , artifactPath, signaturePath, publicKeyEnvelope] = process.argv;
  if (!artifactPath || !signaturePath || !publicKeyEnvelope) {
    throw new Error('Usage: verify_minisign_signature.mjs ARTIFACT SIGNATURE PUBLIC_KEY_BASE64');
  }

  const publicKey = decodePublicKey(publicKeyEnvelope);
  const signatureLines = readFileSync(signaturePath, 'utf8').trimEnd().split(/\r?\n/);
  if (signatureLines.length !== 4 || !signatureLines[2].startsWith('trusted comment: ')) {
    throw new Error('Invalid Minisign signature envelope');
  }

  if (!signatureLines[0].startsWith('untrusted comment: ')) {
    throw new Error('Invalid Minisign signature comment');
  }
  const primary = decodeBase64(signatureLines[1], 'primary signature');
  const globalSignature = decodeBase64(signatureLines[3], 'trusted comment signature');
  if (primary.length !== 74 || globalSignature.length !== 64 || primary.subarray(0, 2).toString('ascii') !== 'ED') {
    throw new Error('Unsupported or malformed Minisign signature');
  }
  if (!primary.subarray(2, 10).equals(publicKey.subarray(2, 10))) {
    throw new Error('Minisign signature key ID does not match configured public key');
  }

  const rawKey = publicKey.subarray(10);
  const keyObject = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]),
    format: 'der',
    type: 'spki',
  });
  const fileDigest = await digestFile(artifactPath);
  if (!verify(null, fileDigest, keyObject, primary.subarray(10))) {
    throw new Error('Minisign artifact signature verification failed');
  }

  const trustedComment = signatureLines[2].slice('trusted comment: '.length);
  const globalPayload = Buffer.concat([primary.subarray(10), Buffer.from(trustedComment, 'utf8')]);
  if (!verify(null, globalPayload, keyObject, globalSignature)) {
    throw new Error('Minisign trusted comment signature verification failed');
  }
}

main().catch((error) => fail(error.message));
