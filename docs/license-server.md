# 授权服务部署

授权服务首次启动时会自动生成 Ed25519 私钥、公钥和管理员令牌。私钥只保存在服务器，桌面端发布脚本会自动读取对应公钥。

## 一键启动

```sh
npm run admin:start
```

首次启动只会提示你设置管理员密码。密钥、管理员令牌和数据库会自动保存到 `~/.notechange-license`，后台地址是 `http://127.0.0.1:8787/admin`。请备份该目录；丢失私钥会导致无法签发新许可证。

## 启动服务器

```sh
npm run admin:start
```

将域名反向代理到该端口并启用 HTTPS。管理后台地址是 `https://你的域名/admin`，管理员令牌从 `LICENSE_DATA_DIR/admin-token` 读取。

## 自动构建桌面应用

```sh
export NOTECHANGE_LICENSE_SERVER_URL='https://你的域名'
export NOTECHANGE_UPDATE_URL='https://你的域名'
npm run release:mac
npm run release:win
```

发布脚本自动嵌入公钥，不需要手工复制 PEM。首次激活将许可证绑定到当前应用安装 ID；授权服务不会接收笔记、附件、Cookie 或账号信息。
