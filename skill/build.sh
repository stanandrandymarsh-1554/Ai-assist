#!/bin/sh
# Rebuild the uploadable skill zip at the repo root.
set -e
cd "$(dirname "$0")"
rm -f ../ebay-etsy-shopping.zip
find ebay-etsy-shopping -name __pycache__ -prune -exec rm -rf {} +
zip -qr ../ebay-etsy-shopping.zip ebay-etsy-shopping -x '*.pyc'
echo "built $(cd .. && pwd)/ebay-etsy-shopping.zip"
