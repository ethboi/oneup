# Third-party notices and scope

The license for original OneUp code does not relicense third-party works. Preserve the
notices below when redistributing the corresponding binaries. This inventory is not a claim that all
transitive dependency obligations have been audited.

| Material | Notice / source |
|---|---|
| Intents verifier and PoA factory v0.4.2 | [MIT notice](contracts/vendor/LICENSE-near-intents), NEAR Foundation 2025; pinned release commit `6dad94cf8a9cf3083d9c1cf6c052ef8cdde0d473` |
| wNEAR binary from that release | Same pinned repository's `wnear/` source and root MIT notice; preserve provenance and binary hash in vendor README |
| Sputnik DAO v2 binary | [MIT notice](contracts/vendor/LICENSE-sputnik-dao), near-daos 2021; upstream https://github.com/near-daos/sputnik-dao-contract |

See [binary provenance and hashes](contracts/vendor/README.md). The Sputnik binary came from a chain
code hash; an exact source commit/build reproduction for that hash has not been established here. The
upstream notice is retained without pretending this is a reproducible-source attestation.

Rust and JavaScript dependencies retain package-specific licenses. Inspect Cargo.lock/pnpm-lock.yaml
and installed package notices before distributing compiled bundles. Product/service names and logos
remain their owners' marks; a code license grants no trademark endorsement. Papertrade and Aerodrome
are credited design references, not claimed as OneUp-owned implementations.
