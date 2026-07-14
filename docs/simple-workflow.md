# 最小可用流程

## 1. 导出小米笔记

1. 打开并登录 `https://i.mi.com/note/h5#/`。
2. 在该页面运行 `scripts/browser/xiaomi-export.js`。
3. 浏览器下载 `xiaomi-notes-YYYY-MM-DD.json`。

脚本只使用契约中已经网络验证的 `listNotes` 和 `getNote`，不读取或保存 Cookie、`serviceToken`。

导出文件包含笔记标题、正文、时间、文件夹 ID 和图片元数据。它本身包含个人笔记内容，应保存在本机，不要上传到第三方服务。

## 2. 导入 vivo

1. 打开并登录 `https://pc.vivo.com.cn/suite?origin=cloudWeb#/note`。
2. 在该页面运行 `scripts/browser/vivo-import.js`。
3. 选择第一步导出的 JSON，核对数量后确认。
4. 脚本通过 vivo 官方页面的请求模块批量调用 `createSync`，完成后下载普通 JSON 报告。

`createSync`、读取回验和测试笔记删除已于 2026-07-14 使用无敏感合成笔记完成网络验证。当前脚本导入标题和正文；加密笔记与图片附件会明确计入跳过数量。

桌面应用只负责打开登录页、运行这两段同源脚本和展示计数；核心数据操作不依赖逐条点击网页，也不使用本地加密。
