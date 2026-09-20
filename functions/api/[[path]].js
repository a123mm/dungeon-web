// ============================================================================
// 地牢游戏的后端：注册、登录、存档、读档。这一个文件管住所有 /api/... 的网址。
//
// 文件名两边的方括号是 Cloudflare 的规矩，意思是"/api/ 底下的任何网址都归我管"。
// 网页文件（index.html）是另一个文件，由 Pages 自己发，不归它管。
//
// 四个接口：
//   POST /api/register    → 注册
//   POST /api/login       → 登录
//   POST /api/save        → 存档
//   GET  /api/load?slot=1 → 读档
//
// 用之前要先在这个 Pages 项目里加一个 D1 绑定，变量名必须正好是 DB。
// ============================================================================


// ============================================================================
// 一、密码怎么加密
// ============================================================================

// PBKDF2 要重复算多少次。越多越难破解，但每次登录也越慢。
// 10 万次大约 0.1 秒，人感觉不出来，坏人却要多花几十万倍的时间。
const ITERATIONS = 100000;

// 令牌有效期：30 天，过期要重新登录
const TOKEN_DAYS = 30;

// 数据库只能存文本，但盐和哈希是二进制，所以要转成 base64 文本
function toBase64(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// 把密码变成一串哈希存进数据库。
//
// 为什么不用简单好懂的 SHA-256？因为 SHA-256 算得太快，坏人偷走数据库后
// 用普通电脑一秒能试几十亿个密码，简单密码几秒就破。
// PBKDF2 故意算得慢（重复 10 万次），而且给每个人随机加不同的"盐"，
// 这样就算两个人密码一样，存进去的哈希也不一样。
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));          // 16 字节随机盐
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);

  // 算法名、次数、盐、结果一起存成字符串。
  // 存了次数，以后想调大次数，老用户的密码照样能验证。
  return 'pbkdf2$' + ITERATIONS + '$' + toBase64(salt) + '$' + toBase64(new Uint8Array(bits));
}

// 验证密码：用数据库里存的盐和次数，把用户输入的密码再算一遍，然后对比
async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts[0] !== 'pbkdf2') return false;                          // 格式不认识
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(parts[2]), iterations: Number(parts[1]), hash: 'SHA-256' },
    key, 256);
  return sameBytes(new Uint8Array(bits), fromBase64(parts[3]));
}

// 逐字节比较，并且不管第几个字节不一样、花的时间都一样
// （不然坏蛋能根据"回得快还是慢"猜出密码对了几个字）
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}


// ============================================================================
// 二、小工具
// ============================================================================

// 生成令牌。randomUUID 生成的东西长这样：3f2a1b4c-...-...，几乎不可能重复。
function newToken() {
  return crypto.randomUUID();
}

// 统一格式的 JSON 回复，省得每个接口都写一遍
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// 读请求体里的 JSON。前端要是发了个坏东西，返回 null 让接口去报错，不要直接崩。
async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// 看这个请求是谁发的。
// 前端发请求时带了 Authorization: Bearer 3f2a...，这里拿它去数据库查人。
// 查得到、没过期 → 返回 {id, username}；否则返回 null（接口就该回 401）。
async function currentUser(request, db) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;       // 压根没带令牌
  const token = header.slice(7).trim();                 // 去掉 'Bearer ' 这 7 个字符
  if (!token) return null;

  const row = await db
    .prepare('SELECT id, username, token_expires FROM users WHERE token = ?')
    .bind(token)
    .first();

  if (!row) return null;                                        // 令牌是假的
  if (!row.token_expires || row.token_expires < Date.now()) return null;   // 过期了
  return row;
}


// ============================================================================
// 三、四个接口
// ============================================================================

// 注册：请求体 { username, password }
async function register(request, env) {
  const body = await readJson(request);
  if (body === null) return json({ error: '请发送 JSON 格式的请求体' }, 400);

  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');

  // 用户名会显示给别人看，限制成 3~20 个字母、数字、下划线，免得乱填符号出怪问题
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return json({ error: '用户名要是 3~20 个字母、数字或下划线' }, 400);
  }
  // 密码长度比复杂度更重要，所以只要求至少 6 位
  if (password.length < 6) {
    return json({ error: '密码至少 6 位' }, 400);
  }

  const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username).first();
  if (exists) return json({ error: '这个用户名已经有人用了' }, 409);

  // 注册成功就直接给令牌，前端不用再登录一次
  const token = newToken();
  const expires = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;

  try {
    await env.DB
      .prepare('INSERT INTO users (username, password_hash, token, token_expires) VALUES (?, ?, ?, ?)')
      .bind(username, await hashPassword(password), token, expires)
      .run();
  } catch (error) {
    // 万一两个人同时注册同一个名字（上面那个 exists 都查到没有），
    // 数据库的 UNIQUE 规则会拦下第二个，这里把那个错误变成好懂的提示
    return json({ error: '注册失败：' + error.message }, 409);
  }

  return json({ ok: true, username: username, token: token });
}

// 登录：请求体 { username, password }
async function login(request, env) {
  const body = await readJson(request);
  if (body === null) return json({ error: '请发送 JSON 格式的请求体' }, 400);

  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');

  const user = await env.DB
    .prepare('SELECT id, password_hash FROM users WHERE username = ?')
    .bind(username)
    .first();

  // 用户名不存在 和 密码不对，回复同一句话。
  // 这样坏人就猜不出"这个名字到底注册过没有"。
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: '用户名或密码不对' }, 401);
  }

  // 换一个新令牌（旧的自动作废）。
  // 副作用：同一个账号只有一台设备在线，另一台会被挤下线。
  const token = newToken();
  const expires = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  await env.DB
    .prepare('UPDATE users SET token = ?, token_expires = ? WHERE id = ?')
    .bind(token, expires, user.id)
    .run();

  return json({ ok: true, username: username, token: token });
}

// 存档：请求体 { slot, data }
async function save(request, env) {
  // 先验证身份。没登录就没收，别人存不到你的档。
  const user = await currentUser(request, env.DB);
  if (!user) return json({ error: '没有登录，或者登录过期了，请重新登录' }, 401);

  const body = await readJson(request);
  if (body === null) return json({ error: '请发送 JSON 格式的请求体' }, 400);

  const slot = Number(body.slot ?? 1);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    return json({ error: '槽位只能是 1、2、3' }, 400);
  }

  // 游戏状态转成 JSON 文本。顺便查大小：1 MB 对存档来说绰绰有余，超了肯定是发错了。
  const text = JSON.stringify(body.data ?? null);
  if (text.length > 1024 * 1024) return json({ error: '存档太大（超过 1 MB）' }, 413);

  // 写入数据库。ON CONFLICT 那句的意思是：这个用户这个槽位已经有行了，就改成新的。
  // 注意 user_id 是从令牌查出来的，不是前端传的 —— 所以谁也没法改别人的存档。
  await env.DB
    .prepare('INSERT INTO saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, datetime(\'now\'))' +
             ' ON CONFLICT(user_id, slot) DO UPDATE SET data = excluded.data, updated_at = datetime(\'now\')')
    .bind(user.id, slot, text)
    .run();

  return json({ ok: true, slot: slot });
}

// 读档：网址里带 ?slot=1
async function load(request, env) {
  const user = await currentUser(request, env.DB);
  if (!user) return json({ error: '没有登录，或者登录过期了，请重新登录' }, 401);

  // 网址里 ?slot=2 这样带过来，没写就当 1
  const slot = Number(new URL(request.url).searchParams.get('slot') ?? 1);

  // 只查自己的：WHERE user_id = ? 用的是令牌查出来的 id，
  // 所以就算把网址里的数字改成别人的 id 也读不到别人的东西。
  const row = await env.DB
    .prepare('SELECT data, updated_at FROM saves WHERE user_id = ? AND slot = ?')
    .bind(user.id, slot)
    .first();

  if (!row) return json({ ok: true, slot: slot, data: null });   // 这个槽还没存过

  return json({ ok: true, slot: slot, data: JSON.parse(row.data), updated_at: row.updated_at });
}


// ============================================================================
// 四、总入口
// Cloudflare 每收到一个 /api/... 的请求都会调用这个函数。
// 网页文件（index.html）由 Pages 自己发出去，不会进这里。
// ============================================================================
export async function onRequest({ request, env }) {
  const path = new URL(request.url).pathname;
  const route = request.method + ' ' + path;

  // 数据库还没绑定时说清楚，不然打开网页只会看到一个莫名其妙的 500
  if (!env.DB) {
    return json({ error: '数据库还没绑定：去项目的 Settings → Functions → D1 database bindings，加一个，变量名填 DB' }, 500);
  }

  if (route === 'POST /api/register') return register(request, env);
  if (route === 'POST /api/login')    return login(request, env);
  if (route === 'POST /api/save')     return save(request, env);
  if (route === 'GET /api/load')      return load(request, env);

  return json({ error: '没有这个接口：' + route }, 404);
}
