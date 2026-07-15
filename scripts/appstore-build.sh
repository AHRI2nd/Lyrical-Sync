#!/usr/bin/env bash
set -euo pipefail

# Mac App Store 제출용 로컬 빌드 스크립트.
# 예전 GitHub Actions self-hosted 러너(release.yml)를 대체 — 빌드·서명·.pkg 패키징까지
# 이 스크립트가 하고, App Store Connect 업로드는 Transporter.app으로 수동 진행합니다.
#
# 사전 준비(최초 1회, 이미 되어 있으면 생략):
#   - 로그인 키체인에 "Apple Distribution: ..." / "3rd Party Mac Developer Installer: ..." 인증서
#   - ~/Library/MobileDevice/Provisioning Profiles/lyrical-sync.provisionprofile
#   - Transporter.app (Mac App Store에서 설치)
#
# 실행 중 macOS가 "코드사인이 로그인 키체인의 개인 키를 사용하려 합니다" 같은
# 확인 다이얼로그를 띄우면 Allow/허용을 눌러주세요(로컬 실행이라 자연스럽게 뜸).

cd "$(dirname "$0")/.."

TARGET="aarch64-apple-darwin"
APP_PATH="src-tauri/target/${TARGET}/release/bundle/macos/Lyrical Sync.app"
ENTITLEMENTS="src-tauri/entitlements.plist"
BUNDLE_ID="com.arisair.lyrical-sync"
PROFILE="$HOME/Library/MobileDevice/Provisioning Profiles/lyrical-sync.provisionprofile"
PKG_NAME="Lyrical Sync.pkg"

# 서명 아이덴티티는 로그인 키체인에서 자동 탐색(팀마다 이름이 달라 하드코딩하지 않음)
DIST_IDENTITY=$(security find-identity -v -p basic | grep -o '"Apple Distribution:[^"]*"' | head -1 | tr -d '"')
INSTALLER_IDENTITY=$(security find-identity -v -p basic | grep -o '"3rd Party Mac Developer Installer:[^"]*"' | head -1 | tr -d '"')

if [ -z "$DIST_IDENTITY" ] || [ -z "$INSTALLER_IDENTITY" ]; then
  echo "❌ 서명 인증서를 로그인 키체인에서 찾을 수 없습니다."
  echo "   'Apple Distribution: ...' 와 '3rd Party Mac Developer Installer: ...' 인증서가 필요합니다."
  echo "   Xcode > Settings > Accounts 에서 인증서를 내려받거나, Keychain Access로 .p12를 임포트하세요."
  exit 1
fi
if [ ! -f "$PROFILE" ]; then
  echo "❌ Provisioning Profile을 찾을 수 없습니다: $PROFILE"
  echo "   Apple Developer 사이트에서 Mac App Store 배포용 프로파일을 내려받아 위 경로에 두세요."
  exit 1
fi

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")

echo "→ 서명 아이덴티티: $DIST_IDENTITY"
echo "→ 설치 패키지 아이덴티티: $INSTALLER_IDENTITY"
echo "→ 빌드 버전: $VERSION"
echo ""

echo "[1/4] 앱 번들 빌드 중 (서명 없이)..."
npx tauri build --bundles app --target "$TARGET"

echo "[2/4] Provisioning Profile 삽입..."
cp "$PROFILE" "$APP_PATH/Contents/embedded.provisionprofile"

echo "[3/4] Distribution 인증서로 코드사인 중..."
codesign --force --deep --options runtime \
  --entitlements "$ENTITLEMENTS" \
  --identifier "$BUNDLE_ID" \
  -s "$DIST_IDENTITY" \
  "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"

echo "[4/4] .pkg 패키징 중 (Installer 인증서로 서명)..."
rm -f "$PKG_NAME"
productbuild --component "$APP_PATH" /Applications \
  --sign "$INSTALLER_IDENTITY" \
  --timestamp=none \
  "$PKG_NAME"

echo ""
echo "✅ 완료: $(pwd)/$PKG_NAME"
echo ""
echo "다음 단계: Transporter.app을 열고 이 .pkg 파일을 드래그해서 업로드하세요."
echo "※ App Store Connect에 버전 $VERSION 이 이미 업로드돼 있으면 거부됩니다 — 재시도 전 tauri.conf.json/package.json/Cargo.toml의 버전을 올리세요."
