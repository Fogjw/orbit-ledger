# Android release signing

Release builds read signing material only from environment variables / CI secrets. No keystore or password is committed or requested in chat.

Required:

- `ORBIT_KEYSTORE_FILE` — path to a keystore file on the runner
- `ORBIT_KEYSTORE_PASSWORD`
- `ORBIT_KEY_ALIAS`
- `ORBIT_KEY_PASSWORD`

The `android-release.yml` workflow decodes `ANDROID_KEYSTORE_BASE64` into a temporary keystore and maps the other secrets. Without all four values, the release build remains unsigned and must not be published.

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

产物：`mobile/android/app/build/outputs/bundle/release/app-release.aab`。

Do not commit `*.jks`, `*.keystore`, or `local.properties`.
