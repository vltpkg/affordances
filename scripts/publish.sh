#!/usr/bin/env bash
# Publish every public package in packages/ whose version isn't on $VLT_REGISTRY yet.
# Skips versions that already exist, so it's safe to rerun after a partial failure.
# Uses `vlt publish` because it rewrites `workspace:*` deps to real versions (npm publish doesn't).
set -euo pipefail

registry="${VLT_REGISTRY:-https://registry.npmjs.org/}"
registry="${registry%/}"

for pkg in packages/*/package.json; do
  [[ "$(jq -r '.private // false' "$pkg")" == "true" ]] && continue
  name=$(jq -r .name "$pkg")
  version=$(jq -r .version "$pkg")

  status=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${VLT_TOKEN:-}" \
    "$registry/${name/\//%2f}/$version")

  case "$status" in
    200) echo "skip $name@$version (already on $registry)" ;;
    404) echo "publish $name@$version -> $registry"
         (cd "$(dirname "$pkg")" && vlt publish --access=public)
         # changesets/action pushes each "New tag:" (it must exist locally) and creates a GitHub Release for it
         git tag "$name@$version"
         echo "New tag: $name@$version" ;;
    *)   echo "unexpected HTTP $status checking $name@$version on $registry" >&2; exit 1 ;;
  esac
done
