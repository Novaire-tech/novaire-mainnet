#!/usr/bin/env bash
# Downloads a pinned, unpacked build of the Freighter extension for the
# real-wallet e2e spec. See ./README.md.
set -euo pipefail

# Pin together: bumping the version requires re-verifying the extension UI
# selectors in ../fixtures/freighter-onboarding.ts. sha256 taken from the
# release's own asset digest (GitHub API `assets[].digest`), not recomputed
# by us out-of-band.
FREIGHTER_VERSION="5.44.0"
FREIGHTER_SHA256="16eb5eacfefc9bc33b994b3a6a9660fb2736b7ab2190164ec90dafa8d399a7ef"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${SCRIPT_DIR}/freighter-extension"
ARCHIVE_URL="https://github.com/stellar/freighter/releases/download/${FREIGHTER_VERSION}/build-${FREIGHTER_VERSION}.zip"
TMP_ZIP="$(mktemp -t freighter-XXXXXX.zip)"

if [ -f "${DEST_DIR}/manifest.json" ]; then
  echo "Freighter extension already vendored at ${DEST_DIR}"
  exit 0
fi

if [ "${FREIGHTER_SHA256}" = "REPLACE_WITH_PINNED_SHA256" ]; then
  echo "download-freighter.sh: FREIGHTER_SHA256 is not pinned yet." >&2
  echo "Download ${ARCHIVE_URL} once, record its sha256sum, and set FREIGHTER_SHA256 above." >&2
  exit 1
fi

echo "Downloading Freighter ${FREIGHTER_VERSION}..."
curl -fsSL "${ARCHIVE_URL}" -o "${TMP_ZIP}"

echo "${FREIGHTER_SHA256}  ${TMP_ZIP}" | sha256sum -c -

rm -rf "${DEST_DIR}"
mkdir -p "${DEST_DIR}"
unzip -q "${TMP_ZIP}" -d "${DEST_DIR}"
rm -f "${TMP_ZIP}"

echo "Freighter ${FREIGHTER_VERSION} vendored at ${DEST_DIR}"
