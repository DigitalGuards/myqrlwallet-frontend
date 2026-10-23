#!/usr/bin/env bash
set -euo pipefail

action_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
package_cache="${I18N_FONT_PACKAGE_CACHE:?I18N_FONT_PACKAGE_CACHE is required}"
font_dir="${I18N_FONT_INSTALL_DIR:-$HOME/.local/share/fonts/myqrlwallet-ci}"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$package_cache" "$font_dir"

# These architecture-independent font files need no package manager or root.
# The cache key hashes this exact version/checksum lock; every restore is verified.
while read -r package version sha256 url; do
  archive="$package_cache/${url##*/}"
  if [[ -f "$archive" ]]; then
    echo "Language fonts: cached $package=$version"
  else
    echo "Language fonts: downloading $package=$version"
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 20 --max-time 180 \
      "$url" --output "$staging/package.deb"
    echo "$sha256  $staging/package.deb" | sha256sum --check --status
    mv "$staging/package.deb" "$archive"
  fi
  if ! echo "$sha256  $archive" | sha256sum --check --status; then
    echo "::error::Language font checksum mismatch: $package=$version"
    exit 1
  fi
  test "$(dpkg-deb --field "$archive" Package)" = "$package"
  test "$(dpkg-deb --field "$archive" Version)" = "$version"
  dpkg-deb --extract "$archive" "$staging/$package"
  cp -R "$staging/$package/usr/share/fonts/." "$font_dir/"
done < "$action_dir/fonts.lock"

fc-cache --force "$font_dir"
echo "Language fonts: installed and fontconfig cache refreshed."
