# Android release signing & CD

Release builds read signing material only from environment variables / CI secrets. No keystore or password is committed or requested in chat.

## 一次性配置

在你自己电脑、仓库根目录运行：

```bash
bash mobile/tools/setup-android-signing.sh
```

脚本会生成/读取 keystore、转 Base64、写入 4 个 GitHub Actions secrets；密码只在本机读取，不落仓库。

GitHub Actions secrets：

| Secret | 值 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | keystore 的 Base64 |
| `ANDROID_KEYSTORE_PASSWORD` | store 密码 |
| `ANDROID_KEY_ALIAS` | 默认 `orbit` |
| `ANDROID_KEY_PASSWORD` | key 密码 |

Workflow 会把 Base64 解码成临时 keystore，并映射为 Gradle 的
`ORBIT_KEYSTORE_FILE` / `ORBIT_KEYSTORE_PASSWORD` / `ORBIT_KEY_ALIAS` / `ORBIT_KEY_PASSWORD`。

**立即离线备份 keystore 和密码。** 更换签名会导致已安装用户无法覆盖升级。

## CD 流程

`main` 推送后：

```text
Release workflow（桌面 Windows/Linux）
  → 创建 vX.Y.Z
  → android-release.yml 的 workflow_run 自动触发
  → 构建签名 APK + AAB
  → 上传 Orbit-Android-X.Y.Z.apk/.aab/.sha256
  → 挂到同一个 GitHub Release
```

不需要手工上传附件。也可以手动补跑：

```bash
gh workflow run android-release.yml --ref main
```

当前已用于 `v1.2.3`（1.2.2 起生效）。

## 本地签名构建

```bash
cd mobile
npx cap sync android
cd android
ORBIT_KEYSTORE_FILE=/abs/path/orbit-release.jks \
ORBIT_KEYSTORE_PASSWORD=... \
ORBIT_KEY_ALIAS=orbit \
ORBIT_KEY_PASSWORD=... \
./gradlew bundleRelease assembleRelease --no-daemon
```

产物：

```text
mobile/android/app/build/outputs/bundle/release/app-release.aab
mobile/android/app/build/outputs/apk/release/app-release.apk
```

没有 secrets 时不会伪造发布包。

## 版本规则

发版前同时更新：

- 根 `package.json` / `mobile/package.json`
- `mobile/android/app/build.gradle` 的 `versionName`
- `versionCode` 每次 **+1**

例如 1.2.3 是 `versionName "1.2.3"`、`versionCode 10203`。版本不递增，Android 不会覆盖安装。

## 覆盖更新

- 同一把 release key + 同一 `applicationId` + 递增 `versionCode` → 可直接覆盖。
- debug → release 签名不同，需要最后卸载一次 debug。
- Play App Signing 与 GitHub 侧载 APK 不要混装；Play 安装版由 Google 的 app signing key 签名。

Do not commit `*.jks`, `*.keystore`, `*.b64`, or `local.properties`.
