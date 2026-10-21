/**
 * Lab PKI Certificate Generator (PS-006 FR-02 & FR-03)
 * Generates Root Lab CA and Replica Certificates with Subject Alternative Names (SANs)
 * and location attributes. Pure Node.js standard library (crypto + fs).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKI_ROOT = path.resolve(__dirname, "../pki");

// ASN.1 DER Encoding Helpers
function derLength(len) {
  if (len < 128) return Buffer.from([len]);
  const bytes = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag, buffer) {
  return Buffer.concat([Buffer.from([tag]), derLength(buffer.length), buffer]);
}

function derSequence(...items) {
  const buf = Buffer.concat(items.flat());
  return derTag(0x30, buf);
}

function derSet(...items) {
  const buf = Buffer.concat(items.flat());
  return derTag(0x31, buf);
}

function derInteger(num) {
  let buf = Buffer.alloc(4);
  buf.writeUInt32BE(num, 0);
  let start = 0;
  while (start < 3 && buf[start] === 0) start++;
  buf = buf.subarray(start);
  if (buf[0] & 0x80) {
    buf = Buffer.concat([Buffer.from([0x00]), buf]);
  }
  return derTag(0x02, buf);
}

function derBitString(buffer, unusedBits = 0) {
  return derTag(0x03, Buffer.concat([Buffer.from([unusedBits]), buffer]));
}

function derOctetString(buffer) {
  return derTag(0x04, buffer);
}

function derOid(oidStr) {
  const parts = oidStr.split(".").map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const enc = [];
    enc.push(v & 0x7f);
    v >>= 7;
    while (v > 0) {
      enc.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    bytes.push(...enc);
  }
  return derTag(0x06, Buffer.from(bytes));
}

function derPrintableString(str) {
  return derTag(0x13, Buffer.from(str, "ascii"));
}

function derUtf8String(str) {
  return derTag(0x0c, Buffer.from(str, "utf8"));
}

function derUtcTime(date) {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return derTag(0x17, Buffer.from(`${yy}${mm}${dd}${hh}${min}${ss}Z`, "ascii"));
}

// OIDs
const OID_COMMON_NAME = "2.5.4.3";
const OID_COUNTRY = "2.5.4.6";
const OID_ORGANIZATION = "2.5.4.10";
const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_SUBJECT_ALT_NAME = "2.5.29.17";

function buildName(attrs) {
  const sets = [];
  if (attrs.C) {
    sets.push(derSet(derSequence(derOid(OID_COUNTRY), derPrintableString(attrs.C))));
  }
  if (attrs.O) {
    sets.push(derSet(derSequence(derOid(OID_ORGANIZATION), derUtf8String(attrs.O))));
  }
  if (attrs.CN) {
    sets.push(derSet(derSequence(derOid(OID_COMMON_NAME), derUtf8String(attrs.CN))));
  }
  return derSequence(sets);
}

function buildAlgorithmIdentifier(oid) {
  return derSequence(derOid(oid), Buffer.from([0x05, 0x00])); // NULL params
}

function extractSubjectPublicKeyInfo(publicKeyPem) {
  const b64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  return Buffer.from(b64, "base64");
}

function buildSanExtension(sans = {}) {
  // SAN GeneralNames: DNS=[2], URI=[6], IP=[7]
  const entries = [];
  if (sans.dns) {
    for (const d of sans.dns) {
      entries.push(derTag(0x82, Buffer.from(d, "utf8")));
    }
  }
  if (sans.uri) {
    for (const u of sans.uri) {
      entries.push(derTag(0x86, Buffer.from(u, "utf8")));
    }
  }
  if (sans.ip) {
    for (const ip of sans.ip) {
      const parts = ip.split(".").map(Number);
      entries.push(derTag(0x87, Buffer.from(parts)));
    }
  }
  const extValue = derSequence(entries);
  return derSequence(derOid(OID_SUBJECT_ALT_NAME), derOctetString(extValue));
}

function createCertificate({
  serialNumber,
  issuerAttrs,
  subjectAttrs,
  publicKeyPem,
  signingPrivateKeyPem,
  isCA = false,
  sans = null,
  validityDays = 365,
}) {
  const notBefore = new Date(Date.now() - 60000);
  const notAfter = new Date(Date.now() + validityDays * 86400000);

  const validity = derSequence(derUtcTime(notBefore), derUtcTime(notAfter));
  const spki = extractSubjectPublicKeyInfo(publicKeyPem);
  const algId = buildAlgorithmIdentifier(OID_SHA256_WITH_RSA);

  // Extensions
  const extList = [];
  if (isCA) {
    // BasicConstraints: cA=TRUE
    const bcVal = derSequence(Buffer.from([0x01, 0x01, 0xff]));
    extList.push(derSequence(derOid(OID_BASIC_CONSTRAINTS), Buffer.from([0x01, 0x01, 0xff]), derOctetString(bcVal)));
  }
  if (sans) {
    extList.push(buildSanExtension(sans));
  }

  const extensions = extList.length > 0 ? derTag(0xa3, derSequence(extList)) : Buffer.alloc(0);

  // Version 3: [0] EXPLICIT INTEGER (2)
  const v3Tag = derTag(0xa0, derInteger(2));

  const tbs = derSequence([
    v3Tag,
    derInteger(serialNumber),
    algId,
    buildName(issuerAttrs),
    validity,
    buildName(subjectAttrs),
    spki,
    extensions,
  ]);

  const sign = crypto.createSign("SHA256");
  sign.update(tbs);
  sign.end();
  const signature = sign.sign({ key: signingPrivateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING });

  const certDer = derSequence(tbs, algId, derBitString(signature));
  const b64 = certDer.toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

function generateKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

export function generateAllPki() {
  console.log("=== Generating PS-006 Lab PKI Infrastructure ===");

  fs.mkdirSync(path.join(PKI_ROOT, "ca"), { recursive: true });
  fs.mkdirSync(path.join(PKI_ROOT, "replica-a"), { recursive: true });
  fs.mkdirSync(path.join(PKI_ROOT, "replica-b"), { recursive: true });

  // 1. Root Lab CA
  console.log("1. Generating Root Lab CA (Lab-CA-Root)...");
  const caKey = generateKeyPair();
  const caAttrs = { C: "IN", O: "AIORI PS-006 Lab", CN: "Lab Root CA" };
  const caCertPem = createCertificate({
    serialNumber: 1,
    issuerAttrs: caAttrs,
    subjectAttrs: caAttrs,
    publicKeyPem: caKey.publicKey,
    signingPrivateKeyPem: caKey.privateKey,
    isCA: true,
  });

  fs.writeFileSync(path.join(PKI_ROOT, "ca", "ca.key"), caKey.privateKey);
  fs.writeFileSync(path.join(PKI_ROOT, "ca", "ca.crt"), caCertPem);

  // 2. Rogue / Untrusted CA (for testing R2_CERT_UNTRUSTED)
  console.log("2. Generating Rogue Untrusted CA...");
  const rogueKey = generateKeyPair();
  const rogueAttrs = { C: "XX", O: "Rogue Unauthorized Lab", CN: "Rogue Untrusted CA" };
  const rogueCertPem = createCertificate({
    serialNumber: 99,
    issuerAttrs: rogueAttrs,
    subjectAttrs: rogueAttrs,
    publicKeyPem: rogueKey.publicKey,
    signingPrivateKeyPem: rogueKey.privateKey,
    isCA: true,
  });
  fs.writeFileSync(path.join(PKI_ROOT, "ca", "rogue-ca.key"), rogueKey.privateKey);
  fs.writeFileSync(path.join(PKI_ROOT, "ca", "rogue-ca.crt"), rogueCertPem);

  // 3. Replica A (Compliant, Location IN)
  console.log("3. Generating Replica A Certificate (Location: IN, SAN: URI:spiffe://lab/replica/in)...");
  const repAKey = generateKeyPair();
  const repACertPem = createCertificate({
    serialNumber: 101,
    issuerAttrs: caAttrs,
    subjectAttrs: { C: "IN", O: "AIORI PS-006 Lab", CN: "replica-a.lab.local" },
    publicKeyPem: repAKey.publicKey,
    signingPrivateKeyPem: caKey.privateKey,
    sans: {
      dns: ["replica-a.lab.local", "replica-a", "localhost"],
      ip: ["127.0.0.1"],
      uri: ["spiffe://lab/replica/in"],
    },
  });
  fs.writeFileSync(path.join(PKI_ROOT, "replica-a", "tls.key"), repAKey.privateKey);
  fs.writeFileSync(path.join(PKI_ROOT, "replica-a", "tls.crt"), repACertPem);

  // 4. Replica B — Compliant (Location IN)
  console.log("4. Generating Replica B Compliant Certificate (Location: IN)...");
  const repBKey = generateKeyPair();
  const repBCompliantCertPem = createCertificate({
    serialNumber: 201,
    issuerAttrs: caAttrs,
    subjectAttrs: { C: "IN", O: "AIORI PS-006 Lab", CN: "replica-b.lab.local" },
    publicKeyPem: repBKey.publicKey,
    signingPrivateKeyPem: caKey.privateKey,
    sans: {
      dns: ["replica-b.lab.local", "replica-b", "localhost"],
      ip: ["127.0.0.1"],
      uri: ["spiffe://lab/replica/in"],
    },
  });
  fs.writeFileSync(path.join(PKI_ROOT, "replica-b", "compliant.key"), repBKey.privateKey);
  fs.writeFileSync(path.join(PKI_ROOT, "replica-b", "compliant.crt"), repBCompliantCertPem);

  // 5. Replica B — Wrong Location (Location EU)
  console.log("5. Generating Replica B Wrong Location Certificate (Location: EU)...");
  const repBWrongLocCertPem = createCertificate({
    serialNumber: 202,
    issuerAttrs: caAttrs,
    subjectAttrs: { C: "EU", O: "AIORI PS-006 Lab", CN: "replica-b.lab.local" },
    publicKeyPem: repBKey.publicKey,
    signingPrivateKeyPem: caKey.privateKey,
    sans: {
      dns: ["replica-b.lab.local", "replica-b", "localhost"],
      ip: ["127.0.0.1"],
      uri: ["spiffe://lab/replica/eu"],
    },
  });
  fs.writeFileSync(path.join(PKI_ROOT, "replica-b", "wrong-location.crt"), repBWrongLocCertPem);

  // 6. Replica B — Label Mismatch (Subject C=IN, but SAN URI=spiffe://lab/replica/eu)
  console.log("6. Generating Replica B Label Mismatch Certificate...");
  const repBMismatchCertPem = createCertificate({
    serialNumber: 203,
    issuerAttrs: caAttrs,
    subjectAttrs: { C: "IN", O: "AIORI PS-006 Lab", CN: "replica-b.lab.local" },
    publicKeyPem: repBKey.publicKey,
    signingPrivateKeyPem: caKey.privateKey,
    sans: {
      dns: ["replica-b.lab.local", "replica-b", "localhost"],
      ip: ["127.0.0.1"],
      uri: ["spiffe://lab/replica/eu"],
    },
  });
  fs.writeFileSync(path.join(PKI_ROOT, "replica-b", "label-mismatch.crt"), repBMismatchCertPem);

  // 7. Replica B — Untrusted (Signed by Rogue CA)
  console.log("7. Generating Replica B Untrusted Certificate (signed by Rogue CA)...");
  const repBUntrustedCertPem = createCertificate({
    serialNumber: 204,
    issuerAttrs: rogueAttrs,
    subjectAttrs: { C: "IN", O: "Rogue Unauthorized Lab", CN: "replica-b.lab.local" },
    publicKeyPem: repBKey.publicKey,
    signingPrivateKeyPem: rogueKey.privateKey,
    sans: {
      dns: ["replica-b.lab.local", "replica-b", "localhost"],
      ip: ["127.0.0.1"],
      uri: ["spiffe://lab/replica/in"],
    },
  });
  fs.writeFileSync(path.join(PKI_ROOT, "replica-b", "untrusted.crt"), repBUntrustedCertPem);

  // Write PKI manifest / README
  const manifest = `# PS-006 Lab PKI Hierarchy & Manifest

Issued by Algo-Ancesstors (A3-PS006-TC329) Lab Certificate Authority.

| Entity | Role | Subject | Issuer | SANs | Status |
|---|---|---|---|---|---|
| \`ca/ca.crt\` | Root CA | C=IN, O=AIORI PS-006 Lab, CN=Lab Root CA | Self-Signed | cA=TRUE | Trusted Root |
| \`ca/rogue-ca.crt\` | Rogue CA | C=XX, O=Rogue Lab, CN=Rogue Untrusted CA | Self-Signed | cA=TRUE | Untrusted |
| \`replica-a/tls.crt\` | Replica A | C=IN, CN=replica-a.lab.local | Lab Root CA | URI:spiffe://lab/replica/in | Compliant |
| \`replica-b/compliant.crt\` | Replica B | C=IN, CN=replica-b.lab.local | Lab Root CA | URI:spiffe://lab/replica/in | Compliant |
| \`replica-b/wrong-location.crt\` | Replica B | C=EU, CN=replica-b.lab.local | Lab Root CA | URI:spiffe://lab/replica/eu | Policy Refused (R3) |
| \`replica-b/label-mismatch.crt\` | Replica B | C=IN, CN=replica-b.lab.local | Lab Root CA | URI:spiffe://lab/replica/eu | Policy Refused (R4) |
| \`replica-b/untrusted.crt\` | Replica B | C=IN, CN=replica-b.lab.local | Rogue CA | URI:spiffe://lab/replica/in | Gate Refused (R2) |
`;
  fs.writeFileSync(path.join(PKI_ROOT, "README.md"), manifest);

  console.log("=== PKI Generation Complete ===");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateAllPki();
}
