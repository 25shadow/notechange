# 授权服务部署

授权服务首次启动时会自动生成 Ed25519 私钥和公钥。私钥只保存在服务器，桌面端发布脚本会自动读取对应公钥。

## 一键启动

```sh
npm run admin:start
```

首次启动不需要终端交互。打开 `http://127.0.0.1:8787/admin` 后，在初始化页面输入管理员密码并保存，即会自动进入后台。密码不设长度限制，但不能为空；它只会以加盐哈希形式保存。密钥、管理员密码哈希和数据库会自动保存到 `~/.notechange-license`。请备份该目录；丢失私钥会导致无法签发新许可证。

## 启动服务器

```sh
npm run admin:start
```

将域名反向代理到该端口并启用 HTTPS。管理后台地址是 `https://你的域名/admin`。首次进入该地址会显示初始化页面；之后使用设置的管理员密码登录。请勿将 `8787` 端口直接暴露到公网。

## 后台更新

管理后台的“检查更新”和“立即更新”会从 GitHub 的 `main` 分支拉取代码并执行 `npm ci`。拉取到新版本后，服务会主动退出，宝塔 Node 项目的守护进程会自动启动新版本；请保持宝塔项目处于正常的托管运行状态。

## 在后台发布桌面版本

进入管理后台的“版本发布”，按页面的三个步骤操作：

1. 选择 Windows 或 macOS，并上传该平台的安装包。
2. 服务端自动保存文件并计算 SHA-512；填写版本号（例如 `1.2.0`）和更新说明。
3. 点击“确认发布”。客户端会从 `latest.yml`（Windows）或 `latest-mac.yml`（macOS）获取新版本和下载文件。

无需手工上传文件、填写文件相对路径或计算 SHA-512。安装包保存在 `LICENSE_DATA_DIR/releases`；“系统设置”会展示该目录、签名密钥、管理员密码哈希和授权数据库的实际文件路径与状态，但不会显示任何密钥、密码或哈希内容。

## 自动构建桌面应用

构建包必须内置与已部署授权服务对应的公钥。不要复制服务器私钥。

在部署服务器导出公钥文件：

```sh
cd /www/wwwroot/node/notechange
npm run license:public-key > notechange-license-public.pem
```

将 `notechange-license-public.pem` 放到打包电脑。macOS 包应在 macOS 上构建，Windows 包建议在 Windows 上构建：

```sh
export NOTECHANGE_LICENSE_SERVER_URL='https://你的域名'
export NOTECHANGE_UPDATE_URL='https://你的域名'
export NOTECHANGE_LICENSE_PUBLIC_KEY="$(cat notechange-license-public.pem)"
npm run release:mac
npm run release:win
```

构建产物在 `release/` 目录。上传生成的安装包到后台“版本发布”即可发布更新。首次激活将许可证绑定到当前应用安装 ID；授权服务不会接收笔记、附件、Cookie 或账号信息。
