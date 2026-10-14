#!/usr/bin/env bash
# Stelt de map samen die op de webhosting komt (de inhoud van public_html).
# Gebruikt door .github/workflows/deploy.yml; lokaal: scripts/build-hosting.sh dist/public_html
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-dist/public_html}
rm -rf "$OUT"
mkdir -p "$OUT/php"
cp -r index.html privacy.html voorwaarden.html sw.js manifest.webmanifest api.php .htaccess .user.ini css js icons fonts "$OUT"/
rm -rf "$OUT/js/app"  # bronstukken van js/app.js horen niet op de site
cp -r php/lib php/.htaccess "$OUT/php/"
if [ -d php/vendor ]; then cp -r php/vendor "$OUT/php/"; else echo "Let op: php/vendor ontbreekt (composer install in php/), AI-functie staat dan uit." >&2; fi
# Nieuwe versienaam voor de app-cache, zodat elk toestel de update meteen oppikt
VERSION=${HELDER_BUILD:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}
sed -i.orig "s/^const CACHE = '\([^']*\)';/const CACHE = '\1-$VERSION';/" "$OUT/sw.js" && rm -f "$OUT/sw.js.orig"
grep -q "^const CACHE = '.*-$VERSION';" "$OUT/sw.js" || { echo "Kon de cacheversie in sw.js niet aanpassen" >&2; exit 1; }
echo "Klaar: $OUT (versie $VERSION)"
