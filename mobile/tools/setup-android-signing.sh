#!/usr/bin/env bash
# 一次性配置 Android release 签名：生成/读取 keystore → 写 GitHub Actions secrets。
# 只在你自己的电脑上运行；keystore 和密码不会进仓库。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KS="${ORBIT_KEYSTORE_PATH:-$HOME/orbit-release.jks}"
ALIAS="${ORBIT_KEY_ALIAS:-orbit}"
BASE64_FILE=""

cleanup() { [ -n "$BASE64_FILE" ] && rm -f "$BASE64_FILE"; }
trap cleanup EXIT

command -v keytool >/dev/null || { echo "缺少 keytool；先安装 JDK 21"; exit 1; }
command -v gh >/dev/null || { echo "缺少 GitHub CLI"; exit 1; }
command -v base64 >/dev/null || { echo "缺少 base64"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "先 gh auth login"; exit 1; }

read -rsp "Keystore 密码（至少 6 位）：" PASS; echo
[ "${#PASS}" -ge 6 ] || { echo "密码太短"; exit 1; }

if [ -f "$KS" ]; then
  echo "使用已有 keystore：$KS"
  keytool -list -keystore "$KS" -storepass "$PASS" >/dev/null
  read -rsp "Key 密码（直接回车 = 与 keystore 相同）：" KPASS; echo
  KPASS="${KPASS:-$PASS}"
else
  read -rsp "确认密码：" PASS2; echo
  [ "$PASS" = "$PASS2" ] || { echo "两次密码不一致"; exit 1; }
  echo "生成 keystore：$KS"
  keytool -genkeypair -v \
    -keystore "$KS" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 4096 -validity 10000 -storetype PKCS12 \
    -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=Orbit Ledger, OU=Mobile, O=Orbit, L=Local, ST=Local, C=CN"
  KPASS="$PASS"
fi

BASE64_FILE="$(mktemp)"
if base64 --help 2>&1 | grep -q -- '-w'; then
  base64 -w0 "$KS" > "$BASE64_FILE"
else
  base64 -i "$KS" | tr -d '\n' > "$BASE64_FILE"
fi

cd "$ROOT"
gh secret set ANDROID_KEYSTORE_BASE64 < "$BASE64_FILE"
printf '%s' "$PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS --body "$ALIAS"
printf '%s' "$KPASS" | gh secret set ANDROID_KEY_PASSWORD

echo
echo "✅ GitHub secrets 已写入。"
echo "keystore: $KS"
echo "alias:    $ALIAS"
echo "请立即离线备份 keystore 和密码；丢失后无法给已安装用户升级。"
echo
echo "下一步：gh workflow run android-release.yml --ref develop"
