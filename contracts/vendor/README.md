# Vendored contracts

Third-party contracts deployed unchanged on the local chain. Each is the published build, checked by hash.

| File | What | Source | sha256 |
|---|---|---|---|
| `intents_verifier_v0.4.2.wasm` | NEAR Intents Verifier (the contract behind `intents.near`; mainnet runs 0.4.5) | GitHub release [`near/intents` `defuse/v0.4.2`](https://github.com/near/intents/releases/tag/defuse%2Fv0.4.2), `defuse.wasm` | `f67f9559b3b512c52dfa11723a28b9119bcf773ac01780370d6409e5f1fb20e5` (matches the release's `defuse.sha256`) |
| `poa_factory_v0.4.2.wasm` | NEAR Intents PoA token factory: bridged-token stand-ins for the simulated bridge | same release, `defuse_poa_factory.wasm` | `d8031ae7c0ca6721592e23b5f7370a9902982f94c67df993ff3e3a03ba837d77` (matches `poa-factory.sha256`) |
| `wnear.wasm` | wNEAR, which the Verifier requires | `near/intents` repo at `defuse/v0.4.2`, `releases/wnear.wasm` | `b72c26d390b23f4517d091a8aab06b0369d465356ec5fb337d5fda076da38ac0` |
| `sputnikdao2.wasm` | Sputnik DAO v2 | downloaded from mainnet (`view_code` of a DAO made by `sputnik-dao.near`) | code hash `DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF`, equal to the factory's `get_default_code_hash` |

The Verifier 0.4.2 uses state-init and global-contract host functions, so it needs nearcore 2.10 or newer
(the bundled near-sandbox is 2.13).

## License notices

Preserve [NEAR Intents MIT](LICENSE-near-intents) and [Sputnik DAO MIT](LICENSE-sputnik-dao) notices. These files are excluded from any original-OneUp license grant. See [third-party scope and provenance limits](../../THIRD_PARTY_NOTICES.md).
