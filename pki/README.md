# PS-006 Lab PKI Hierarchy & Manifest

Issued by Algo-Ancesstors (A3-PS006-TC329) Lab Certificate Authority.

| Entity | Role | Subject | Issuer | SANs | Status |
|---|---|---|---|---|---|
| `ca/ca.crt` | Root CA | C=IN, O=AIORI PS-006 Lab, CN=Lab Root CA | Self-Signed | cA=TRUE | Trusted Root |
| `ca/rogue-ca.crt` | Rogue CA | C=XX, O=Rogue Lab, CN=Rogue Untrusted CA | Self-Signed | cA=TRUE | Untrusted |
| `replica-a/tls.crt` | Replica A | C=IN, CN=replica-a.lab.local | Lab Root CA | URI:spiffe://lab/replica/in | Compliant |
| `replica-b/compliant.crt` | Replica B | C=IN, CN=replica-b.lab.local | Lab Root CA | URI:spiffe://lab/replica/in | Compliant |
| `replica-b/wrong-location.crt` | Replica B | C=EU, CN=replica-b.lab.local | Lab Root CA | URI:spiffe://lab/replica/eu | Policy Refused (R3) |
| `replica-b/label-mismatch.crt` | Replica B | C=IN, CN=replica-b.lab.local | Lab Root CA | URI:spiffe://lab/replica/eu | Policy Refused (R4) |
| `replica-b/untrusted.crt` | Replica B | C=IN, CN=replica-b.lab.local | Rogue CA | URI:spiffe://lab/replica/in | Gate Refused (R2) |
