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
// ============================================================================


// ===== 一、颜色（和 Python 里那套 ANSI 码一模一样）=====
const END = "\u001b[0m", BOLD = "\u001b[1m", DIM = "\u001b[2m";
const RED = "\u001b[91m", GREEN = "\u001b[92m", GOLD = "\u001b[93m", BLUE = "\u001b[94m";
const PURPLE = "\u001b[95m", CYAN = "\u001b[96m", GREY = "\u001b[90m";

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
  "\u001b[95m": "purple", "\u001b[96m": "cyan", "\u001b[90m": "grey",
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
const MONSTERS = [                 // 名字, 生命, 攻击, 战利品基数
  ["洞穴鼠", 10, 4, 6],
  ["史莱姆", 14, 5, 9],
  ["骷髅兵", 20, 7, 13],
  ["石像鬼", 28, 9, 18],
  ["暗影狼", 36, 11, 24],
  ["地牢领主", 60, 16, 40],
];

const SAVE_FIELDS = ["level", "max_hp", "hp", "atk", "defense",
                     "gold", "xp", "kills", "depth", "weapon", "armor", "bag"];

function newPlayer() {
  return { level: 1, max_hp: 50, hp: 50, atk: 6, defense: 2,
           gold: 0, xp: 0, kills: 0, depth: 1, weapon: null, armor: null, bag: [] };
}

const attackOf = (p) => p.atk + (p.weapon ? p.weapon.value : 0);
const guardOf = (p) => p.defense + (p.armor ? p.armor.value : 0);
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

/** 一排「1 前进 2 背包 …」的按钮，省得每次手写。 */
const numbered = (pairs) => pairs.map(([key, label], i) => ({ key: String(i + 1), label }));

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

function spawn(depth) {
  // 最强怪物（地牢领主）从第 8 层才进池子——第 5 层不该撞上它
  const pool = MONSTERS.slice(0, Math.min(MONSTERS.length, 2 + Math.floor(depth / 2)));
  const [name, hp, atk, reward] = pickOne(pool);
  const grow = 1 + 0.18 * (depth - 1);
  const monster = {
    name: name,
    level: depth,
    max_hp: Math.floor(hp * grow),
    hp: Math.floor(hp * grow),
    atk: Math.floor(atk * (1 + 0.08 * (depth - 1))),
    xp: Math.floor(reward * grow),
    gold: Math.floor(reward * grow),
  };
  if (depth % 5 === 0 && Math.random() < 0.22) {
    monster.name = "首领·" + name;
    monster.boss = true;
    const boost = 1.10 + 0.015 * depth;         // 第 5 层 ×1.18，第 15 层 ×1.33
    for (const key of ["max_hp", "hp", "xp", "gold"]) monster[key] = Math.floor(monster[key] * boost);
    monster.atk = Math.floor(monster.atk * (1 + 0.005 * depth));   // 攻击涨得更慢
  }
  return monster;
}

function randomItem(depth, gear) {
  if (gear) {
    const isWeapon = Math.random() < 0.5;
    const table = isWeapon ? WEAPONS : ARMORS;
    const [name, value] = pickOne(table.slice(0, Math.min(table.length, 1 + Math.floor(depth / 3))));
    return { kind: isWeapon ? "weapon" : "armor", name: name, value: value };
  }
  const [name, value] = pickOne(POTIONS.slice(0, Math.min(POTIONS.length, 1 + Math.floor(depth / 4))));
  return { kind: "potion", name: name, value: value };
}


// ===== 六、画面 =====

function statusRows(player) {
  const weapon = player.weapon
    ? GREEN + player.weapon.name + " +" + player.weapon.value + END
    : GREY + "空手" + END;
  const armor = player.armor
    ? GREEN + player.armor.name + " +" + player.armor.value + END
    : GREY + "布衣" + END;
  return [
    "生命 " + bar(player.hp, player.max_hp, 20, RED) + "  金币 " + GOLD + player.gold + END,
    "等级 " + BOLD + player.level + END + "   攻击 " + attackOf(player) + "   防御 " + guardOf(player),
    "经验 " + bar(player.xp, xpNeeded(player.level), 20, CYAN),
    "武器 " + weapon + "   护甲 " + armor,
  ];
}

function renderAdventure(player, log) {
  const rows = [BOLD + "地牢冒险" + END + "   " + GREY + "第 " + player.depth + " 层" + END, SEP];
  rows.push(...statusRows(player));
  rows.push(SEP);
  rows.push(...log.slice(-7).map((line) => GREY + "·" + END + " " + line));
  show(rows);
}

function renderCombat(player, monster, log) {
  const rows = [
    PURPLE + monster.name + END + "   " + GREY + "Lv." + monster.level + END,
    "敌血 " + bar(monster.hp, monster.max_hp, 18, PURPLE),
    SEP,
  ];
  rows.push(...statusRows(player));
  rows.push(SEP);
  rows.push(...log.slice(-6).map((line) => GREY + "·" + END + " " + line));
  show(rows, PURPLE);
}

function itemLine(player, item) {
  if (item.kind === "potion") return GREEN + item.name + END + "  " + GREY + "回复 " + item.value + " 点生命" + END;
  if (item.kind === "weapon") {
    const tag = player.weapon === item ? "  " + CYAN + "已装备" + END : "";
    return GREEN + item.name + END + "  +" + item.value + " 攻击" + tag;
  }
  const tag = player.armor === item ? "  " + CYAN + "已装备" + END : "";
  return GREEN + item.name + END + "  +" + item.value + " 防御" + tag;
}

async function renderBag(player, log) {
  const rows = [BOLD + "背包" + END + "   " + GREY + player.bag.length + "/" + BAG_LIMIT + END, SEP];
  if (player.bag.length) {
    player.bag.forEach((item, i) => rows.push("[" + (i + 1) + "] " + itemLine(player, item)));
  } else {
    rows.push(GREY + "空空如也。" + END);
  }
  rows.push(SEP);
  show(rows, GREEN);
  const choices = numbered(player.bag.map((item) => [null, item.name]));
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

function gainXp(player, amount, log) {
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
  }
}

function victory(player, monster, log) {
  player.kills += 1;
  player.gold += monster.gold;
  add(log, GOLD + "你击败了 " + monster.name + "，拾到 " + monster.gold + " 枚金币。" + END);
  pause(0.6);
  if (Math.random() < 0.28) {
    const item = randomItem(player.depth, Math.random() < 0.45);
    if (player.bag.length < BAG_LIMIT) {
      player.bag.push(item);
      add(log, GREEN + "它还掉落了 " + item.name + "！" + END);
      pause(0.7);
    }
  }
  gainXp(player, monster.xp, log);
}

function playerStrike(player, monster, log, heavy) {
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
    // 普通攻击有一成半的机会打出双倍伤害
    const crit = Math.random() < 0.15;
    const mark = crit ? GOLD + "暴击！" + END + " " : "";
    damage = damageOf(attackOf(player) * (crit ? 2 : 1), 0);
    add(log, mark + "你击中 " + PURPLE + monster.name + END + "，造成 " + GOLD + damage + END + " 点伤害。");
  }
  monster.hp -= damage;
  pause(0.45);
  return monster.hp <= 0;
}

function monsterStrike(player, monster, log) {
  const damage = damageOf(monster.atk, guardOf(player));
  player.hp -= damage;
  add(log, RED + monster.name + " 攻来，你受到 " + damage + " 点伤害。" + END);
  pause(0.45);
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

async function fight(player, monster, log) {
  if (monster.boss && !(await bossWarning(player, monster))) {
    add(log, GREY + "你退回石阶，避开了 " + monster.name + "。" + END);
    pause(0.6);
    return;
  }
  add(log, PURPLE + monster.name + " 挡住了去路！" + END);
  pause(0.6);
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
      if (playerStrike(player, monster, log, false)) { victory(player, monster, log); return; }
    } else {
      if (playerStrike(player, monster, log, true)) { victory(player, monster, log); return; }
    }
    if (player.hp > 0) monsterStrike(player, monster, log);
  }
}

async function bossWarning(player, monster) {
  const rows = [
    BOLD + RED + "首领挡路！" + END, SEP,
    PURPLE + monster.name + END + "   " + GREY + "Lv." + monster.level + END,
    "敌血 " + bar(monster.hp, monster.max_hp, 18, PURPLE),
    "敌攻 " + monster.atk + "   预计每回合承受 " + Math.max(1, monster.atk - guardOf(player)) + " 点",
    SEP,
    "你的 生命 " + player.hp + "/" + player.max_hp + "   攻击 " + attackOf(player) +
      "   防御 " + guardOf(player),
    SEP,
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
    add(log, GREEN + "获得装备：" + item.name + "（+" + item.value + "）" + END);
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
      rows.push("[" + (i + 1) + "] " + itemLine(player, item) + "   " + color + item.price + " 金" + END);
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
