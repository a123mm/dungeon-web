# CLAUDE.md — 地牢网页游戏

一个六年级学生做的文字冒险地牢游戏，只在手机上玩。云端用 Cloudflare Pages + D1。
仓库 `a123mm/dungeon-web`，网站 `dungeon-web.pages.dev`。

## 文件结构

- `index.html` — 页面骨架，两屏：登录/注册屏 + 游戏屏。所有 CSS 也在这：颜色类（span.red/gold/purple…）、血条 `.bar`、边框 `.frame`、打击感特效层 `#fx` 和闪屏/飘字动画。
- `game.js` — 游戏全部规则：怪物池、装备/词缀/耐久、天赋三选一、战斗、商店、背包、云端存档调用。页面加载它。
- `functions/api/[[path]].js` — 后端 4 个接口 register / login / save / load，PBKDF2 存密码，令牌隔离（用户之间看不到别人的档）。
- `dungeon-cf/schema.sql` — 建表 SQL（users、saves）。
- `verify.mjs` / `verify-game.mjs` / `balance.mjs` — 本机测试脚本，写在 `.gitignore` 里，不上传。

## 硬规矩（一定照做）

- **绝对没有任何声音**：不许 Web Audio、不许音频文件、不许 `<audio>`。打击感只能用纯视觉（闪屏、飘字、变色）和 `navigator.vibrate`。
- **手机浏览器优先**：小屏、手指点按钮。`█`/`═` 这些符号会掉进中文字体里宽度翻倍，所以边框和血条都用 CSS 画，别改回字符版。
- **纯视觉特效**：伤害飘字、暴击闪金边、挨打闪红边、升级/极品白光，都在 `game.js` 的 `floatDamage()` / `flash()` 里，配 `index.html` 的 `#fx` 层。
- 云端绑定：D1 数据库 `dungeon-saves`，绑定变量名必须叫 `DB`（大写）。

## 已经做好的功能

- 怪物池 11 种，有特长：毒蜘蛛闪避、幽灵无视防御、苦力怕残血自爆、女巫回血、僵尸血厚。
- 变异怪（名字带「狂暴的/变异的…」前缀，属性翻倍、掉好装备）。
- 装备品质 普通/稀有/史诗/传说，同品质属性浮动，接近满值标【★极品】。
- 紫装以上随机词缀（攻击/防御/暴击率/吸血/闪避）。
- 耐久度：武器和护甲每打一场各掉 1 点，0 就损毁。
- 首领第 5/10 层掉紫装、第 15 层起掉金装。
- 背包【丢弃】按钮、装备对比（+2攻击 / -1防御）。
- 天赋三选一（升级时弹出）。

## 改代码的坑

- `game.js` 里颜色码是**六个字符的转义文本**（`[91m` 这种），不是真 ESC 字节。用 Edit 工具改含这些的行会失败，得写一次性 Python 脚本、用 `chr(92)` 拼反斜杠做定点替换。
- 这台手机 `git push` 连不上 github.com（超时），但 api.github.com 通。上线用 `gh api` 的 Contents API 推，推完用 `git hash-object` 比对返回的 sha 确认没推错。
- `balance.mjs` 是「电脑自己玩 N 局」测难度的（`node balance.mjs 100`），它那个 300 秒兜底定时器必须 clearTimeout，不然 node 看起来像卡死。别跑太多局，手机容易发烫。
- 存档是一整段 JSON blob（`JSON.stringify(body.data)`），后端不按字段白名单存，加新字段不用改表；读档用 `Object.assign(newPlayer(), saved)` 给老档补默认值。
- grep 在这台手机上坏了（`-G` 报错），搜代码用 `python3 -c`。

## 常用命令

- `node verify-game.mjs` — 造假网页把游戏跑 1500 步 + 接真后端，40 条检查。
- `node verify.mjs` — 后端 4 接口 32 条检查。
- `node balance.mjs 100` — 测难度（轻量，别跑太多）。
- 上线单个文件：
  `gh api -X PUT /repos/a123mm/dungeon-web/contents/<文件> -f message="..." -f content="$(base64 -w0 <文件>)" -f sha=<旧sha>`
