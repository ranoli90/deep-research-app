# Clerk configuration readback — 2026-09-20

Scope: read-only verification of the existing development instance. This record deliberately excludes API keys, instance URLs, user data, authentication headers, and response bodies.

## Instance and local-auth readback

| Check | Result | Meaning |
| --- | --- | --- |
| Authenticated Backend API `GET /v1/instance` | `200`; instance ID is the already-recorded `ins_3JcB20N0jPnpXio97hZH6AhPMD6`; environment type is `development`. | The existing secret key can read its BAPI instance. No configuration was changed. |
| `clerk config patch --help` (current CLI, agent mode) | Documents `--json`, `--file`, `--dry-run`, and `--yes`. | Clerk now documents a noninteractive configuration-as-code mechanism when the CLI has legitimate application/platform authority. |
| `clerk whoami --mode agent` | `auth_required`; no local Clerk CLI account session exists. | This machine cannot use `clerk config patch` against the existing application without a legitimate Clerk CLI/platform login. The command did not prompt. |
| Current official BAPI OpenAPI `2026-05-12` | `PATCH /beta_features/instance_settings` accepts only `restricted_to_allowlist`, `from_email_address`, `progressive_sign_up`, and `test_mode`. | The existing BAPI secret is not a documented way to enable email sign-up/sign-in OTP settings. |

## Email-code conclusion

The current Clerk CLI is a documented noninteractive local mechanism in principle, but it requires existing Clerk CLI/platform authority; this operator has none. The current instance secret-key BAPI surface does not expose an email-code enablement field. Therefore email-code remains **NOT_CONFIGURED**, with the precise external dependency being a legitimate Clerk Dashboard or CLI/platform-authenticated operator session—not a missing password, user data, or a reason to create a second instance.

The current Clerk authentication-options guide requires enabling email as an identifier, verification-at-sign-up using an email verification code, and sign-in with email using an email verification code. No attempt was made to apply those settings, send an OTP, create a user, configure Apple/Google, or test a provider journey.

## Sources consulted

- Clerk Backend API OpenAPI `2026-05-12`, published by Clerk: `https://raw.githubusercontent.com/clerk/openapi-specs/main/bapi/2026-05-12.yml`
- Clerk CLI reference: `https://clerk.com/docs/cli`
- Clerk sign-up/sign-in options guide: `https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options`

This is configuration/readback evidence only. It does not establish an integrated Clerk verifier, webhook, provider callback, native sign-in, guest-history claim, or production readiness.
