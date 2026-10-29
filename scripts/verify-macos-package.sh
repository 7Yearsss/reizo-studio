#!/usr/bin/env bash
set -euo pipefail

# Check the extracted download, not just the app before ZIP creation.
checked=0
extract_dir=''
trap 'if [[ -n "$extract_dir" ]]; then rm -rf "$extract_dir"; fi' EXIT
while IFS= read -r -d '' archive; do
  extract_dir=$(mktemp -d "${TMPDIR:-/tmp}/reizo-signature.XXXXXX")
  ditto -x -k "$archive" "$extract_dir"
  app_count=0
  while IFS= read -r -d '' app; do
    codesign --verify --deep --strict --verbose=2 "$app"
    codesign --display --verbose=2 "$app"
    node scripts/verify-voice-model.mjs "$app/Contents/Resources"
    # Hardened runtime (flags=...runtime) enables library validation and makes
    # dyld reject the ad-hoc Electron Framework at launch.
    if codesign --display --verbose=2 "$app" 2>&1 | grep -q 'flags=.*runtime'; then
      echo "Hardened runtime must be off for ad-hoc signed app: $app" >&2
      exit 1
    fi
    app_count=$((app_count + 1))
  done < <(find "$extract_dir" -maxdepth 1 -name '*.app' -type d -print0)
  if [[ "$app_count" -ne 1 ]]; then
    echo "Expected one app bundle in $archive; found $app_count" >&2
    exit 1
  fi
  rm -rf "$extract_dir"
  extract_dir=''
  checked=$((checked + 1))
done < <(find out/make -type f -name '*.zip' -print0)
if [[ "$checked" -eq 0 ]]; then
  echo 'No macOS release ZIP found to verify' >&2
  exit 1
fi
