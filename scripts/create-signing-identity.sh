#!/usr/bin/env bash
#
# Create the stable code-signing identity used by release builds (idempotent).
#
# Why: ad-hoc signing gives the bundle a designated requirement of `cdhash H"…"` — a new
# code identity on every build, so every macOS permission the user granted dies on update
# (TCC keys grants on that requirement). A self-signed identity gives
# `identifier "com.onblog.miaomiao" and certificate leaf = H"…"`, which survives rebuilds.
#
# The identity is a signing key, so it lives outside the repository:
#
#   ~/.config/miaomiao-notes-signing/{key.pem,cert.pem,id.p12,password.txt}
#
# Run once per build machine. Losing the key means a new identity, and one more round of
# re-granting permissions for everyone — back the directory up somewhere safe.
#
#   scripts/create-signing-identity.sh            # create if missing, import into keychain
#   scripts/create-signing-identity.sh --reimport # import the stored p12 again
#
set -euo pipefail

IDENTITY="Miaomiao Notes Code Signing"
STORE="${HOME}/.config/miaomiao-notes-signing"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if security find-identity -p codesigning 2>/dev/null | grep -q "${IDENTITY}"; then
  echo "identity already present: ${IDENTITY}"
  exit 0
fi

mkdir -p "${STORE}"
chmod 700 "${STORE}"

if [[ ! -f "${STORE}/id.p12" ]]; then
  echo "creating a self-signed code-signing certificate in ${STORE}"
  # A fresh random password protects the local p12; it never leaves this directory.
  PASSWORD="$(openssl rand -hex 16)"
  printf '%s\n' "${PASSWORD}" > "${STORE}/password.txt"

  # The extensions matter: codesign refuses a certificate that is not marked for code signing.
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "${STORE}/key.pem" -out "${STORE}/cert.pem" -days 3650 \
    -subj "/CN=${IDENTITY}" \
    -addext "extendedKeyUsage=codeSigning" \
    -addext "basicConstraints=critical,CA:false" \
    -addext "keyUsage=critical,digitalSignature" >/dev/null 2>&1
  # -legacy: macOS keeps verifying PKCS#12 with legacy algorithms; the OpenSSL 3 defaults
  # make `security import` fail with "MAC verification failed".
  openssl pkcs12 -export -legacy \
    -inkey "${STORE}/key.pem" -in "${STORE}/cert.pem" \
    -out "${STORE}/id.p12" -passout "pass:${PASSWORD}" >/dev/null 2>&1
fi

chmod 600 "${STORE}"/*

# -T /usr/bin/codesign grants codesign access to the private key, so an unattended build
# never blocks on a keychain prompt. No -v here on purpose: a self-signed root is never
# "trusted", and codesign does not need it to be.
security import "${STORE}/id.p12" -k "${KEYCHAIN}" -P "$(cat "${STORE}/password.txt")" \
  -T /usr/bin/codesign >/dev/null
echo "imported identity: ${IDENTITY}"
security find-identity -p codesigning | grep "${IDENTITY}" || true
