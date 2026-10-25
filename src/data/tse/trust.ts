/**
 * Public verification key embedded in the official TSE app build 26.10.17 (7216371).
 * Source: https://resultados.tse.jus.br/oficial/app/main.f31aece23cbbdd2d.js
 * Retrieved 2026-10-25 UTC. This is public material, not a credential.
 *
 * That build configures an empty assinaturaJwsJwksUrl: no public rotation endpoint
 * is advertised. Reject unknown keys/signature failures; review a new official
 * app build over HTTPS before updating this pin. Never trust a token-supplied key.
 */
export const TSE_PUBLIC_JWK = {
  kty: 'OKP',
  use: 'sig',
  key_ops: ['verify'],
  alg: 'EdDSA',
  kid: 'sNbt9Q_fLS65zE1_ZLNV-XRRwPY',
  crv: 'Ed25519',
  x: 'kWlpNHjuws1csyQZwzn3Fhzbi3RD435RbpThtSr4hMc',
} as const;

export const TSE_TRUST_SOURCE =
  'https://resultados.tse.jus.br/oficial/app/main.f31aece23cbbdd2d.js';
