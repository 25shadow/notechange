# 小米与 vivo 浏览器会话复用设计

## 目标

小米和 vivo 各自使用固定的 Chromium profile。用户完成一次登录后，应用重启或浏览器上下文重建时优先在无头模式恢复登录态；只有厂商会话失效时才重新显示登录窗口。

本功能不保存账号密码、不导出 Cookie 到应用自定义文件，也不增加本地加密层。Cookie、localStorage 和站点数据库均由 Chromium 原生 profile 管理。

## 目录与隔离

Electron 主进程在 `app.getPath('userData')` 下创建 `browser-profiles` 根目录，并为两个厂商使用稳定且隔离的子目录：

- `browser-profiles/xiaomi`
- `browser-profiles/vivo`

厂商标识只允许映射为安全目录名。关闭单个上下文或退出应用时只关闭 Chromium，不删除 profile。小米和 vivo 不能共享 profile，避免 Cookie、缓存和站点权限相互影响。

## 会话生命周期

### 首次连接或登录态失效

1. 使用对应固定 profile 启动 headless 上下文并进入厂商笔记页。
2. 调用现有 provider 登录检测接口进行一次快速验证。
3. 未登录时关闭 headless 上下文，使用同一 profile 启动可见上下文。
4. 按现有轮询逻辑等待用户完成登录。
5. 登录成功后读取当前上下文 Cookie，关闭可见上下文，并使用同一 profile 重启 headless 上下文。
6. 在内存中恢复刚读取的 Cookie，并再次验证登录态。

### 已有有效会话

1. 使用固定 profile 启动 headless 上下文。
2. 登录检测成功后直接返回“已连接”，不创建可见窗口，也不要求用户再次操作。

### 应用退出

应用退出时关闭所有浏览器上下文并释放 profile 文件锁，但保留 profile 目录。下次启动仍执行“headless 快速验证”，不根据文件是否存在直接假定已登录。

## 组件改动

### SessionManager

- 将临时随机目录改为根目录下的稳定厂商目录。
- `open` 支持明确选择 headed 或 headless 启动模式。
- 增加从 headless 切换到 headed 的能力，并继续复用同一 profile。
- `switchToHeadless` 保持现有内存 Cookie 迁移，处理 Chromium 尚未完成落盘的情况。
- `dispose` 和 `disposeAll` 只关闭上下文，不删除 profile。
- 启动失败时关闭已创建的上下文并释放锁，但不清除历史 profile。

### MigrationRuntime

- `startLogin` 在没有活动页面时先 headless 打开固定 profile。
- 首次检测已登录时直接返回，不显示登录窗口。
- 首次检测未登录时切换为 headed，继续使用现有最长五分钟登录轮询。
- 登录成功后切回 headless 并再次检测，沿用现有 `LOGIN_TIMEOUT` 和 `LOGIN_SESSION_LOST` 错误语义。

### Electron 启动配置

- 创建 `SessionManager` 时传入 `app.getPath('userData')/browser-profiles`。
- 不在渲染进程暴露 profile 路径或 Cookie 内容。

## 错误处理

- profile 被当前应用遗留进程锁定时，连接操作返回明确启动错误，不创建新的随机 profile 绕过锁。
- 厂商会话过期视为未登录，回退到可见登录窗口。
- 可见登录超时返回 `LOGIN_TIMEOUT:<provider>`，保留 profile 供下次继续尝试。
- 登录后切回 headless 仍未认证时返回 `LOGIN_SESSION_LOST:<provider>`，不误报已连接。
- 退出和失败清理不得删除用户已有会话数据。

## 测试

- 单元测试验证同一厂商跨 `open`/`dispose` 使用同一个稳定目录。
- 单元测试验证小米与 vivo 使用不同目录。
- 单元测试验证 `disposeAll` 不删除 profile。
- Runtime 测试验证有效 profile 只启动 headless，不打开可见窗口。
- Runtime 测试验证失效 profile 从 headless 回退到 headed，登录后再切回 headless。
- 现有真实 Chromium 集成测试继续验证 HttpOnly Cookie 在 headed/headless 切换后可用。
- 完整运行测试、TypeScript 检查、契约校验和 Electron 生产构建。

## 非目标

- 不实现多账号 profile 切换。
- 不提供导出、查看或编辑 Cookie 的功能。
- 不自动填写账号密码或绕过短信、二维码及二次验证。
- 不增加“清除登录数据”界面；需要时可作为独立功能设计。
