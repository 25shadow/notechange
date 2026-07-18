# 授权服务部署

授权服务是独立的 Node 进程。桌面应用只保存公钥和已签名的许可证，私钥与管理员令牌只能留在服务器。

## 初始化密钥

在项目目录执行：

```sh
npm run license:keys
```

保存输出的两项：

- `LICENSE_PRIVATE_KEY_PEM`：仅配置到服务器。
- `NOTECHANGE_LICENSE_PUBLIC_KEY`：配置到桌面应用的构建环境。

密钥生成一次后长期使用。丢失私钥会导致无法签发新许可证。

## 启动服务器

服务器环境变量：

```sh
export LICENSE_ADMIN_TOKEN='替换为高强度管理员令牌'
export LICENSE_PRIVATE_KEY_PEM='生成的私钥 PEM，保留换行或使用 \\n'
export LICENSE_PORT=8787
export LICENSE_DATA_DIR='/var/lib/notechange-license'
npm run license-server
```

将域名反向代理到该端口并启用 HTTPS。管理后台地址为 `https://你的域名/admin`。浏览器首次打开时输入 `LICENSE_ADMIN_TOKEN`，可批量生成最多 500 个永久激活码、查看状态、解绑设备和禁用激活码。

## 构建桌面应用

在构建桌面端时注入以下环境变量：

```sh
export NOTECHANGE_LICENSE_SERVER_URL='https://你的域名'
export NOTECHANGE_LICENSE_PUBLIC_KEY='生成的公钥 PEM，保留换行或使用 \\n'
npm run build
```

首次激活会将许可证绑定到当前应用安装 ID。许可证使用 Ed25519 签名，本地可持续使用；用户在应用内可解绑当前设备，再在新设备上激活。桌面端不会向授权服务上传笔记、附件、Cookie 或账号信息。
