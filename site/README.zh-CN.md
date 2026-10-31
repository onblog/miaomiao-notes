<div align="center">

<img src="public/assets/icon.png" width="88" alt="喵喵笔记" />

# miaomiao-site

**喵喵笔记** 的官网。喵喵笔记是一款只支持 macOS 的本地 Markdown 笔记应用。

[🇺🇸 English](README.md)

</div>

---

## 这是什么

一个单页营销站 + 四个 JSON 接口，跑在 Cloudflare Workers 上，静态资源走 Static Assets。
能静态的一律静态，托管成本几乎为零。

| 路由 | 处理方 | 作用 |
| --- | --- | --- |
| `/` | 静态资源 | 落地页（默认中文，可切英文） |
| `/api/release` | Worker | 从 R2 读取最新版本清单 |
| `/api/download?arch=arm64\|x64` | Worker | 从 R2 流式返回 dmg，支持 `Range` |
| `/api/ping` | Worker | App 上报一条匿名启动记录（随机 device id + 城市级定位） |
| `/api/stats` | Worker | 聚合的设备数、城市与每日 UV，永不返回 device id |

## 隐私

这个站刻意不接任何第三方：

- 没有统计、没有广告、没有 Cookie、没有外部字体和 CDN
- Worker 会写标准的 Workers 日志（保留 3 天）用于排查问题，但不会把 IP 落进 D1
- 唯一的“状态”是版本清单的 60 秒内存缓存，以及 D1 里的匿名启动计数：
  App 本地生成的随机 device id、UTC 日期，加上 Cloudflare 从请求里推出来的城市级定位
  （不含 IP、不含 UA、不含硬件标识）

## 本地开发

```bash
npm install
npx wrangler dev --port 8799
```

本地会自动绑定一个模拟的 R2 桶。想试下载流程：

```bash
# 写进本地的共用的 `common` 桶，key 带本项目 `miaomiao-notes/` 前缀
npx wrangler r2 object put "common/miaomiao-notes/releases/latest.json" --file=latest.json --local
npx wrangler r2 object put "common/miaomiao-notes/releases/miaomiao-notes-1.2.1-arm64.dmg" --file=路径.dmg --local
```

## 版本清单

R2 里的 `releases/latest.json` 描述当前版本，只提供最新版；发新版本时覆盖清单即可。

```json
{
  "version": "1.2.1",
  "released_at": "2026-10-20",
  "files": {
    "arm64": { "key": "releases/miaomiao-notes-1.2.1-arm64.dmg", "name": "miaomiao-notes-1.2.1-arm64.dmg", "size": 103825402 },
    "x64":   { "key": "releases/miaomiao-notes-1.2.1-x64.dmg",   "name": "miaomiao-notes-1.2.1-x64.dmg",   "size": 111126987 }
  }
}
```

## 部署

```bash
# 改了 Worker 或静态资源
npm run deploy

# 发新版 App（只需上传 dmg 和清单，不用重新部署 Worker）
cd .. && npm run dist
cd site && npm run release
```

`npm run release` 会把 `../release` 里的两个 dmg 传进 `miaomiao` 桶，并重写
`latest.json`，站点和 App 内的更新检查会在清单 60 秒缓存过期后拿到新版本。
上传完成后它会**删掉上一版清单里指向的两个 dmg**，让桶里只保留当前在用的版本；
顺序是刻意安排的：只有新清单已经生效才清理旧包，避免客户端解析到已被删除的文件。
桶用的是共用的 `common` 桶（手动建一次，账号下所有项目都复用它，本项目只写
`miaomiao-notes/` 前缀下的对象），已在 `wrangler.jsonc` 里声明为 `R2_RELEASES` 绑定。

自定义域名 `notes.wordtk.com` 写在 `wrangler.jsonc` 里，首次部署时 wrangler 会自动建 DNS 记录和证书。

D1 用的是**共享的 `common` 库** —— 免费额度只给 10 个数据库，而本站只存启动计数，
所以 sendtk、codetk、miaomiao-bar 与本站共用一个库。表名是 `notes_launches`，索引是
`idx_notes_launches_*`；首次建表（或换 clone）执行：

```bash
npx wrangler d1 migrations apply common --remote   # 本地开发库去掉 --remote
```

因为 `common` 是共用的，`d1_migrations` 是**按文件名记账**的全库共享台账，所以
`migrations/` 里的文件名必须带项目名（现在是 `0001_notes_init.sql`）——
叫 `0001_init.sql` 会和别的项目已记录的迁移重名，被当成「已应用」直接跳过。

## 目录结构

```
src/index.js        Worker：/api/release、/api/download、/api/ping、/api/stats
public/             静态资源，命中时不执行 Worker
  index.html        落地页
  styles.css        单套浅色主题
  app.js            语言切换 + 版本信息
  assets/           图标与截图
migrations/         D1 结构 —— 0001_notes_init.sql 建 notes_launches
wrangler.jsonc      Worker 配置（静态资源、R2 绑定、共享 D1、自定义域名）
```

## 开源协议

AGPL-3.0-only，与应用一致；也提供商业授权。
