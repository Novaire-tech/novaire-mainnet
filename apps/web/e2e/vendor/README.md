# Vendored Freighter extension

`download-freighter.sh` fetches a pinned, unpacked build of the
[Freighter](https://github.com/stellar/freighter) wallet extension into
`freighter-extension/` for the real-wallet e2e spec
(`apps/web/e2e/deposit.real-wallet.spec.ts`). It is gitignored — this
directory is populated at test-setup time, not committed.

Run it via `npm run vendor:freighter` (wired as `pretest:e2e:real`), or
directly:

```
apps/web/e2e/vendor/download-freighter.sh
```

## Pinning

Update `FREIGHTER_VERSION` and `FREIGHTER_SHA256` in `download-freighter.sh`
together whenever the vendored version is bumped, and re-verify the
`getByRole`/`getByPlaceholder` selectors in
`apps/web/e2e/fixtures/freighter-onboarding.ts` against the new build's UI —
they target Freighter's own screens, which this repo does not control.
