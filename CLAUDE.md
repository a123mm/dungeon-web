# CLAUDE.md — 地牢网页游戏

一个六年级学生做的文字冒险地牢游戏，只在手机上玩（Termux / ZeroTermux）。
GitHub 仓库 `a123mm/dungeon-web` → Cloudflare Pages `dungeon-web.pages.dev` + D1 数据库 `dungeon-saves`。
**本目录就是线上网页的源码。** 另外还有一份终端版 `~/dungeon.py`（本地存档，规则已和网页版分叉），两份存档不互通，别混。

## 文件结构

- `index.html` — 页面骨架，两屏：登录/注册屏 + 游戏屏。所有 CSS 也在这：颜色类（span.red/gold/purple…）、血条 `.bar`、边框 `.frame`、打击感特效层 `#fx` 和闪屏/飘字动画、装备发光 `.gear`。
- `game.js` — 游戏全部规则：职业、技能树、怪物池、装备/词缀/耐久、天赋三选一、战斗、商店、背包、云端存档调用。页面加载它。
- `functions/api/[[path]].js` — 后端 4 个接口 register / login / save / load，PBKDF2 存密码，令牌隔离（用户之间看不到别人的档）。
- `dungeon-cf/schema.sql` — 建表 SQL（users、saves）。
- `verify.mjs` / `verify-game.mjs` / `balance.mjs` — 本机测试脚本，写在 `.gitignore` 里、不上传。

## 硬规矩（一定照做）

- **绝对没有任何声音**：不许 Web Audio、不许音频文件、不许 `<audio>`。打击感只能用纯视觉（闪屏、飘字、变色）和 `navigator.vibrate`。这条是用户的死命令，不许破例。
- **手机浏览器优先**：小屏、手指点按钮。`█`/`═` 这些符号会掉进中文字体里宽度翻倍，所以边框和血条都用 CSS 画，别改回字符版。
- **纯视觉特效**：伤害飘字、暴击闪金边、挨打闪红边、升级/极品白光，都在 `game.js` 的 `floatDamage()` / `flash()` 里，配 `index.html` 的 `#fx` 层。
- **装备品质发光**：装备行由 `gearWrap()` 套上 `<span class="gear 品质名">`，CSS 负责发光——紫装常亮（静态 text-shadow）、金装流光（动画）。血条里的流光用 `.bar i::after` 的 transform 动画（不动宽度，手机上省电）。动画都只加在少数元素上，别做成满屏都在动。
- **别跑长测试**：用户只有一台手机、电量常紧张，长时间跑 node 会让手机发烫（他提过"降点温，65 度了"）。改完只跑该跑的短测试，`balance.mjs` 最多 20 局，别跑 40+，更别反复跑。
- 云端绑定：D1 数据库 `dungeon-saves`，绑定变量名必须叫 `DB`（大写）。

## 已经做好的功能

- **职业三选一**（开局）：战士（高血高防，开局带铁剑+皮甲）、刺客（高暴击高闪避，带精灵匕首）、法师（高攻低血，带橡木法杖）。职业决定开局底子、每级涨什么（战士涨血防、法师涨攻击）、以及专属天赋池（每个职业 2 个，别人抽不到）。
  - 老存档没有 `cls` 字段 → 当成「冒险者」，底子成长和改版前一模一样，不会把老档弄坏。
- **技能树**（`SKILL_TIERS`）：三层，每层两个技能二选一（点亮一个，另一个这一局放弃），必须逐层往下点。每升 1 级给 1 点技能点，所以大约 3 级走完。
  - 主动技能（强力打击/二连击/斩杀）有冷却回合数，战斗时变成额外按钮（前缀 ★）；**冷却没好就不摆出来**——摆出来点了要白等一回合，也会让测试脚本卡住。
  - 被动技能（坚韧/吸血光环/战意）点亮那一刻改属性，之后靠存档里的数值生效，不在读档时重算。
  - 和「升级天赋三选一」的分工：**天赋 = 随机抽、白送的被动；技能 = 自己挑、花点数的（含主动）**。两套并存，别合并。
- 怪物池 11 种，有特长：毒蜘蛛闪避、幽灵无视防御、苦力怕残血自爆、女巫回血、僵尸血厚。
  - 池子是**跟着深度滑动的窗口**（`spawn()` 里的 `center`）：深处不会冒出洞穴鼠这种小怪。老写法"越深越杂"会让厚甲职业挨打只掉 1 点、靠休息无限磨。
- 变异怪（名字带「狂暴的/变异的…」前缀，属性翻倍、掉好装备）。
- 装备品质 普通/稀有/史诗/传说，同品质属性浮动，接近满值标【★极品】（彩虹字）。
- 紫装以上随机词缀（攻击/防御/暴击率/吸血/闪避）。
- 耐久度：武器和护甲每打一场各掉 1 点，0 就损毁。
- 首领第 5/10 层掉紫装、第 15 层起掉金装。
- 背包【丢弃】按钮、装备对比（+2攻击 / -1防御）。
- 天赋三选一（升级时弹出）。

## 代码地图（想改哪里看哪）

- **颜色**：`END/RED/GOLD/…` 常量 + `CLASS_OF` 映射 + `toHtml()` 把颜色码转成 `<span>`。`rainbow()` 给单字上彩虹色。
- **画屏**：`show(rows, color)`；`rows` 里放 `SEP` 画一条横线。
- **等按钮**：`ask(choices)` 返回被点的 key。**所有"输入"都走它**，它是 Python `input()` 的替身（Promise 撑住同步写法）。注销靠 `QuitGame` 异常穿透。
- **主循环**：`play()`；开局先 `await chooseClass()`，然后内层 while 走 前进/背包/休息/商店/存档…。
- **战斗**：`fight()` 是回合循环；玩家出手 `playerStrike()`（含重击）和 `useSkill()`，怪物出手 `monsterStrike()`。数值统一走 `damageOf(attack, defense)`。
- **装备**：`randomItem()` 造、`itemRows()`/`gearWrap()` 显示、`compareTag()` 对比、`wearGear()` 每场磨耐久、`durabilityOf()` 给老档补耐久字段。
- **职业**：`CLASSES` / `PLAYABLE` / `classOf(p)` / `starterGear(cls)`。
- **技能**：`SKILL_TIERS`（三层二选一）/ `SKILL_BY_KEY` / `hasSkill()` / `openSkills()` / `skillChoices()` / `useSkill()`；点数存在 `player.points`。
- **存档**：`playerToSave()` 按 `SAVE_FIELDS` 挑字段 → `saveToCloud()` / `loadFromCloud()`（读档用 `Object.assign(newPlayer(), saved)` 兜老档）。

## 存档字段（加玩家属性必须同步这里）

`SAVE_FIELDS` = level, max_hp, hp, atk, defense, gold, xp, kills, depth, weapon, armor, bag, crit, lifesteal, dodge, talents, cls, skills, points

- **漏加进去 → 这个属性存不上，一读档就丢。** 加了新字段记得也在这里添一笔。
- 后端存的是**一整段 JSON blob**（`JSON.stringify(body.data)`），不做字段白名单，所以加字段**不用改数据库表**。
- 装备上的字段（`durability`/`max_durability`/`perfect`/`affixes`）跟着 blob 一起走，老档缺了由 `durabilityOf()` 之类就地补默认，不会坏档。

## 改代码的坑

- `game.js` 里颜色码是**六个字符的转义文本**（`[91m` 这种），不是真 ESC 字节。用 Edit 工具改含这些的行会失败，得写一次性 Python 脚本、用 `chr(92)` 拼反斜杠做定点替换。
- 这台手机 `git push` 连不上 github.com（超时），但 api.github.com 通。**上线只用 `gh api` 的 Contents API 推**，推完用 `git hash-object <文件>` 比对返回的 `.content.sha` 确认没推错。本地 git 仓库是旧的，别指望它。
  - 别用 `git add .` 一把梭：本地一堆没同步的改动会被卷进去。
  - 改了几个文件就推几个（game.js、index.html 各推一次）。
- `verify-game.mjs` 会**随机点按钮**把游戏跑 1500 步。所以新增的屏幕必须保证"总能点得动、不会卡死"，否则测试会超时。它还会检查画面里不出现 `undefined`/`NaN`。
- `balance.mjs` 是「电脑自己玩 N 局」测难度的（`node balance.mjs 100`）。
  - 它那个 300 秒兜底定时器**必须 clearTimeout**，不然 node 看起来像卡死。
  - 第三个参数写职业名就只跑那个职业：`node balance.mjs 20 刺客`（不写就每局随机）。**20 局就够，40 局很可能 200 秒跑不完还会烫手。**
  - 它按按钮是"看标签认屏幕"的，**新增屏幕要在 `pick()` 里加一条分支**，否则会掉进最后那个 `pending[0]` 兜底、永远选第一个。
  - 结局那一行现在前面带职业名，所以判定要用 `includes("倒在 第 ")`，不能用 `startsWith`。
- grep 在这台手机上坏了（`-G` 报错），搜代码用 `python3 -c`。

## 常用命令

- `node verify-game.mjs` — 造假网页把游戏跑 1500 步 + 接真后端，40 条检查。
- `node verify.mjs` — 后端 4 接口 32 条检查。
- `node balance.mjs 20` — 测难度（20 局，别更多，别反复跑）。
- 上线单个文件：
  `gh api -X PUT /repos/a123mm/dungeon-web/contents/<文件> -f message="..." -f content="$(base64 -w0 <文件>)" -f sha=<旧sha>`
  （旧 sha 用 `gh api /repos/a123mm/dungeon-web/contents/<文件> --jq '.sha'` 取。）
