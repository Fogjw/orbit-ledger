# Android release signing

Release builds read signing material only from environment variables / CI secrets. No keystore or password is committed or requested in chat.

一次性配置（在你自己电脑、仓库根目录运行）：

```bash
bash mobile/tools/setup-android-signing.sh
```

脚本会生成/读取 keystore、转 Base64、写入 4 个 GitHub Actions secrets；密码只在本机读取，不落仓库。

Required:

- `ORBIT_KEYSTORE_FILE` — path to a keystore file on the runner
- `ORBIT_KEYSTORE_PASSWORD`
- `ORBIT_KEY_ALIAS`
- `ORBIT_KEY_PASSWORD`

The `android-release.yml` workflow builds both AAB and signed APK, decodes `ANDROID_KEYSTORE_BASE64` into a temporary keystore and maps the other secrets. Without all four values, the release build remains unsigned and must not be published.

```bash
# CI
gh workflow run android-release.yml
```

Local release build with a keystore already on disk:

```bash
cd mobile
npx cap sync android
cd android
ORBIT_KEYSTORE_FILE=/abs/path/orbit.jks \
ORBIT_KEYSTORE_PASSWORD=... \
ORBIT_KEY_ALIAS=... \
ORBIT_KEY_PASSWORD=... \
./gradlew bundleRelease --no-daemon
```

产物：`mobile/android/app/build/outputs/bundle/release/app-release.aab` 与 `mobile/android/app/build/outputs/apk/release/app-release.apk`。

Do not commit `*.jks`, `*.keystore`, or `local.properties`.
