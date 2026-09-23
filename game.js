// ============================================================================
// 地牢 —— 网页版。是从 ~/dungeon.py 一行一行搬过来的，规则完全一样。
//
// 只改了三件事：
//   1. 终端里的颜色码（\033[91m 这种）浏览器不认 —— 最后统一转成 <span class="red">
//   2. Python 的 input() 等键盘 → 改成等按钮被点（用 Promise）
//   3. 存档从手机本地文件 → 改成存在云上（/api/save、/api/load）
//
// 所以下面的函数名和 Python 那份是一一对应的，想对照着改很容易。
// 只有"难度数字"后来单独调过一次（2026-09-20，玩家说太难），跟 Python 那份不再相同。
// 2026-09-23 又加了：怪物池扩充、变异怪、装备耐久度/极品/金装，Python 那份没有这些。
// ============================================================================


// ===== 一、颜色（和 Python 里那套 ANSI 码一模一样）=====
const END = "\u001b[0m", BOLD = "\u001b[1m", DIM = "\u001b[2m";
const RED = "\u001b[91m", GREEN = "\u001b[92m", GOLD = "\u001b[93m", BLUE = "\u001b[94m";
const PURPLE = "\u001b[95m", CYAN = "\u001b[96m", GREY = "\u001b[90m";
const WHITE = "\u001b[97m";   // 亮白，给「普通」品质的装备用

const BAG_LIMIT = 12;      // 背包上限
const SAVE_SLOTS = 3;      // 存档槽位数
const SEP = {};            // 行列表里放一个 SEP，就画一条横线

let SPEED = 1;             // 节奏倍率，点「快进」会变成 0.15

const sleep = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000 * SPEED));
const pause = sleep;


// ===== 二、画图 =====
//
// Python 版是在终端里"数格子"对齐的（中文占 2 格、英文占 1 格，再补空格）。
// 浏览器里不能这么干：手机上 █ 和 ═ 这些符号会掉进中文字体里、宽度翻倍，框子立刻歪掉。
// 所以这里把边框交给 CSS 的 border、血条交给 CSS 的百分比宽度，什么字体都不会错位。

/**
 * 血量条。用 CSS 画的：外面一个浅色空槽，里面一条按百分比上色的实心条。
 * 宽度写 20ch —— ch 是"一个数字的宽度"，在等宽字体里就是 20 个字符宽，
 * 看起来和原来 [████████░░░░] 一样，但不怕字体问题。
 */
function bar(current, top, width = 20, color = RED) {
  const percent = top <= 0 ? 0 : Math.max(0, Math.min(100, Math.round(current / top * 100)));
  return '<span class="bar ' + classNameOf(color) + '" style="width:' + width + 'ch">' +
         '<i style="width:' + percent + '%"></i></span> ' +
         String(percent).padStart(3) + "%";
}

// 颜色码 → CSS 类名。null 表示"重置颜色"。
/** 拿到颜色码对应的类名；万一是空值就用默认的绿色。 */
function classNameOf(color) {
  return CLASS_OF[color] || "green";
}

const CLASS_OF = {
  "\u001b[0m": null, "\u001b[1m": "bold", "\u001b[2m": "dim",
  "\u001b[91m": "red", "\u001b[92m": "green", "\u001b[93m": "gold", "\u001b[94m": "blue",
  "\u001b[95m": "purple", "\u001b[96m": "cyan", "\u001b[90m": "grey", "\u001b[97m": "white",
};

/**
 * 把带颜色码的文本转成 HTML。
 * 用一个"栈"记住当前开着哪些标签，遇到重置码就把开着的全部关掉——
 * 这样 {BOLD}{RED}文字{END} 也能正确闭合。
 */
function toHtml(text) {
  let out = "";
  const open = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\u001b") {
      const stop = text.indexOf("m", i);
      const code = stop < 0 ? text.slice(i) : text.slice(i, stop + 1);
      i = stop < 0 ? text.length : stop + 1;
      const cls = CLASS_OF[code];
      if (!cls) {
        while (open.length) { out += "</span>"; open.pop(); }
      } else {
        out += '<span class="' + cls + '">';
        open.push(cls);
      }
      continue;
    }
    out += text[i];
    i += 1;
  }
  while (open.length) { out += "</span>"; open.pop(); }
  return out;
}


// ===== 三、数据 =====
const WEAPONS = [["铁剑", 3], ["精灵匕首", 5], ["秘银战斧", 8], ["龙牙巨剑", 12]];
const ARMORS = [["皮甲", 2], ["锁子甲", 4], ["秘银胸甲", 7]];
const POTIONS = [["回血药水", 25], ["大回血药水", 60]];
// 怪物池。名字, 生命, 攻击, 战利品基数；后面几个是"特长"（没写就是普通怪）：
//   dodge  闪避率，打它有这么多概率挥空
//   pierce 无视防御，你的护甲对它没用
//   boom   残血自爆，血掉到三成以下就抱着你一起炸
//   regen  每回合自己回血（比例是最大生命的几分之几）
// 表里的顺序 = 解锁顺序：越靠后越强，只有下得更深才会碰见。
const MONSTERS = [
  { name: "洞穴鼠",   hp: 10, atk: 4,  reward: 6 },
  { name: "毒蜘蛛",   hp: 12, atk: 5,  reward: 8,  dodge: 0.35 },
  { name: "史莱姆",   hp: 16, atk: 5,  reward: 9 },
  { name: "骷髅兵",   hp: 22, atk: 7,  reward: 13 },
  { name: "幽灵",     hp: 18, atk: 8,  reward: 14, pierce: true },
  { name: "苦力怕",   hp: 26, atk: 8,  reward: 20, boom: true },
  { name: "女巫",     hp: 24, atk: 7,  reward: 20, regen: 0.12 },
  { name: "僵尸",     hp: 40, atk: 10, reward: 18 },
  { name: "石像鬼",   hp: 34, atk: 11, reward: 22 },
  { name: "暗影狼",   hp: 42, atk: 13, reward: 26 },
  { name: "地牢领主", hp: 62, atk: 17, reward: 40 },
];

// ===== 稀有度（装备的颜色）=====
// 普通=白、稀有=蓝、史诗=紫、传说=金。越稀有：基础数值越高、词条越多、也越耐用。
//   affixes    = 词条条数的范围 [最少, 最多]
//   durability = 这件装备能撑几场战斗
// 「传说」（金装）只有第 15 层往下的首领才掉，平时摇不出来。
const RARITIES = {
  common:    { name: "普通", color: "\u001b[97m",  mult: 1.0, affixes: [0, 0], durability: 8 },
  rare:      { name: "稀有", color: "\u001b[94m",   mult: 1.4, affixes: [1, 1], durability: 12 },
  epic:      { name: "史诗", color: "\u001b[95m", mult: 1.8, affixes: [1, 2], durability: 18 },
  legendary: { name: "传说", color: "\u001b[93m",   mult: 2.2, affixes: [2, 3], durability: 26 },
};

// 同一档品质里也分好坏：基础值在这个范围里摇。
// 摇到离上限只差一点点，就算「极品」，列表里会标个星。
const ROLL_MIN = 0.8, ROLL_MAX = 1.25, ROLL_PERFECT = 0.03;

// ===== 词条 =====
// 装备上除"基础值"以外的额外属性。roll() 是这条词条能摇出多少，unit 是显示时加不加 %。
const AFFIXES = {
  atk:   { name: "攻击",   unit: "",  roll: () => 1 + Math.floor(Math.random() * 3) },
  def:   { name: "防御",   unit: "",  roll: () => 1 + Math.floor(Math.random() * 2) },
  crit:  { name: "暴击率", unit: "%", roll: () => 5 + Math.floor(Math.random() * 11) },
  steal: { name: "吸血",   unit: "%", roll: () => 3 + Math.floor(Math.random() * 8) },
  dodge: { name: "闪避",   unit: "%", roll: () => 3 + Math.floor(Math.random() * 6) },
};
const AFFIX_KEYS = Object.keys(AFFIXES);

/** 一条词条写成文字，例：暴击率 +12% */
function affixText(affix) {
  const info = AFFIXES[affix.key];
  return info.name + " +" + affix.value + info.unit;
}

// ===== 天赋（升级时三选一）=====
// run 就是"选了以后马上生效"的那点改动；key 记进存档，好在状态栏里列出来。
const TALENTS = [
  { key: "hp",    name: "体魄", text: "生命上限 +15",        run: (p) => { p.max_hp += 15; p.hp = Math.min(p.max_hp, p.hp + 15); } },
  { key: "atk",   name: "力量", text: "攻击 +3",            run: (p) => { p.atk += 3; } },
  { key: "def",   name: "铁壁", text: "防御 +2",            run: (p) => { p.defense += 2; } },
  { key: "crit",  name: "致命", text: "暴击率 +15%",        run: (p) => { p.crit += 0.15; } },
  { key: "steal", name: "吸血", text: "攻击时吸回 10% 伤害", run: (p) => { p.lifesteal += 0.10; } },
  { key: "dodge", name: "身法", text: "闪避 +10%",          run: (p) => { p.dodge += 0.10; } },
];
const TALENT_NAME = {};
for (const talent of TALENTS) TALENT_NAME[talent.key] = talent.name;

const SAVE_FIELDS = ["level", "max_hp", "hp", "atk", "defense",
                     "gold", "xp", "kills", "depth", "weapon", "armor", "bag",
                     "crit", "lifesteal", "dodge", "talents"];

function newPlayer() {
  // crit/lifesteal/dodge 都是百分比（0.15 就是 15%）；talents 记着这一局选过哪些天赋
  return { level: 1, max_hp: 50, hp: 50, atk: 6, defense: 2, crit: 0.15,
           lifesteal: 0, dodge: 0, talents: [],
           gold: 0, xp: 0, kills: 0, depth: 1, weapon: null, armor: null, bag: [] };
}

/** 武器和护甲上同一种词条加起来有多少。（老存档的装备没有 affixes，跳过就行） */
function gearBonus(player, key) {
  let total = 0;
  for (const item of [player.weapon, player.armor]) {
    if (!item || !item.affixes) continue;
    for (const affix of item.affixes) if (affix.key === key) total += affix.value;
  }
  return total;
}

const attackOf = (p) => p.atk + (p.weapon ? p.weapon.value : 0) + gearBonus(p, "atk");
const guardOf = (p) => p.defense + (p.armor ? p.armor.value : 0) + gearBonus(p, "def");
// 暴击、吸血、闪避：天赋加的 + 装备词条加的（词条存的是整数，例如 12 表示 12%）
const critOf = (p) => p.crit + gearBonus(p, "crit") / 100;
const stealOf = (p) => p.lifesteal + gearBonus(p, "steal") / 100;
const dodgeOf = (p) => p.dodge + gearBonus(p, "dodge") / 100;
const xpNeeded = (level) => level * 20;
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

function add(log, text) {
  log.push(text);
  if (log.length > 8) log.splice(0, log.length - 8);
}


// ===== 四、界面骨架 =====
const board = document.getElementById("board");
const buttonsEl = document.getElementById("buttons");

/**
 * 把一行行的内容画到屏幕上。
 * rows 里每一项是一行文字（可以带颜色码），放 SEP 就画一条横线。
 * 框子的颜色由 color 决定（传 RED / GREEN / GOLD / PURPLE / CYAN 这些）。
 */
function show(rows, color = CYAN) {
  let html = '<div class="frame ' + classNameOf(color) + '">';
  for (const row of rows) {
    if (row === SEP) html += '<div class="sep"></div>';
    else html += '<div class="row">' + toHtml(row) + "</div>";
  }
  board.innerHTML = html + "</div>";
}

/**
 * 点「注销」时抛出的信号。它会一层层穿过所有 await，直接结束这一局。
 * 不这么做的话，游戏会永远卡在"等按钮"那一步；重新登录后会同时跑两份。
 */
class QuitGame extends Error {}

let pendingAsk = null;    // 当前正在等哪个按钮（没人等的时候是 null）
let quitRequested = false;   // 玩家点了注销（下次轮到等按钮时就自动退出）

/**
 * 等玩家点一个按钮。
 * choices 长这样：[{ key: "1", label: "前进" }, ...]，返回被点的那个 key。
 * 这就是 Python 里那个 input() 的替身。
 */
function ask(choices) {
  // 注销可能是趁动画播放时点的，那会儿并没有按钮在等，
  // 所以这里再检查一次，保证下一次轮到等按钮时一定能退出去。
  if (quitRequested) return Promise.reject(new QuitGame("注销"));

  return new Promise((resolve, reject) => {
    buttonsEl.innerHTML = "";
    pendingAsk = { resolve: resolve, reject: reject };
    for (const choice of choices) {
      const button = document.createElement("button");
      button.textContent = choice.label;
      button.onclick = () => {
        // 点完立刻清空按钮，防止手快连点两次
        const waiting = pendingAsk;
        pendingAsk = null;
        buttonsEl.innerHTML = "";
        waiting.resolve(choice.key);
      };
      buttonsEl.appendChild(button);
    }
  });
}

/** 注销时调用：把正在等的那个按钮打断，让整局游戏退出来。 */
function quitGame() {
  quitRequested = true;
  if (!pendingAsk) return;         // 没人在等按钮也没关系，ask() 会看到上面那个记号
  const waiting = pendingAsk;
  pendingAsk = null;
  buttonsEl.innerHTML = "";
  waiting.reject(new QuitGame("注销"));
}

const CHOICES_ADVENTURE = [
  { key: "1", label: "前进" }, { key: "2", label: "背包" },
  { key: "3", label: "休息" }, { key: "4", label: "离开地牢" },
  { key: "S", label: "存档" }, { key: "L", label: "读档" },
];
const CHOICES_COMBAT = [
  { key: "1", label: "攻击" }, { key: "2", label: "重击" },
  { key: "3", label: "背包" }, { key: "4", label: "逃跑" },
];
const CHOICES_BOSS = [{ key: "1", label: "迎战" }, { key: "2", label: "撤退" }];
const CHOICES_AGAIN = [{ key: "1", label: "再来一局" }];


// ===== 五、怪物和物品 =====

/**
 * 造一只怪物。boss=true 表示这是第 5/10/15… 层那只守关首领。
 * （首领不是随机碰上的，是每 5 层固定站在楼梯口等你。）
 */
const MUTANT_TITLES = ["狂暴的", "变异的", "发狂的", "漆黑的"];

/** 变异概率：越深越多，最多两成出头。 */
const mutateChance = (depth) => Math.min(0.22, 0.08 + depth * 0.01);

function spawn(depth, boss) {
  // 池子按深度从小到大放开：最浅的几层只有最弱的三只，越深越杂
  const pool = MONSTERS.slice(0, Math.min(MONSTERS.length, 3 + Math.floor(depth / 2)));
  const base = pickOne(pool);
  const grow = 1 + 0.18 * (depth - 1);
  const monster = {
    name: base.name,
    level: depth,
    max_hp: Math.floor(base.hp * grow),
    hp: Math.floor(base.hp * grow),
    atk: Math.floor(base.atk * (1 + 0.08 * (depth - 1))),
    xp: Math.floor(base.reward * grow),
    gold: Math.floor(base.reward * grow),
    // 特长：没有就是 0 / false，后面判断起来不用再分情况
    dodge: base.dodge || 0,
    pierce: !!base.pierce,
    boom: !!base.boom,
    regen: base.regen || 0,
  };
  if (boss) {
    monster.name = "首领·" + base.name;
    monster.boss = true;
    const boost = 1.5 + 0.03 * depth;        // 血厚：第 5 层 ×1.65，第 15 层 ×1.95
    for (const key of ["max_hp", "hp", "xp", "gold"]) monster[key] = Math.floor(monster[key] * boost);
    monster.atk = Math.floor(monster.atk * (1.2 + 0.01 * depth));   // 攻击也凶，但没血涨得多
  } else if (Math.random() < mutateChance(depth)) {
    // 变异：血差不多翻倍、攻击更狠，但金币和经验翻好几倍，而且必掉装备
    monster.mutant = true;
    monster.name = pickOne(MUTANT_TITLES) + monster.name;
    monster.max_hp = Math.floor(monster.max_hp * 1.9);
    monster.hp = monster.max_hp;
    monster.atk = Math.floor(monster.atk * 1.4);
    monster.xp = Math.floor(monster.xp * 2.5);
    monster.gold = Math.floor(monster.gold * 2.5);
  }
  return monster;
}

/** 摇一个品质。层数越深，越容易出蓝的和紫的。 */
function rollRarity(depth) {
  const roll = Math.random();
  const epic = Math.min(0.30, 0.03 + depth * 0.02);      // 第 15 层约三成
  const rare = Math.min(0.45, 0.15 + depth * 0.02);
  if (roll < epic) return "epic";
  if (roll < epic + rare) return "rare";
  return "common";
}

/** 按品质抽词条。条数在 [最少, 最多] 之间随机，同一种词条不会重复出现两次。 */
function rollAffixes(rarity) {
  const [least, most] = RARITIES[rarity].affixes;
  const count = least + Math.floor(Math.random() * (most - least + 1));
  const pool = AFFIX_KEYS.slice();
  const picked = [];
  for (let i = 0; i < count && pool.length; i++) {
    const key = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    picked.push({ key: key, value: AFFIXES[key].roll() });
  }
  return picked;
}

/**
 * 造一件东西。
 * gear=false 是药水（药水不分品质）；gear=true 是装备，会带品质和词条。
 * forcedRarity 传 "epic" 就是"这一件必定是史诗"（首领掉落用得上）。
 */
function randomItem(depth, gear, forcedRarity) {
  if (gear) {
    const isWeapon = Math.random() < 0.5;
    const table = isWeapon ? WEAPONS : ARMORS;
    const [name, base] = pickOne(table.slice(0, Math.min(table.length, 1 + Math.floor(depth / 3))));
    const rarity = forcedRarity || rollRarity(depth);
    const info = RARITIES[rarity];
    // 先按品质算基准值，再上下摇一摇——所以同样一件蓝剑，有的 +5 有的 +8
    const roll = ROLL_MIN + Math.random() * (ROLL_MAX - ROLL_MIN);
    return {
      kind: isWeapon ? "weapon" : "armor",
      name: name,
      rarity: rarity,
      value: Math.max(base, Math.round(base * info.mult * roll)),
      perfect: roll >= ROLL_MAX - ROLL_PERFECT,     // 差一点点就摇满 = 极品
      affixes: rollAffixes(rarity),
      durability: info.durability,                  // 还能打几场，打完就损毁
      max_durability: info.durability,
    };
  }
  const [name, value] = pickOne(POTIONS.slice(0, Math.min(POTIONS.length, 1 + Math.floor(depth / 4))));
  return { kind: "potion", name: name, value: value };
}

/** 首领必掉的品质：第 15 层起是金装，之前是紫装。 */
const bossLootRarity = (depth) => (depth >= 15 ? "legendary" : "epic");

/** 掉落那一行按品质上色：金装用金色喊出来，其余用紫色。 */
const lootColor = (item) => (item.rarity === "legendary" ? "\u001b[93m" + "\u001b[1m" : "\u001b[95m");


// ===== 六、画面 =====

/**
 * 天赋那一行：把选过的天赋列出来（选过两个就写"力量×2"），
 * 后面再跟上暴击/吸血/闪避的总数——这三个是看不见摸不着的，写出来才看得见成长。
 */
function talentRow(player) {
  const tally = {};
  for (const key of player.talents) tally[key] = (tally[key] || 0) + 1;
  // 暴击/吸血/闪避在下面单独按百分比写出来，这里就不再重复列名字了
  const asPercent = { crit: 1, steal: 1, dodge: 1 };
  const parts = Object.keys(tally)
    .filter((key) => !asPercent[key])
    .map((key) => (TALENT_NAME[key] || key) + (tally[key] > 1 ? "×" + tally[key] : ""));
  if (critOf(player) > 0.15) parts.push("暴击 " + Math.round(critOf(player) * 100) + "%");
  if (stealOf(player) > 0) parts.push("吸血 " + Math.round(stealOf(player) * 100) + "%");
  if (dodgeOf(player) > 0) parts.push("闪避 " + Math.round(dodgeOf(player) * 100) + "%");
  return "天赋 " + (parts.length ? GREEN + parts.join("  ") + END : GREY + "升级时三选一" + END);
}

function statusRows(player) {
  const weapon = player.weapon
    ? itemName(player.weapon) + GOLD + " +" + player.weapon.value + END + durabilityText(player.weapon)
    : GREY + "空手" + END;
  const armor = player.armor
    ? itemName(player.armor) + GOLD + " +" + player.armor.value + END + durabilityText(player.armor)
    : GREY + "布衣" + END;
  return [
    "生命 " + bar(player.hp, player.max_hp, 20, RED) + "  金币 " + GOLD + player.gold + END,
    "等级 " + BOLD + player.level + END + "   攻击 " + attackOf(player) + "   防御 " + guardOf(player),
    "经验 " + bar(player.xp, xpNeeded(player.level), 20, CYAN),
    "武器 " + weapon + "   护甲 " + armor,
    talentRow(player),
  ];
}

function renderAdventure(player, log) {
  const rows = [BOLD + "地牢冒险" + END + "   " + GREY + "第 " + player.depth + " 层" + END, SEP];
  rows.push(...statusRows(player));
  rows.push(SEP);
  rows.push(...log.slice(-7).map((line) => GREY + "·" + END + " " + line));
  show(rows);
}

/** 把怪物的特长写成一小句，跟在血条后面（普通怪就是空的）。 */
function monsterTrait(monster) {
  const tags = [];
  if (monster.mutant) tags.push("变异");
  if (monster.dodge) tags.push("闪避极高");
  if (monster.pierce) tags.push("无视防御");
  if (monster.boom) tags.push("残血自爆");
  if (monster.regen) tags.push("自我回血");
  return tags.length ? "   " + GREY + "（" + tags.join("、") + "）" + END : "";
}

function renderCombat(player, monster, log) {
  // 变异的怪名字是红的，普通怪是紫的，扫一眼就知道这只不一般
  const nameColor = monster.mutant ? RED + BOLD : PURPLE;
  const rows = [
    nameColor + monster.name + END + "   " + GREY + "Lv." + monster.level + END,
    "敌血 " + bar(monster.hp, monster.max_hp, 18, PURPLE) + monsterTrait(monster),
    SEP,
  ];
  rows.push(...statusRows(player));
  rows.push(SEP);
  rows.push(...log.slice(-6).map((line) => GREY + "·" + END + " " + line));
  show(rows, PURPLE);
}

/** 装备的名字，按品质上色：普通=白、稀有=蓝、史诗=紫、传说=金。例：史诗精灵匕首 */
function itemName(item) {
  const info = RARITIES[item.rarity] || RARITIES.common;
  return info.color + info.name + item.name + END;
}

/** 摇到接近满值的装备标一颗星，一眼能看出来这件比同类好。 */
function qualityTag(item) {
  return item.perfect ? "  " + GOLD + BOLD + "★极品" + END : "";
}

/**
 * 这件装备还剩几点耐久。
 * 老存档里的装备没有这个字段，第一次问到的时候按品质补满——所以老档读进来不会坏。
 */
function durabilityOf(item) {
  if (item.max_durability === undefined) {
    const info = RARITIES[item.rarity] || RARITIES.common;
    item.max_durability = info.durability;
    item.durability = info.durability;
  }
  return item.durability;
}

/** 耐久写成 "12/18"，快不行的时候变黄、只剩一两点时变红。 */
function durabilityText(item) {
  const left = durabilityOf(item);
  const color = left <= 2 ? RED : left * 3 <= item.max_durability ? GOLD : GREY;
  return "  " + color + left + "/" + item.max_durability + END;
}

/**
 * 背包和商店里，一件东西占的行。
 * 药水占一行；装备占两行（第一行名字+基础值，第二行是词条），这样手机上不会挤成一坨。
 */
function itemRows(player, item) {
  if (item.kind === "potion") {
    return [GREEN + item.name + END + "  " + GREY + "回复 " + item.value + " 点生命" + END];
  }
  const slot = item.kind === "weapon" ? "攻击" : "防御";
  const equipped = item.kind === "weapon" ? player.weapon === item : player.armor === item;
  const tag = equipped ? "  " + CYAN + "已装备" + END : "";
  const rows = [itemName(item) + "  " + GOLD + "+" + item.value + END + " " + slot +
                qualityTag(item) + tag + durabilityText(item)];
  if (item.affixes && item.affixes.length) {
    rows.push("    " + CYAN + item.affixes.map(affixText).join("  ") + END);
  }
  return rows;
}

async function renderBag(player, log) {
  const rows = [BOLD + "背包" + END + "   " + GREY + player.bag.length + "/" + BAG_LIMIT + END, SEP];
  if (player.bag.length) {
    player.bag.forEach((item, i) => {
      const lines = itemRows(player, item);
      rows.push("[" + (i + 1) + "] " + lines[0]);
      for (const line of lines.slice(1)) rows.push(line);
    });
  } else {
    rows.push(GREY + "空空如也。" + END);
  }
  rows.push(SEP);
  show(rows, GREEN);
  // 按钮上带编号，跟上面列表对得上号（同名的两件也能分清是哪一个）
  const choices = player.bag.map((item, i) => ({ key: String(i + 1), label: (i + 1) + " " + item.name }));
  choices.push({ key: "0", label: "返回" });
  return await ask(choices);
}


// ===== 七、规则 =====

function heal(player, amount) {
  const before = player.hp;
  player.hp = Math.min(player.max_hp, player.hp + amount);
  return player.hp - before;
}

function damageOf(attack, defense) {
  return Math.max(1, attack + (Math.floor(Math.random() * 5) - 2) - defense);
}

async function gainXp(player, amount, log) {
  player.xp += amount;
  add(log, CYAN + "经验 +" + amount + END);
  while (player.xp >= xpNeeded(player.level)) {
    player.xp -= xpNeeded(player.level);
    player.level += 1;
    player.max_hp += 14;
    player.hp = Math.min(player.max_hp, player.hp + 14);
    player.atk += 2;
    player.defense += 1;
    add(log, GOLD + BOLD + "升级！" + END + GOLD + " 你现在是 " + player.level +
             " 级（生命 +14，攻击 +2，防御 +1）。" + END);
    pause(0.8);
    await chooseTalent(player, log);
  }
}

/**
 * 升级时弹出「三选一」：随机抽 3 个天赋摆在按钮上，必须点一个才能继续。
 * 选完立刻生效，并把 key 记进 player.talents（状态栏那一行就是它）。
 */
async function chooseTalent(player, log) {
  const pool = TALENTS.slice();
  const picks = [];
  while (picks.length < 3 && pool.length) {
    picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  const rows = [
    BOLD + GOLD + "天赋觉醒！" + END + GREY + "  选一个，这一局永久生效" + END, SEP,
    "你现在是 " + BOLD + player.level + END + " 级，挑一样带走：",
    SEP,
  ];
  picks.forEach((talent, i) => rows.push("[" + (i + 1) + "] " + GOLD + BOLD + talent.name + END + "   " + talent.text));
  show(rows, GOLD);

  const choices = picks.map((talent, i) => ({ key: String(i + 1), label: talent.name + "：" + talent.text }));
  const choice = await ask(choices);
  const chosen = picks[Number(choice) - 1];
  chosen.run(player);
  player.talents.push(chosen.key);
  add(log, GOLD + "天赋「" + chosen.name + "」——" + chosen.text + END);
  pause(0.6);
}

async function victory(player, monster, log) {
  player.kills += 1;
  player.gold += monster.gold;
  add(log, GOLD + "你击败了 " + monster.name + "，拾到 " + monster.gold + " 枚金币。" + END);
  pause(0.6);

  if (monster.boss) {
    // 首领必定掉好东西：第 5、10 层给紫装，第 15 层往下直接给金装
    add(log, PURPLE + BOLD + "首领轰然倒地，整层地牢都在震——它的宝库归你了！" + END);
    pause(0.9);
    const loot = randomItem(player.depth, true, bossLootRarity(player.depth));
    if (player.bag.length >= BAG_LIMIT) makeRoom(player, log);   // 首领的东西不能因为背包满就丢了
    player.bag.push(loot);
    add(log, lootColor(loot) + "你夺走了 " + itemName(loot) + qualityTag(loot) + "！" + END);
    pause(0.8);
  } else if (monster.mutant) {
    // 变异怪不掉药水，只掉装备，而且至少是蓝的
    const loot = randomItem(player.depth, true, Math.random() < 0.5 ? "epic" : "rare");
    if (player.bag.length < BAG_LIMIT) {
      player.bag.push(loot);
      add(log, GOLD + "变异怪爆了一地东西：" + itemName(loot) + qualityTag(loot) + "！" + END);
      pause(0.8);
    }
  } else if (Math.random() < 0.28) {
    const item = randomItem(player.depth, Math.random() < 0.45);
    if (player.bag.length < BAG_LIMIT) {
      player.bag.push(item);
      add(log, GREEN + "它还掉落了 " + itemName(item) + "！" + END);
      pause(0.7);
    }
  }
  await gainXp(player, monster.xp, log);
}

/** 背包满了：丢掉一件最不值钱的装备，腾个格子出来。 */
function makeRoom(player, log) {
  let worst = -1;
  player.bag.forEach((item, i) => {
    if (item.kind === "potion") return;      // 药水留着，先扔装备
    if (worst < 0 || item.value < player.bag[worst].value) worst = i;
  });
  if (worst < 0) return;
  const gone = player.bag.splice(worst, 1)[0];
  add(log, GREY + "背包满了，" + gone.name + " 被挤掉了。" + END);
}

function playerStrike(player, monster, log, heavy) {
  // 蜘蛛这类高闪避的怪会躲开你的攻击（重击本来就是三成挥空，就不叠第二次了）
  if (!heavy && Math.random() < monster.dodge) {
    add(log, GREY + monster.name + " 灵巧地闪开了，你扑了个空。" + END);
    pause(0.5);
    return false;
  }
  let damage;
  if (heavy) {
    if (Math.random() < 0.35) {
      add(log, GREY + "你蓄力劈下，却被闪开了。" + END);
      pause(0.5);
      return false;
    }
    damage = damageOf(attackOf(player) * 2, 0);
    add(log, BOLD + "重击！" + END + " " + PURPLE + monster.name + END + " 受到 " +
             GOLD + damage + END + " 点伤害。");
  } else {
    // 普通攻击按"暴击率"决定会不会打出双倍伤害（天赋和装备词条能把它堆起来）
    const crit = Math.random() < critOf(player);
    const mark = crit ? GOLD + "暴击！" + END + " " : "";
    damage = damageOf(attackOf(player) * (crit ? 2 : 1), 0);
    add(log, mark + "你击中 " + PURPLE + monster.name + END + "，造成 " + GOLD + damage + END + " 点伤害。");
  }
  monster.hp -= damage;
  // 吸血：打出去多少伤害，就按比例回自己一点血
  const stole = Math.floor(damage * stealOf(player));
  if (stole > 0) {
    const gained = heal(player, stole);
    if (gained > 0) add(log, GREEN + "吸血：你夺回 " + gained + " 点生命。" + END);
  }
  pause(0.45);
  return monster.hp <= 0;
}

/**
 * 怪物出手。round 是这一场打到了第几回合（首领每 3 回合放一次绝招）。
 * 出手前先按"闪避"判定，闪开了就一点伤害都不吃。
 */
function monsterStrike(player, monster, log, round) {
  // 残血自爆：血掉到三成以下它就抱着你一起炸，这一下躲不掉
  if (monster.boom && monster.hp <= monster.max_hp * 0.3) {
    const hurt = damageOf(monster.atk * 2.5, guardOf(player));
    player.hp -= hurt;
    monster.hp = 0;
    add(log, RED + BOLD + monster.name + " 全身发白，嘶嘶作响——轰！它炸成了碎片，你受到 " + hurt + " 点伤害。" + END);
    pause(0.8);
    return;
  }
  if (Math.random() < dodgeOf(player)) {
    add(log, CYAN + "你侧身一闪，" + monster.name + " 扑了个空。" + END);
    pause(0.4);
    return;
  }
  if (monster.boss && round % 3 === 0) {
    // 首领的绝招：一半概率是双倍重击，一半概率是吼一声回血
    if (Math.random() < 0.5) {
      const hurt = damageOf(monster.atk * 2, guardOf(player));
      player.hp -= hurt;
      add(log, RED + BOLD + monster.name + " 高举双臂砸下——绝招！你受到 " + hurt + " 点伤害。" + END);
    } else {
      const healed = Math.min(monster.max_hp - monster.hp, Math.floor(monster.max_hp * 0.15));
      monster.hp += healed;
      add(log, RED + monster.name + " 仰头咆哮，伤口飞快愈合，回复 " + healed + " 点生命。" + END);
    }
    pause(0.6);
    return;
  }
  // 幽灵是虚体，你的防御对它没用
  const damage = damageOf(monster.atk, monster.pierce ? 0 : guardOf(player));
  player.hp -= damage;
  if (monster.pierce) add(log, RED + monster.name + " 穿过你的护甲，你受到 " + damage + " 点伤害。" + END);
  else add(log, RED + monster.name + " 攻来，你受到 " + damage + " 点伤害。" + END);
  pause(0.45);
  // 女巫一边打一边给自己念咒回血
  if (monster.regen > 0 && monster.hp > 0) {
    const healed = Math.min(monster.max_hp - monster.hp, Math.floor(monster.max_hp * monster.regen));
    if (healed > 0) {
      monster.hp += healed;
      add(log, GREEN + monster.name + " 咕哝着念了句咒语，恢复 " + healed + " 点生命。" + END);
      pause(0.35);
    }
  }
}

async function useItem(player, index, log) {
  const item = player.bag.splice(index, 1)[0];
  if (item.kind === "potion") {
    const gained = heal(player, item.value);
    add(log, GREEN + "你喝下 " + item.name + "，恢复 " + gained + " 点生命。" + END);
  } else if (item.kind === "weapon") {
    if (player.weapon) player.bag.push(player.weapon);
    player.weapon = item;
    add(log, GREEN + "你换上 " + item.name + "，攻击 +" + item.value + "。" + END);
  } else {
    if (player.armor) player.bag.push(player.armor);
    player.armor = item;
    add(log, GREEN + "你穿上 " + item.name + "，防御 +" + item.value + "。" + END);
  }
  pause(0.4);
}

async function openBag(player, log) {
  while (true) {
    const choice = await renderBag(player, log);
    if (choice === "0") return;
    await useItem(player, Number(choice) - 1, log);
  }
}

/**
 * 打完一场，身上两件装备各磨掉 1 点耐久，磨到 0 就当场损毁。
 * 这是逼你一直换装备的地方：捡到更好的就换上，老祖宗那把剑迟早会断。
 */
function wearGear(player, log) {
  for (const slot of ["weapon", "armor"]) {
    const item = player[slot];
    if (!item) continue;
    item.durability = durabilityOf(item) - 1;
    if (item.durability > 0) continue;
    player[slot] = null;
    add(log, RED + BOLD + "你的 " + item.name + " 耐久耗尽，" +
             (slot === "weapon" ? "断成了两截" : "碎成了碎片") + "！" + END);
  }
}

async function fight(player, monster, log) {
  if (monster.boss && !(await bossWarning(player, monster))) {
    add(log, GREY + "你退回石阶，避开了 " + monster.name + "。" + END);
    pause(0.6);
    return;
  }
  add(log, PURPLE + monster.name + " 挡住了去路！" + END);
  pause(0.6);
  wearGear(player, log);         // 真打起来了，武器和护甲各磨掉一点
  let round = 0;                 // 打到第几回合（首领每 3 回合放绝招）
  while (player.hp > 0) {
    renderCombat(player, monster, log);
    const choice = await ask(CHOICES_COMBAT);
    if (choice === "3") {
      await openBag(player, log);
      add(log, GREY + "你翻背包的工夫，怪物又逼近了一步。" + END);
    } else if (choice === "4") {
      if (Math.random() < 0.75) {
        add(log, GREY + "你转身就跑，逃掉了。" + END);
        pause(0.4);
        return;
      }
      add(log, RED + "逃跑失败！" + END);
    } else if (choice === "1") {
      if (playerStrike(player, monster, log, false)) { await victory(player, monster, log); return; }
    } else {
      if (playerStrike(player, monster, log, true)) { await victory(player, monster, log); return; }
    }
    if (player.hp > 0) {
      round += 1;
      monsterStrike(player, monster, log, round);
      // 自爆的怪会把自己炸死，那也算你打赢了
      if (monster.hp <= 0) { await victory(player, monster, log); return; }
    }
  }
}

async function bossWarning(player, monster) {
  const rows = [
    BOLD + RED + "首领挡路！" + END, SEP,
    PURPLE + monster.name + END + "   " + GREY + "Lv." + monster.level + END,
    "敌血 " + bar(monster.hp, monster.max_hp, 18, PURPLE) + monsterTrait(monster),
    "敌攻 " + monster.atk + "   预计每回合承受 " + Math.max(1, monster.atk - guardOf(player)) + " 点",
    SEP,
    "你的 生命 " + player.hp + "/" + player.max_hp + "   攻击 " + attackOf(player) +
      "   防御 " + guardOf(player),
    SEP,
    RED + "它每 3 回合放一次绝招：双倍重击，或者自己回血。" + END,
    PURPLE + "打赢它，必定掉一件" + BOLD + (player.depth >= 15 ? "金色传说" : "紫色史诗") + END + PURPLE + "装备。" + END,
    GREY + "打不过可以先撤，补血换装备再下来。" + END,
  ];
  show(rows, RED);
  return (await ask(CHOICES_BOSS)) === "1";
}

async function chest(player, log) {
  add(log, GOLD + "地上有一只宝箱，你撬开了它……" + END);
  pause(0.8);
  const roll = Math.random();
  let item = null;
  if (roll < 0.45) {
    item = randomItem(player.depth, true);
    add(log, GREEN + "获得装备：" + itemName(item) + "（+" + item.value + "）" + qualityTag(item) + END);
  } else if (roll < 0.75) {
    const coins = (10 + Math.floor(Math.random() * 11)) * player.depth;
    player.gold += coins;
    add(log, GOLD + "获得 " + coins + " 枚金币。" + END);
  } else {
    item = randomItem(player.depth, false);
    add(log, GREEN + "获得 " + item.name + "。" + END);
  }
  if (item) {
    if (player.bag.length < BAG_LIMIT) player.bag.push(item);
    else add(log, RED + "可惜背包满了，只能把它丢下。" + END);
  }
  pause(0.7);
}

async function fountain(player, log) {
  add(log, CYAN + "一眼泉水泛着微光……" + END);
  pause(0.6);
  const gained = heal(player, Math.floor(player.max_hp * 2 / 3));
  add(log, GREEN + "你喝了几口，恢复 " + gained + " 点生命。" + END);
  pause(0.5);
}

async function trap(player, log) {
  add(log, RED + "脚下石砖一沉——是陷阱！" + END);
  pause(0.7);
  const damage = damageOf(8 + player.depth * 2, guardOf(player));
  player.hp -= damage;
  add(log, RED + "尖刺从地缝弹出，你受到 " + damage + " 点伤害。" + END);
  pause(0.6);
  if (player.gold > 0 && Math.random() < 0.3) {
    const lost = Math.min(player.gold, (5 + Math.floor(Math.random() * 11)) * player.depth);
    player.gold -= lost;
    add(log, GOLD + "钱袋被划破了，掉了 " + lost + " 枚金币。" + END);
    pause(0.5);
  }
}

async function portal(player, log) {
  player.depth += pickOne([1, 2]);
  add(log, CYAN + "符文一闪，你被传送到第 " + player.depth + " 层。" + END);
  pause(0.8);
  const gained = heal(player, Math.max(1, Math.floor(player.max_hp / 5)));
  if (gained) {
    add(log, GREEN + "门的余辉让你恢复 " + gained + " 点生命。" + END);
    pause(0.4);
  }
}

async function rest(player, log) {
  if (Math.random() < 0.15) {
    add(log, RED + "你刚坐下，阴影里就扑出一只怪物！" + END);
    pause(0.5);
    await fight(player, spawn(player.depth), log);
    return;
  }
  const gained = heal(player, Math.max(12, Math.floor(player.max_hp / 2)));
  add(log, GREEN + "你靠着石壁歇了一会儿，恢复 " + gained + " 点生命。" + END);
  pause(0.5);
}

const priceOf = (item) => item.value * (item.kind === "potion" ? 3 : 18);
const healPrice = (player) => 20 + player.depth * 8;

async function shop(player, log) {
  const stock = [];
  for (let i = 0, n = 2 + Math.floor(Math.random() * 2); i < n; i++) {
    const item = randomItem(player.depth, Math.random() < 0.6);
    item.price = priceOf(item);
    stock.push(item);
  }
  add(log, GOLD + "一个背着口袋的流浪商人拦住你：“看看货？”" + END);
  pause(0.6);
  let notice = "";
  while (true) {
    const rows = [BOLD + "流浪商人" + END + "   " + GREY + "你有 " + player.gold + " 金币" + END, SEP];
    stock.forEach((item, i) => {
      const color = player.gold >= item.price ? GOLD : RED;
      const lines = itemRows(player, item);
      rows.push("[" + (i + 1) + "] " + lines[0] + "   " + color + item.price + " 金" + END);
      for (const line of lines.slice(1)) rows.push(line);
    });
    rows.push(SEP, "[H] 花 " + healPrice(player) + " 金把血回满");
    if (notice) rows.push(notice);
    show(rows, GOLD);

    const choices = stock.map((item, i) => ({ key: String(i + 1), label: item.name + " " + item.price + "金" }));
    choices.push({ key: "H", label: "回满血 " + healPrice(player) + "金" });
    choices.push({ key: "0", label: "离开" });
    const choice = await ask(choices);
    notice = "";

    if (choice === "0") {
      add(log, GREY + "商人挥手告别。" + END);
      pause(0.4);
      return;
    }
    if (choice === "H") {
      const price = healPrice(player);
      if (player.hp >= player.max_hp) notice = GREY + "你一点伤都没有，商人笑了笑。" + END;
      else if (player.gold < price) notice = RED + "钱不够。" + END;
      else {
        player.gold -= price;
        notice = GREEN + "敷上药，恢复 " + heal(player, player.max_hp) + " 点生命。" + END;
      }
      pause(0.7);
      continue;
    }
    const index = Number(choice) - 1;
    const item = stock[index];
    if (player.gold < item.price) {
      notice = RED + "钱不够。" + END;
    } else if (player.bag.length >= BAG_LIMIT) {
      notice = RED + "背包满了。" + END;
    } else {
      player.gold -= item.price;
      stock.splice(index, 1);
      delete item.price;
      player.bag.push(item);
      notice = GREEN + "买下 " + item.name + "，收进背包。" + END;
      if (!stock.length) {
        pause(0.7);
        add(log, GREY + "商人收摊走了。" + END);
        return;
      }
    }
    pause(0.7);
  }
}

async function advance(player, log) {
  player.depth += 1;
  add(log, "你沿着石阶下到第 " + player.depth + " 层。");
  pause(0.4);
  // 第 5、10、15… 层是固定首领，不掷骰子，它就在楼梯口等着
  if (player.depth % 5 === 0) {
    await fight(player, spawn(player.depth, true), log);
    return;
  }
  const roll = Math.random();
  if (roll < 0.50) await fight(player, spawn(player.depth), log);
  else if (roll < 0.66) await chest(player, log);
  else if (roll < 0.76) await fountain(player, log);
  else if (roll < 0.86) await shop(player, log);
  else if (roll < 0.94) await trap(player, log);
  else if (roll < 0.98) await portal(player, log);
  else {
    add(log, GREY + "这一层空荡荡的，只有滴水声。" + END);
    pause(0.5);
  }
}


// ===== 八、云端存档 =====
// 存档的形状跟 Python 版一模一样：{ player: {...}, log: [...] }
// 所以两边存的东西是可以互相读的。

function playerToSave(player) {
  const saved = {};
  for (const key of SAVE_FIELDS) saved[key] = player[key];
  return saved;
}

async function saveToCloud(slot, player, log) {
  const data = { player: playerToSave(player), log: log.slice(-8) };
  await api("/api/save", { method: "POST", body: JSON.stringify({ slot: slot, data: data }) });
}

async function loadFromCloud(slot) {
  const res = await api("/api/load?slot=" + slot);
  if (!res.data || !res.data.player) return null;
  const player = Object.assign(newPlayer(), res.data.player);
  return [player, (res.data.log || []).map(String)];
}

/** 一次问三个槽，返回 ["第 7 层   等级 4   金币 500", null, null] 这样的数组。 */
async function slotSummaries() {
  const results = await Promise.all([1, 2, 3].map(async (slot) => {
    try {
      const res = await api("/api/load?slot=" + slot);
      const saved = res.data && res.data.player;
      if (!saved) return null;
      return "第 " + (saved.depth ?? "?") + " 层   等级 " + (saved.level ?? "?") + "   金币 " + (saved.gold || 0);
    } catch (error) {
      return null;
    }
  }));
  return results;
}

async function chooseSlot(action) {
  const summaries = await slotSummaries();
  const rows = [BOLD + (action === "save" ? "存档到槽位" : "从槽位读档") + END, SEP];
  for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
    const summary = summaries[slot - 1];
    rows.push("[" + slot + "] " + (summary ? GREEN + summary + END : GREY + "空" + END));
  }
  show(rows, GREEN);

  const choices = summaries.map((summary, i) => ({
    key: String(i + 1),
    label: summary ? "槽 " + (i + 1) : "槽 " + (i + 1) + "（空）",
  }));
  choices.push({ key: "0", label: "返回" });
  const choice = await ask(choices);
  return choice === "0" ? null : Number(choice);
}


// ===== 九、结局画面 =====

async function ending(player) {
  show([
    BOLD + RED + "你倒下了" + END, SEP,
    "倒在 第 " + player.depth + " 层",
    "等级 " + player.level + "   击杀 " + player.kills + "   金币 " + GOLD + player.gold + END,
    "",
    GREY + "还能再战一局。" + END,
  ], RED);
  await ask(CHOICES_AGAIN);
}

async function farewell(player) {
  show([
    BOLD + "你离开了地牢" + END, SEP,
    "最深到过 第 " + player.depth + " 层",
    "等级 " + player.level + "   击杀 " + player.kills + "   金币 " + GOLD + player.gold + END,
    "",
    GREY + "存档还在云上，随时回来。" + END,
  ], GOLD);
  await ask(CHOICES_AGAIN);
}


// ===== 十、主循环 =====

function newGame() {
  const player = newPlayer();
  const log = [];
  add(log, CYAN + "你推开地牢的铁门，霉味扑面而来。" + END);
  return [player, log];
}

async function play() {
  quitRequested = false;    // 新的一局开始，把上次注销的记号清掉
  while (true) {
    let [player, log] = newGame();
    while (player.hp > 0) {
      renderAdventure(player, log);
      const choice = await ask(CHOICES_ADVENTURE);

      if (choice === "1") {
        await advance(player, log);
      } else if (choice === "2") {
        await openBag(player, log);
      } else if (choice === "3") {
        await rest(player, log);
      } else if (choice === "S") {
        const slot = await chooseSlot("save");
        if (slot !== null) {
          try {
            await saveToCloud(slot, player, log);
            add(log, GREEN + "已存到槽 " + slot + "：第 " + player.depth + " 层，等级 " + player.level + "。" + END);
          } catch (error) {
            add(log, RED + "存档失败：" + error.message + END);
          }
        }
      } else if (choice === "L") {
        const slot = await chooseSlot("load");
        if (slot !== null) {
          try {
            const loaded = await loadFromCloud(slot);
            if (!loaded) {
              add(log, RED + "槽 " + slot + " 还是空的。" + END);
            } else {
              player = loaded[0];
              log = loaded[1];
              add(log, CYAN + "读档成功（槽 " + slot + "）：第 " + player.depth + " 层，等级 " +
                       player.level + "，生命 " + player.hp + "/" + player.max_hp + "。" + END);
            }
          } catch (error) {
            add(log, RED + "读档失败：" + error.message + END);
          }
        }
      } else {
        await farewell(player);
        return;
      }
    }
    await ending(player);
  }
}
