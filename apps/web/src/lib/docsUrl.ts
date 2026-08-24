/**
 * Canonical documentation destination for the Navbar "Docs" link, the Hero
 * "Read more" CTA, and JoinIn's "Docs" link. Mintlify (apps/docs) is a
 * separate site, not part of this Next.js app, so it needs its own deployed
 * URL — set NEXT_PUBLIC_DOCS_URL once it's connected to Mintlify's hosting
 * (see apps/docs/README.md). Falls back to the GitHub-rendered source so
 * these links are never dead in the meantime.
 */
export const DOCS_URL =
  process.env.NEXT_PUBLIC_DOCS_URL ||
  "https://github.com/Novaire-tech/novaire-testnet/tree/master/apps/docs";
