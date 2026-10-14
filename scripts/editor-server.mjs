/**
 * 参数世界 · 本地服务（展示站点 + 后台录入 + 用户纠错待审队列）
 *
 * 三个角色，一个进程：
 * 1. **展示站点**：构建后的 dist/（Vue SPA，hash 路由）。起服务后直接浏览官网数据。
 * 2. **后台录入**（/editor）：overrides-editor.html，管理员直写 data/overrides.json。
 * 3. **用户纠错待审队列**（公开）：展示页上的「纠错/补充数据」表单 POST /api/submit，
 *    条目进入 data/submissions.json（status=pending）；管理员在 /editor 审核区
 *    「采用」→ 转成正式 override 写入 data/overrides.json，「驳回」→ 留痕。
 *    用户写完管理员**只需审核一遍**，不需要重写任何 JSON。
 *
 * 数据流（与 overrides 层一致的纪律）：
 *   用户提交 → submissions.json (pending)
 *            → 管理员采用 → overrides.json (active) → npm run data 合并进站点
 *   管线（npm run data）**从不写**这两个文件，它们是纯人工输入——
 *   官网每轮同步重新应用 overrides，官网刷新不会冲掉人工值。
 *
 * 设计纪律：
 * 1. **服务端权威校验**：提交与采用都过 `validateOverrides` 全量校验
 *    （机型存在 / 字段已注册 / 值类型·区间合法 / reason 必填 / id 不重复）。
 *    写错一律 4xx 拒绝，绝不静默失效。
 * 2. **原子写回 + 备份**：先 .bak 再 .tmp → rename 覆盖，中途崩了不留半截 JSON。
 * 3. **公开面最小化**：/api/submit 是唯一面向公网安全的接口——只追加、
 *    只收 set-field、20KB 限长、单 IP 限频、内容转义到后台才渲染。
 *    /api/overrides/* 与 /api/submissions/*（审核写权）必须留在内网：
 *    部署时用反向代理只暴露 / 与 /api/submit，其余全部拒绝。
 * 4. **零外部依赖**：只用 Node 内置 http/fs/path，不引入 express 之类。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import http from 'node:http';
import { join, resolve, dirname, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOverrides, validateOverrides } from './lib/overrides.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
// 后台录入页刻意放 admin/ 而非 public/：public/ 会被 vite 原样拷进 dist 发布到线上，
// 管理界面与字段结构不应随静态站点暴露（无后端写不进去，但界面本身是信息）。
// 2026-10-13 审计 Q1 裁决：移出 public/。
const ADMIN_EDITOR = join(ROOT, 'admin', 'overrides-editor.html');
const DIST_DIR = join(ROOT, 'dist');
const OVERRIDES_FILE = join(DATA_DIR, 'overrides.json');
const SUBMISSIONS_FILE = join(DATA_DIR, 'submissions.json');
const PORT = Number(process.env.PORT) || 5174;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  // Buffer（二进制资产：png/woff2/…）与 string 原样发送；对象才做 JSON 序列化。
  // 读文件不指定 utf8 会得到 Buffer——若走 JSON.stringify 会把整个文件变成
  // {"type":"Buffer","data":[…]}，站点 HTML/字体/图片全部损坏（端到端测试抓到过）。
  const payload =
    typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2) + '\n';
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(payload);
}

/** 防目录穿越：把请求路径拼到 base 下，确认没逃出 base */
function safeJoin(base, rel) {
  const target = normalize(join(base, rel));
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** 原子写回（overrides / submissions 通用）：备份当前 → .tmp → rename 覆盖 */
async function writeJsonAtomic(file, next) {
  if (existsSync(file)) {
    await rename(file, file + '.bak').catch(() => {});
  }
  await writeFile(file + '.tmp', JSON.stringify(next, null, 2) + '\n', 'utf8');
  await rename(file + '.tmp', file);
}

function readBody(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) {
        req.destroy();
        reject(new Error(`请求体过大（>${limit} 字节）`));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* 待审队列（submissions）                                              */
/* ------------------------------------------------------------------ */

function loadSubmissions() {
  if (!existsSync(SUBMISSIONS_FILE)) return { submissions: [] };
  const parsed = JSON.parse(readFileSync(SUBMISSIONS_FILE, 'utf8'));
  return {
    submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
  };
}

/* 简易滑动窗口限频：单 IP 10 分钟内最多 10 次提交（够正常纠错，挡灌水） */
const hits = new Map();
function rateLimited(ip, max = 10, windowMs = 10 * 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear(); // 防地图本身被撑爆
  return arr.length > max;
}

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

/** 公开提交：只收 set-field；服务端补 id/时间/来源/状态后全量校验 */
async function handleSubmit(req, res) {
  const ip = req.socket.remoteAddress ?? 'unknown';
  if (rateLimited(ip)) {
    return send(res, 429, { ok: false, errors: ['提交过于频繁，请 10 分钟后再试'] });
  }
  let raw;
  try {
    raw = await readBody(req, 20_000);
  } catch (e) {
    return send(res, 400, { ok: false, errors: [e.message] });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return send(res, 400, { ok: false, errors: ['请求体不是合法 JSON：' + e.message] });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return send(res, 400, { ok: false, errors: ['提交内容必须是对象'] });
  }
  if (body.op !== 'set-field') {
    return send(res, 400, { ok: false, errors: ['公开提交只接受 op=set-field（新增整机走联系渠道）'] });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return send(res, 400, { ok: false, errors: ['缺 reason（请说明数据来源，如官网/实测/评测）'] });
  if (reason.length > 500) return send(res, 400, { ok: false, errors: ['reason 过长（>500 字符）'] });
  const submittedBy = typeof body.submittedBy === 'string' ? body.submittedBy.trim().slice(0, 40) : '';

  const entry = {
    id: genId('sub'),
    op: 'set-field',
    productId: String(body.productId ?? ''),
    field: String(body.field ?? ''),
    value: body.value,
    reason,
    source: 'user-submission',
    submittedBy: submittedBy || '匿名',
    submittedAt: new Date().toISOString(),
    createdAt: todayISO(),
    status: 'pending',
  };

  const store = loadSubmissions();
  // 同一 (productId, field, value) 已有 pending → 409（挡重复灌水，不挡纠错）
  const dup = store.submissions.find(
    (s) => s.status === 'pending' && s.productId === entry.productId && s.field === entry.field &&
      JSON.stringify(s.value) === JSON.stringify(entry.value),
  );
  if (dup) {
    return send(res, 409, { ok: false, errors: [`该字段已有一条相同内容的待审提交（${dup.id}），请等待审核`] });
  }

  // 与 overrides 同一套权威校验：机型存在 / 字段注册 / 值类型区间合法
  let products = [];
  try {
    const pj = await readJson(join(DATA_DIR, 'products.json'));
    products = pj.products ?? pj;
  } catch {
    /* products 缺失时 validateOverrides 会报「机型不存在」，不会静默通过 */
  }
  const errors = validateOverrides({ version: 0, entries: [entry] }, products);
  if (errors.length) return send(res, 400, { ok: false, errors });

  store.submissions.push(entry);
  await writeJsonAtomic(SUBMISSIONS_FILE, store);
  return send(res, 200, {
    ok: true,
    id: entry.id,
    message: '已进入待审队列，管理员审核通过后生效。感谢纠错！',
  });
}

/** 管理员：采用 pending → 转正式 override（active）写入 overrides.json */
async function handleApprove(req, res, id) {
  let note = '';
  try {
    const body = JSON.parse(await readBody(req, 2_000) || '{}');
    note = typeof body.note === 'string' ? body.note.slice(0, 300) : '';
  } catch {
    /* 无 body 也允许 */
  }
  const store = loadSubmissions();
  const sub = store.submissions.find((s) => s.id === id);
  if (!sub) return send(res, 404, { ok: false, errors: ['提交不存在：' + id] });
  if (sub.status !== 'pending') {
    return send(res, 409, { ok: false, errors: [`该提交已处理过（${sub.status}），不能重复采用`] });
  }

  const ovEntry = {
    id: 'ovr-' + sub.id.slice(4), // sub-xxx → ovr-xxx，可追溯回原提交
    op: sub.op,
    productId: sub.productId,
    field: sub.field,
    value: sub.value,
    reason: `${sub.reason}${sub.submittedBy ? `（网友 ${sub.submittedBy} 提交）` : '（网友提交）'}`,
    createdBy: 'user-submission',
    createdAt: sub.createdAt,
    active: true,
  };
  const current = loadOverrides(OVERRIDES_FILE);
  let products = [];
  try {
    const pj = await readJson(join(DATA_DIR, 'products.json'));
    products = pj.products ?? pj;
  } catch {
    /* 同上 */
  }
  const merged = { version: current.version, entries: [...current.entries, ovEntry] };
  const errors = validateOverrides(merged, products);
  if (errors.length) return send(res, 400, { ok: false, errors });

  await writeJsonAtomic(OVERRIDES_FILE, merged);
  sub.status = 'approved';
  sub.reviewedAt = new Date().toISOString();
  sub.reviewNote = note || '已采用，转为正式 override';
  sub.overrideId = ovEntry.id;
  await writeJsonAtomic(SUBMISSIONS_FILE, store);
  return send(res, 200, {
    ok: true,
    entry: ovEntry,
    message: `已采用并写入 data/overrides.json（${ovEntry.id}）。跑 npm run data 同步后站点生效。`,
  });
}

/** 管理员：驳回（留痕不生效） */
async function handleReject(req, res, id) {
  let note = '';
  try {
    const body = JSON.parse(await readBody(req, 2_000) || '{}');
    note = typeof body.note === 'string' ? body.note.slice(0, 300) : '';
  } catch {
    /* 无 body 也允许 */
  }
  const store = loadSubmissions();
  const sub = store.submissions.find((s) => s.id === id);
  if (!sub) return send(res, 404, { ok: false, errors: ['提交不存在：' + id] });
  if (sub.status !== 'pending') {
    return send(res, 409, { ok: false, errors: [`该提交已处理过（${sub.status}）`] });
  }
  sub.status = 'rejected';
  sub.reviewedAt = new Date().toISOString();
  sub.reviewNote = note || '已驳回';
  await writeJsonAtomic(SUBMISSIONS_FILE, store);
  return send(res, 200, { ok: true, message: '已驳回（原记录保留留痕）' });
}

/** 管理员：导入用户从无后端环境（B 站 Toy 等纯静态托管）发来的标准模板 → 待审队列 */
async function handleImport(req, res) {
  let raw;
  try {
    raw = await readBody(req, 50_000);
  } catch (e) {
    return send(res, 400, { ok: false, errors: [e.message] });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return send(res, 400, { ok: false, errors: ['粘贴内容不是合法 JSON：' + e.message] });
  }
  const items = Array.isArray(body)
    ? body
    : Array.isArray(body?.entries)
      ? body.entries
      : body && typeof body === 'object' && body.op
        ? [body]
        : null;
  if (!items || !items.length) {
    return send(res, 400, { ok: false, errors: ['请粘贴用户提交的标准模板（单条对象或数组）'] });
  }
  if (items.length > 20) {
    return send(res, 400, { ok: false, errors: ['一次最多导入 20 条'] });
  }

  const store = loadSubmissions();
  let products = [];
  try {
    const pj = await readJson(join(DATA_DIR, 'products.json'));
    products = pj.products ?? pj;
  } catch {
    /* products 缺失时 validateOverrides 会报「机型不存在」 */
  }

  const accepted = [];
  const skipped = [];
  for (const it of items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      skipped.push({ item: JSON.stringify(it)?.slice(0, 60), why: '不是对象' });
      continue;
    }
    if (it.op !== 'set-field') {
      skipped.push({ item: it.productId ?? JSON.stringify(it).slice(0, 60), why: '公开导入只收 set-field' });
      continue;
    }
    const reason = typeof it.reason === 'string' ? it.reason.trim() : '';
    if (!reason) {
      skipped.push({ item: it.productId ?? '?', why: '缺 reason（数据来源必填）' });
      continue;
    }
    const entry = {
      id: genId('sub'),
      op: 'set-field',
      productId: String(it.productId ?? ''),
      field: String(it.field ?? ''),
      value: it.value,
      reason: reason.slice(0, 500),
      source: 'user-submission',
      submittedBy: (typeof it.submittedBy === 'string' ? it.submittedBy.trim().slice(0, 40) : '') || '匿名',
      submittedAt: typeof it.submittedAt === 'string' ? it.submittedAt : new Date().toISOString(),
      createdAt:
        typeof it.createdAt === 'string' && !Number.isNaN(Date.parse(it.createdAt))
          ? it.createdAt
          : todayISO(),
      status: 'pending',
      importedAt: new Date().toISOString(),
    };
    const dup = store.submissions.find(
      (s) =>
        s.status === 'pending' &&
        s.productId === entry.productId &&
        s.field === entry.field &&
        JSON.stringify(s.value) === JSON.stringify(entry.value),
    );
    if (dup) {
      skipped.push({ item: `${entry.productId} · ${entry.field}`, why: `已有相同待审提交（${dup.id}）` });
      continue;
    }
    const errors = validateOverrides({ version: 0, entries: [entry] }, products);
    if (errors.length) {
      skipped.push({ item: `${entry.productId} · ${entry.field}`, why: errors.join('；') });
      continue;
    }
    store.submissions.push(entry);
    accepted.push(entry.id);
  }
  if (!accepted.length) {
    return send(res, 400, { ok: false, errors: ['没有任何条目通过校验'], detail: skipped });
  }
  await writeJsonAtomic(SUBMISSIONS_FILE, store);
  return send(res, 200, {
    ok: true,
    accepted,
    skipped,
    message: `已导入 ${accepted.length} 条进待审队列${skipped.length ? `，跳过 ${skipped.length} 条` : ''}`,
  });
}

/* ------------------------------------------------------------------ */
/* API 路由                                                            */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  // —— 公开：用户纠错提交 ——
  if (req.method === 'POST' && url.pathname === '/api/submit') {
    return handleSubmit(req, res);
  }

  // —— 管理员：overrides 直写 ——
  if (req.method === 'GET' && url.pathname === '/api/overrides') {
    return send(res, 200, loadOverrides(OVERRIDES_FILE));
  }

  if (req.method === 'POST' && url.pathname === '/api/overrides/entry') {
    let raw;
    try {
      raw = await readBody(req, 1_000_000);
    } catch (e) {
      return send(res, 400, { ok: false, errors: [e.message] });
    }
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch (e) {
      return send(res, 400, { ok: false, errors: ['请求体不是合法 JSON：' + e.message] });
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return send(res, 400, { ok: false, errors: ['entry 必须是对象'] });
    }
    if (!entry.id) entry.id = 'ovr-' + Date.now();
    if (!entry.createdAt) entry.createdAt = todayISO();
    entry.active = entry.active !== false;

    const current = loadOverrides(OVERRIDES_FILE);
    let products = [];
    try {
      const pj = await readJson(join(DATA_DIR, 'products.json'));
      products = pj.products ?? pj;
    } catch {
      /* products 缺失时 validateOverrides 会报「机型不存在」 */
    }
    const merged = { version: current.version, entries: [...current.entries, entry] };
    const errors = validateOverrides(merged, products);
    if (errors.length) return send(res, 400, { ok: false, errors });

    await writeJsonAtomic(OVERRIDES_FILE, merged);
    return send(res, 200, {
      ok: true,
      entry,
      message:
        '已写入 data/overrides.json（provenance 将在合并时自动标 user-manual）。运行 npm run data 同步后即生效，官网刷新不会冲掉。',
    });
  }

  const mDisable = url.pathname.match(/^\/api\/overrides\/entry\/([^/]+)\/disable$/);
  if (req.method === 'POST' && mDisable) {
    const id = decodeURIComponent(mDisable[1]);
    const current = loadOverrides(OVERRIDES_FILE);
    const idx = current.entries.findIndex((e) => e.id === id);
    if (idx < 0) return send(res, 404, { ok: false, errors: ['条目不存在：' + id] });
    current.entries[idx] = { ...current.entries[idx], active: false };
    await writeJsonAtomic(OVERRIDES_FILE, current);
    return send(res, 200, { ok: true, message: '已软删除（active=false，原记录保留留痕）' });
  }

  // —— 管理员：待审队列 ——
  if (req.method === 'GET' && url.pathname === '/api/submissions') {
    return send(res, 200, loadSubmissions());
  }

  if (req.method === 'POST' && url.pathname === '/api/submissions/import') {
    return handleImport(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/submissions/export') {
    const store = loadSubmissions();
    return send(res, 200, store, MIME['.json'], {
      'Content-Disposition': `attachment; filename="submissions-${todayISO()}.json"`,
    });
  }

  const mApprove = url.pathname.match(/^\/api\/submissions\/([^/]+)\/approve$/);
  if (req.method === 'POST' && mApprove) {
    return handleApprove(req, res, decodeURIComponent(mApprove[1]));
  }

  const mReject = url.pathname.match(/^\/api\/submissions\/([^/]+)\/reject$/);
  if (req.method === 'POST' && mReject) {
    return handleReject(req, res, decodeURIComponent(mReject[1]));
  }

  return send(res, 404, { ok: false, errors: ['未知接口：' + url.pathname] });
}

/* ------------------------------------------------------------------ */
/* 静态服务：dist（展示站点）+ /editor（后台）+ /data（数据）             */
/* ------------------------------------------------------------------ */

async function serveFile(res, file, code = 200) {
  const ext = extname(file);
  return send(res, code, await readFile(file), MIME[ext] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    // /data/<path> → DATA_DIR（编辑器/表单读 schemas / categories / products）
    if (url.pathname.startsWith('/data/')) {
      const target = safeJoin(DATA_DIR, url.pathname.slice('/data/'.length));
      if (!target) return send(res, 400, '非法路径', 'text/plain; charset=utf-8');
      if (!existsSync(target) || !statSync(target).isFile()) {
        return send(res, 404, '未找到：' + url.pathname, 'text/plain; charset=utf-8');
      }
      return serveFile(res, target);
    }

    // /editor → 后台录入（管理员直写 overrides）
    if (url.pathname === '/editor' || url.pathname === '/editor/') {
      if (existsSync(ADMIN_EDITOR)) return serveFile(res, ADMIN_EDITOR);
      return send(res, 404, '未找到 overrides-editor.html（应在 admin/ 下）', 'text/plain; charset=utf-8');
    }

    // dist 静态文件（展示站点构建产物）
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const target = safeJoin(DIST_DIR, rel);
    if (target && existsSync(target) && statSync(target).isFile()) {
      return serveFile(res, target);
    }

    // SPA 兜底：hash 路由只会有 '/'，但裸路径（无扩展名）也回 index.html
    const indexHtml = join(DIST_DIR, 'index.html');
    if (!extname(url.pathname) && existsSync(indexHtml)) {
      return serveFile(res, indexHtml);
    }

    // 没构建过 dist：根路径降级到后台编辑器（老行为）
    if (url.pathname === '/') {
      if (existsSync(ADMIN_EDITOR)) return serveFile(res, ADMIN_EDITOR);
    }

    return send(res, 404, '未找到：' + url.pathname, 'text/plain; charset=utf-8');
  } catch (e) {
    return send(res, 500, { ok: false, errors: [e.message] });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `\n参数世界 · 本地服务已启动\n` +
      `  ➜ 展示站点   http://${HOST}:${PORT}/\n` +
      `  ➜ 后台录入   http://${HOST}:${PORT}/editor\n` +
      `  ➜ 用户纠错   展示页「纠错/补充数据」按钮 → /api/submit（待审队列）\n` +
      `  （本机专用；部署时只公开 / 与 /api/submit，其余接口留在内网。Ctrl+C 退出）\n`,
  );
});
