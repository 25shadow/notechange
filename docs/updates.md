# Windows 与 macOS 更新发布

构建时设置更新服务器地址：

```sh
export NOTECHANGE_UPDATE_URL='https://downloads.example.com/notechange'
npm run dist:mac
npm run dist:win
```

将构建产物分别上传到更新服务器的同一目录。随后打开授权服务的 `/admin`，在“版本发布”中登记平台、版本号、安装包相对路径、`sha512` 和更新说明。后台会生成客户端读取的更新清单，并支持停用某个平台的更新。

`electron-builder` 会生成：

- macOS：`latest-mac.yml`、ZIP、DMG。
- Windows：`latest.yml`、NSIS 安装程序和 `.blockmap`。

保持历史安装包可下载，并上传安装包和 blockmap 文件。应用内“检查更新”会根据当前平台读取后台生成的正确清单；下载完成后用户点击“重启并安装更新”。

正式发布的 macOS 版本必须使用 Developer ID 签名和公证，Windows 版本建议使用代码签名证书。未签名安装包可能被系统拦截，且更新器无法提供可信的发布者校验。
