#!/bin/bash
# Manual APK build for Prime Trader AI (WebView wrapper).
# Packages web assets under assets/www/ to match MainActivity HOME_URL
# (file:///android_asset/www/index.html).
set -e
BT=~/workspace/android-sdk/build-tools/34.0.0
AJAR=~/workspace/android-sdk/platforms/android-34/android.jar
M=~/workspace/prime-trader-app/build/manual
SRC=~/workspace/prime-trader-app

echo "== 1. Stage web assets under assets/www/ =="
rm -rf "$M/apk-assets"
mkdir -p "$M/apk-assets/www/css" "$M/apk-assets/www/js"
cp "$SRC/index.html"   "$M/apk-assets/www/index.html"
cp "$SRC/css/app.css"  "$M/apk-assets/www/css/app.css"
cp "$SRC/js/app.js"    "$M/apk-assets/www/js/app.js"
cp "$SRC/logo.webp"    "$M/apk-assets/www/logo.webp"
find "$M/apk-assets" -type f

echo "== 2. aapt2 compile =="
rm -rf "$M/compiled-res" && mkdir -p "$M/compiled-res"
"$BT/aapt2" compile --dir "$M/res" -o "$M/compiled-res"

echo "== 3. aapt2 link =="
rm -rf "$M/gen" && mkdir -p "$M/gen"
"$BT/aapt2" link -o "$M/base.apk" \
  -I "$AJAR" \
  --manifest "$M/AndroidManifest.xml" \
  -A "$M/apk-assets" \
  --java "$M/gen" \
  "$M"/compiled-res/*.flat

echo "== 4. javac =="
rm -rf "$M/classes" "$M/dex" && mkdir -p "$M/classes" "$M/dex"
javac -source 1.8 -target 1.8 -nowarn \
  -cp "$AJAR" -d "$M/classes" \
  "$M/src/com/primetrader/signals/MainActivity.java" \
  "$M/src/com/primetrader/signals/QuotexWsClient.java" \
  "$M/src/com/primetrader/signals/ApkProvider.java" \
  "$M/gen/com/primetrader/signals/R.java"

echo "== 5. d8 =="
"$BT/d8" --lib "$AJAR" --output "$M/dex" "$M"/classes/com/primetrader/signals/*.class
ls -la "$M/dex/classes.dex"

echo "== 6. Add classes.dex (stored, uncompressed) =="
cp "$M/base.apk" "$M/unaligned.apk"
cd "$M/dex" && zip -0 -j "$M/unaligned.apk" classes.dex > /dev/null && cd "$M"

echo "== 7. zipalign =="
"$BT/zipalign" -f 4 "$M/unaligned.apk" "$M/aligned.apk"

echo "== 8. apksigner =="
rm -f "$M/PrimeTrader.apk" "$M/PrimeTrader.apk.idsig"
"$BT/apksigner" sign --ks "$M/debug.keystore" \
  --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey \
  --out "$M/PrimeTrader.apk" "$M/aligned.apk"

echo "== 9. Verify =="
"$BT/apksigner" verify --print-certs "$M/PrimeTrader.apk" | head -5
"$BT/aapt2" dump badging "$M/PrimeTrader.apk" | grep -E "package:|launchable-activity:|application-label:"
echo "--- assets in APK ---"
unzip -l "$M/PrimeTrader.apk" | grep "assets/"
echo "BUILD OK: $M/PrimeTrader.apk"
