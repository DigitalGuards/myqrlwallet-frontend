# Consent and approval error-origin follow-up

Error details on the five consent and approval screens retain their original English rendering in every language. The slice 6 presentation-time error translator and its error-only catalog entries have been removed. Existing formatters preserve the base behavior, including wrappers, schema paths and desktop signer diagnostics.

The next separate change must create wallet errors with an explicit wallet origin, stable translation key and interpolation data at their source. Preserve that metadata through services, stores and wrappers until rendering. External relay, dApp and transport diagnostics must retain their opaque text, including text that happens to equal a wallet error. Wrapper remainders need their own origin metadata.

Tests for that change must distinguish identical wallet/external strings and mixed wrapper origins, including relay-supplied PIN text, desktop signer mismatch, schema validation, chain/fee failures and live language changes. This work requires a separate scope covering producers and error transport. See [the slice 6 boundary and parity tests](I18N.md#slice-6-pairing-consent-and-dapp-approvals).
