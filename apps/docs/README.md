# Novaire Docs (Mintlify)

Technical documentation for the Novaire protocol, built with [Mintlify](https://mintlify.com). Source of truth: `docs.json` (navigation/theme config) + the `.mdx` files under this directory.

## Local development

```bash
cd apps/docs
npx mintlify dev
```

Opens a local preview (default port collides with `apps/web`'s dev server — run one at a time, or pass a different `--port` if your installed CLI version supports it).

## Validating before pushing

```bash
npx mintlify broken-links   # checks every internal link/nav reference resolves
npx mintlify validate       # strict build validation (requires network access to fetch the Mintlify framework build)
```

`broken-links` passed clean (0 broken links across all pages) as of this branch. `validate` could not be completed in a network-isolated environment (it fetches a framework artifact on first run) — run it once from a machine with normal internet access before the first production deploy, and again after any `docs.json` schema change.

## What's required to deploy this to production

This directory is **not currently connected to Mintlify's hosting** — nothing here is live yet. To make it live:

1. **Create/use a Mintlify account** at [dashboard.mintlify.com](https://dashboard.mintlify.com) and connect it to the `Novaire-tech/novaire-testnet` GitHub repository (Mintlify's GitHub App).
2. **Point the Mintlify project at this subdirectory** — in the dashboard's project settings, set the docs root to `apps/docs`.
3. **Choose the deploy branch** — this needs to be the repository's default branch (`master`) or a branch merged into it; Mintlify's onboarding requires `docs.json` to exist on the default branch to accept the repository at all.
4. **Get the assigned URL** — Mintlify provisions a `<project-slug>.mintlify.app`-style URL automatically on first connection. The exact slug depends on what's chosen/available in the dashboard at connection time.
5. **(Optional) Add a custom domain** — via `npx mintlify add-domain <your-domain>` or the dashboard.
6. **Point the website at it** — set `NEXT_PUBLIC_DOCS_URL` (see root `.env.example`) in `apps/web`'s production environment to whatever URL step 4 or 5 produced. The Navbar "Docs" link, Hero "Read more" CTA, and JoinIn's "Docs" link all read this single env var (`apps/web/src/lib/docsUrl.ts`).

None of the above can be completed from within this repository or by an automated agent — it requires an authenticated Mintlify dashboard session and DNS/environment-variable access that live outside this codebase.

## Structure

See `docs.json`'s `navigation` block for the full page tree, grouped as: Introduction, Architecture, Protocol, Security, Testing, Developers, Deployment, Reference.
