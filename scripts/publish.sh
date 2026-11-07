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
         if ! out=$(cd "$(dirname "$pkg")" && vlt publish --access=public 2>&1); then
           echo "$out"
           # npm 404s a new version for a few minutes while it's processed, so the check above can be stale
           grep -q "already exists in the registry" <<<"$out" && { echo "skip $name@$version (still processing)"; continue; }
           exit 1
         fi
         echo "$out"
         # changesets/action pushes each "New tag:" (it must exist locally) and creates a GitHub Release for it
         git tag "$name@$version"
         echo "New tag: $name@$version" ;;
    *)   echo "unexpected HTTP $status checking $name@$version on $registry" >&2; exit 1 ;;
  esac
done
