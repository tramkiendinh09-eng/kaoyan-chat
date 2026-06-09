# 部署到新服务器

## 1. 安装系统依赖

需要 Node.js 22 或更新版本。PDF 若想使用 TeX 排版，还需要 Pandoc、XeLaTeX 和中文字体。

Debian/Ubuntu 示例：

```bash
apt update
apt install -y curl git pandoc texlive-xetex texlive-lang-chinese fonts-noto-cjk lmodern texlive-fonts-recommended
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

## 2. 拉取项目

```bash
git clone <your-github-repo-url> /opt/kaoyan-chat
cd /opt/kaoyan-chat
npm ci --omit=dev
cp .env.example .env
```

编辑 `.env`，至少改掉：

```bash
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=一段足够长的随机字符串
DATA_DIR=/opt/kaoyan-chat/data
```

如果你要导入旧的 `/root/kaoyan` 知识库，设置：

```bash
KAOYAN_ROOT=/root/kaoyan
```

## 3. 启动测试

```bash
npm run check
npm start
```

默认监听 `127.0.0.1:18080`，访问路径是 `/chat/`。

## 4. systemd 常驻运行

复制模板：

```bash
cp deploy/kaoyan-chat.service /etc/systemd/system/kaoyan-chat.service
systemctl daemon-reload
systemctl enable --now kaoyan-chat
systemctl status kaoyan-chat --no-pager -l
```

## 5. Nginx 反代示例

```nginx
location /chat/ {
    proxy_pass http://127.0.0.1:18080/chat/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 180s;
}
```

## 6. 数据迁移

GitHub 仓库不会包含生产数据。需要迁移旧服务器数据时，单独复制：

```bash
rsync -av /root/kaoyan-chat/data/ root@new-server:/opt/kaoyan-chat/data/
rsync -av /root/kaoyan-chat/uploads/ root@new-server:/opt/kaoyan-chat/uploads/
```

`.env` 也不要上传到 GitHub，手动在新服务器创建。

