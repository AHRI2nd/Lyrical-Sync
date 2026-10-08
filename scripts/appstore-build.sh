#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Local Mac App Store build. Upload remains a separate manual step.
MODE="signed"
case "${1:-}" in
  --check) MODE="check" ;;
  --unsigned) MODE="unsigned" ;;
  "") ;;
  *) echo "Usage: $0 [--check|--unsigned]" >&2; exit 2 ;;
esac
if [[ "$(uname -s)" != "Darwin" ]]; then echo "Run this script on macOS" >&2; exit 1; fi
TARGET="${APPSTORE_TARGET:-aarch64-apple-darwin}"
case "$TARGET" in aarch64-apple-darwin|x86_64-apple-darwin|universal-apple-darwin) ;; *) echo "Unsupported Mac target: $TARGET" >&2; exit 1 ;; esac
for tool in node npm cargo rustup python3 plutil codesign security productbuild pkgutil; do command -v "$tool" >/dev/null; done
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')).version")
BUNDLE_ID=$(node -p "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')).identifier")
python3 - "$VERSION" <<'PY'
import json,re,sys
version=sys.argv[1]
assert re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)',version), 'Use a stable three-part app version'
assert json.load(open('package.json'))['version']==version, 'App and Tauri versions disagree'
assert re.search(r'^version\s*=\s*"'+re.escape(version)+r'"\s*$',open('src-tauri/Cargo.toml').read(),re.M), 'Cargo version disagrees'
PY
OUT="$(pwd)/artifacts/appstore"
mkdir -p "$OUT"
WORK=$(mktemp -d "$OUT/preflight.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
APP_PATH="src-tauri/target/${TARGET}/release/bundle/macos/Lyrical Sync.app"
PROFILE="${APPSTORE_PROFILE:-$HOME/Library/MobileDevice/Provisioning Profiles/lyrical-sync.provisionprofile}"
DIST_IDENTITY="${APPSTORE_SIGNING_IDENTITY:-}"
INSTALLER_IDENTITY="${APPSTORE_INSTALLER_IDENTITY:-}"
if [[ "$MODE" != "unsigned" ]]; then
  [[ -f "$PROFILE" ]] || { echo "Missing distribution profile: $PROFILE" >&2; exit 1; }
  security cms -D -i "$PROFILE" -o "$WORK/profile.plist"
  security find-identity -v -p basic > "$WORK/identities.txt"
  python3 scripts/appstore-profile.py --profile "$WORK/profile.plist" --bundle-id "$BUNDLE_ID" --template src-tauri/entitlements.plist --output "$WORK/entitlements.plist" --identities "$WORK/identities.txt" --signing-identity "$DIST_IDENTITY" --installer-identity "$INSTALLER_IDENTITY" > "$WORK/profile-info.json"
  TEAM=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["team"])' "$WORK/profile-info.json")
  DIST_IDENTITY=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["signingIdentity"])' "$WORK/profile-info.json")
  INSTALLER_IDENTITY=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["installerIdentity"])' "$WORK/profile-info.json")
  echo "Validated profile for $BUNDLE_ID, team $TEAM"
fi
if [[ "$MODE" == "check" ]]; then echo "App Store preflight passed"; exit 0; fi
if [[ "$TARGET" == "universal-apple-darwin" ]]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
else
  rustup target add "$TARGET"
fi
# Explicitly suppress automatic signing/notarization from Tauri or inherited environment.
# Scope the macOS 27 host-library workaround to this Mac build process.
CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=none npm run tauri -- build --config src-tauri/tauri.appstore.conf.json --bundles app --target "$TARGET" --no-sign -- --locked
[[ -f "$APP_PATH/Contents/Resources/PrivacyInfo.xcprivacy" ]] || { echo "Privacy manifest missing from final app" >&2; exit 1; }
plutil -lint "$APP_PATH/Contents/Resources/PrivacyInfo.xcprivacy"
python3 - "$APP_PATH" "$BUNDLE_ID" "$VERSION" <<'PY'
import plistlib,sys
p=plistlib.load(open(sys.argv[1]+'/Contents/Info.plist','rb'))
assert p['CFBundleIdentifier']==sys.argv[2], 'Final bundle identifier mismatch'
assert p['CFBundleShortVersionString']==sys.argv[3], 'Final app version mismatch'
assert p['CFBundleVersion']==sys.argv[3], 'Final app build number mismatch'
PY
if [[ "$MODE" == "unsigned" ]]; then echo "Unsigned app verified: $(pwd)/$APP_PATH"; exit 0; fi
cp "$PROFILE" "$APP_PATH/Contents/embedded.provisionprofile"
# Sign nested code inside out. The app itself receives sandbox entitlements.
while IFS= read -r -d '' nested; do codesign --force --sign "$DIST_IDENTITY" "$nested"; done < <(find "$APP_PATH/Contents" -depth \( -name '*.dylib' -o -name '*.framework' -o -name '*.app' -o -name '*.xpc' \) -print0)
codesign --force --entitlements "$WORK/entitlements.plist" --identifier "$BUNDLE_ID" --sign "$DIST_IDENTITY" "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
codesign -d --entitlements :- "$APP_PATH" > "$WORK/signed-entitlements.plist"
codesign -dv --verbose=4 "$APP_PATH" 2> "$WORK/signature.txt"
python3 - "$WORK" "$TEAM" <<'PY'
import pathlib,plistlib,sys
p=pathlib.Path(sys.argv[1])
expected=plistlib.load(open(p/'entitlements.plist','rb'))
actual=plistlib.load(open(p/'signed-entitlements.plist','rb'))
assert all(actual.get(k)==v for k,v in expected.items()), 'Signed entitlements differ'
assert ('TeamIdentifier='+sys.argv[2]) in (p/'signature.txt').read_text(), 'Signing identity does not match profile team'
PY
PKG="$OUT/LyricalSync-${VERSION}-${TARGET}-$(date +%Y%m%d-%H%M%S).pkg"
[[ ! -e "$PKG" ]] || { echo "Refusing to overwrite $PKG" >&2; exit 1; }
productbuild --component "$APP_PATH" /Applications --sign "$INSTALLER_IDENTITY" "$PKG"
pkgutil --check-signature "$PKG" | tee "$WORK/pkg-signature.txt"
python3 - "$WORK/pkg-signature.txt" "$TEAM" <<'PY'
import sys
assert ('('+sys.argv[2]+')') in open(sys.argv[1]).read(), 'Installer identity does not match profile team'
PY
shasum -a 256 "$PKG" > "$PKG.sha256"
cp "$WORK/profile-info.json" "$PKG.profile-info.json"
python3 - "$PKG" "$VERSION" "$BUNDLE_ID" "$TARGET" "$WORK/profile-info.json" <<'PY_RECORD'
import hashlib,json,pathlib,subprocess,sys
pkg=pathlib.Path(sys.argv[1])
def command(*args):
    return subprocess.check_output(args,text=True).strip()
record={"appVersion":sys.argv[2],"bundleIdentifier":sys.argv[3],"target":sys.argv[4],"packageSha256":hashlib.sha256(pkg.read_bytes()).hexdigest(),"sourceCommit":command('git','rev-parse','HEAD'),"workingTree":command('git','status','--short').splitlines(),"profile":json.load(open(sys.argv[5])),"tools":{"node":command('node','--version'),"cargo":command('cargo','--version'),"rustc":command('rustc','--version'),"xcode":command('xcodebuild','-version')}}
pkg.with_suffix(pkg.suffix+'.build-record.json').write_text(json.dumps(record,indent=2)+'\n')
PY_RECORD
echo "Signed App Store package verified: $PKG"
echo "Validate sandbox behavior and upload manually with Transporter."
