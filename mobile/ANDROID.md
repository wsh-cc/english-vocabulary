# 词间 Android 构建与交付

应用标识 `com.wordweave.offline`，版本 `0.1.3`（versionCode 4），最低 Android 10 / API 29，编译与目标 API 36。HTML、字体、词库和阅读材料随 APK 打包。

本版内置内容版本为 `wordweave-2026-10-v2`：新增 300 个常用四级义项与 600 条双语例句；四级 89 → 389 个义项，全库 2163 → 2463 个义项；新增 10 篇四级阅读，四级阅读 3 → 13 篇，全库阅读 61 → 71 篇。重复拼写仅用于不同词义。

## 本机构建

需要 Node.js 22 及以上、JDK 21、Android SDK platform 36 和 build-tools 36.0.0。Gradle Wrapper 固定 8.14.3，下载文件校验 SHA-256；工程不替换系统 Java。当前机器 SDK 位于 `F:\项目\android-sdk`。

```powershell
cd D:\CODE\english-vocabulary\mobile
npm.cmd ci
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/provision-jdk.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -GradleCache D:\CODE\ww-gradle
```

已有 JDK 21 可给构建脚本传 `-JdkRoot`，SDK 可传 `-SdkRoot`。Windows 建议用 `-GradleCache` 指向专用短路径：当前已用 `D:\CODE\ww-gradle` 验证解决过长缓存路径造成的 transform 目录重命名失败，原缓存保留。默认缓存为 `.tools/gh`。网络依赖缓存完整后可传 `-Offline`；只重打包已验证页面可传 `-SkipWebBuild`。构建会进行 web 构建、Capacitor 资源复制、原生单元测试、release lint、release APK 和 instrumentation 测试 APK 编译，再对 release APK 对齐、签名、验签与计算校验值。

输出为 `release/wordweave-0.1.3.apk` 与 `release/wordweave-0.1.3.apk.sha256`。下载和 Gradle 缓存位于忽略目录 `.tools/`。不要把生成的 Android assets 文件作为手工修改入口。

## 签名与升级

首次构建生成 `.private/wordweave-release.jks` 和 `.private/signing.json`，后续沿用；两个文件必须一起妥善备份，不能提交 Git 或分享给别人。`signing.json` 包含构建所需的私有密码；脚本只通过临时进程环境交给签名工具，不输出密码。密钥丢失后无法制作可直接覆盖安装的同签名版本。新版本递增 versionCode，并更新版本名与脚本输出文件名。

APK 安装时按 Android 系统提示允许当前来源安装。升级直接安装同包名同签名 APK，学习数据库保留；卸载会清除本地数据库，卸载前需完成同步或导出备份。

网站与应用使用同一份 v2 内容。旧版应用内置 v1 词库，需覆盖安装 0.1.3 后才能下载、同步新版完整内容；已有学习记录、联想与待同步动作沿用，旧版阅读完成记录仍兼容。不要先卸载。

## 原生能力和数据保护

- `WordweaveNative` 使用 SQLite 将整个账号状态、待同步动作与恢复副本作为同一事务持久化，修订号不匹配拒绝覆盖。损坏数据库或无效 JSON 返回错误，不删除或自动重建学习档案。
- 登录 Bearer 凭据独立存于 Android Keystore AES-GCM 加密的私有设置，不进入备份。云备份和系统设备迁移都排除应用私有数据；学习数据通过应用内备份或账号同步迁移。
- HTTPS 请求只允许固定站点的 `/api/mobile/` 路径，拒绝 HTTP、其他主机、嵌入凭据、路径绕过，禁止自动跟随重定向。连接 15 秒、读取 30 秒超时，读写请求上限 4 MB。
- 文件选择和保存使用 Android Storage Access Framework，无整个存储空间权限。导入文件限制 4 MB UTF-8 JSON；完整本机导出可达 32 MB，超过网站 4 MB 限额时由界面提示兼容范围。取消不会修改记录。
- 语音仅选择已安装的离线英文 Voice，缺少资源可打开系统语音设置；进入后台停止朗读。

## 原生验证

`testDebugUnitTest` 检查固定同步地址策略，以及真实 JSON → JSObject → PluginCall 的修订号解析。`StateStoreInstrumentedTest` 检查序列化请求首次写入、第二次写入、旧修订拒绝、恢复副本、重开数据库、无效 JSON 不覆盖以及 Keystore 凭据往返。连接测试手机或模拟器后在 android 目录执行 `gradlew.bat connectedDebugAndroidTest`。

真实设备需进一步验证首次联网登录、下载后飞行模式冷启动、杀进程后恢复、系统文件选择取消、英文离线 TTS、安全区、输入法、返回手势和同签名覆盖安装保留记录。没有执行设备测试前，不能声称这些验收项目已经通过。

2026-10-14 的 0.1.1 保存修复先复现首次与第二次保存的 2 项失败，再通过全部 10 项原生单元测试。5 项设备测试已编译；设备测试使用独立测试数据库、偏好与 Keystore alias，避免清理真实学习档案。当前没有连接 Android 设备，因此尚未执行 instrumentation、安装与覆盖升级验证。0.1.2 APK v3 签名验证通过，沿用证书 SHA-256 `d9c8dd44358badb5cae65c4cd83a46e284d88e019c7914ec5ec8aa755c036a6a`，最终 APK 校验值以旁边 `.sha256` 文件为准。资源一致性与测试统计保存在 `release/wordweave-0.1.2-verification.json`。

2026-10-16 的 0.1.3 已通过 36 项手机端回归、10 项原生单元测试、TypeScript、生产页面构建、release lint（0 错误，17 项模板资源和版本提示）及 5 项设备测试的 APK 编译。新 APK 的包名、versionCode 4、版本名 0.1.3、API 29/36、ZIP 对齐与原证书 v3 签名均验证通过；包内 5 个页面资源与最终 dist 哈希一致，全部 300 个新增义项、71 篇阅读 ID 及 v2 内容标记均已打入页面。未连接 Android 设备，安装、覆盖升级和设备测试尚未执行。完整记录见 `release/wordweave-0.1.3-verification.json`，校验值见 `release/wordweave-0.1.3.apk.sha256`。
