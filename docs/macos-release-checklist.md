# macOS 发布检查清单

当前项目可以构建本机可验证的 arm64 `.app`、DMG 和 ZIP，但产物在没有 Apple Developer 发布凭据时是未签名的开发构建。

## 发布前必须由产品所有者提供

1. 最终应用名称、`appId`（替换当前 `com.example.narwhalforge` 开发占位符）和开发者/公司名称。
2. Apple Developer Program Team ID。
3. `Developer ID Application` 证书及其私钥，安装在构建机钥匙串。
4. 用于 notarization 的 App Store Connect API key，或专用 Apple ID app password。
5. 更新发布渠道和 HTTPS 下载域名；自动更新功能启用前还需签名的更新元数据。
6. 正式 `.icns` 图标和用户可见的隐私、许可与第三方 notices 文案。

## 构建验证

```sh
pnpm typecheck
pnpm build
pnpm stage:runtime
pnpm package:mac
```

随后必须在一台未安装开发依赖的 macOS arm64 测试机上验证：首次启动、Host 失败恢复、关闭应用后 Host 清理、Gatekeeper、安装覆盖升级与诊断导出。

此外验证 Narwhal 自有的 Agent 界面：选择可信工作区、新建或打开会话、加载历史、发送一条安全提示、在 Work / Activity 之间切换、取消进行中的回合，以及任务待办、Git 只读状态和交付物 Finder 定位。发布包不应出现上游产品的网页、标识或会话导航；运行时仅可通过主进程的固定回环 BFF 使用。

## 签名与公证门槛

- 使用 `Developer ID Application` 对 `.app` 内所有可执行文件和原生模块进行 hardened-runtime 签名。
- 对 DMG/ZIP 做 notarization 并在发布前执行 stapling。
- 使用 `codesign --verify --deep --strict` 与 `spctl --assess --type execute --verbose` 验证最终 `.app`。
- 不要把当前 `com.example.narwhalforge`、默认 Electron 图标或未签名产物作为公开发布身份。
