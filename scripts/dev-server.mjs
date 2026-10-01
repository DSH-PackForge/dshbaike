#!/usr/bin/env node
/**
 * dev-server.mjs —— 零依赖静态服务器，用于本地预览构建产物。
 *
 * 用法：
 *   node scripts/build.mjs && node scripts/dev-server.mjs          # 默认 127.0.0.1:8811，服务 web/
 *   node scripts/dev-server.mjs 9000                               # 换端口
 *   node scripts/dev-server.mjs 9000 --dir web --host 0.0.0.0      # 换目录 / 换监听地址
 *
 * 为什么不用 `npx serve`：这个仓库的取向是零第三方依赖、离线可跑；贡献者在断网或
 * 无 npm 缓存时也应该能预览。它只做静态文件 + 目录 index，不执行任何构建。
 *
 * 注意：它**不做目录列表**、**不允许路径穿越**，也**不隐藏** web/data 下的构建产物——
 * 预览时前端就是要读它们。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function parseArgs(argv) {
  const out = { port: 8811, dir: 'web', host: '127.0.0.1', prefix: '/' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // 同时支持 `--prefix=X` 与 `--prefix X`：只认后者的话，前者会被静默忽略，
    // 于是「本地明明复现不了线上问题」——这种错很难看出来，所以两种都收。
    const eq = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (eq) {
      if (eq[1] === 'dir') out.dir = eq[2];
      else if (eq[1] === 'host') out.host = eq[2];
      else if (eq[1] === 'prefix') out.prefix = eq[2];
      else {
        process.stderr.write(`不认识的选项：${arg}\n`);
        process.exit(2);
      }
      continue;
    }
    if (arg === '--dir') out.dir = argv[++i] ?? out.dir;
    else if (arg === '--host') out.host = argv[++i] ?? out.host;
    else if (arg === '--prefix') out.prefix = argv[++i] ?? out.prefix;
    else if (/^\d+$/.test(arg)) out.port = Number(arg);
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('用法：node scripts/dev-server.mjs [port] [--dir=web] [--host=127.0.0.1] [--prefix=/dshbaike/]\n');
      process.exit(0);
    } else {
      process.stderr.write(`不认识的选项：${arg}\n`);
      process.exit(2);
    }
  }
  // 统一成前后带斜杠；`/` 表示挂在根
  out.prefix = out.prefix === '/' ? '/' : `/${String(out.prefix).replace(/^\/+/, '').replace(/\/+$/, '')}/`;
  return out;
}

const { port, dir, host, prefix } = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(REPO_ROOT, dir);

if (!fs.existsSync(rootDir)) {
  process.stderr.write(`目录不存在：${rootDir}\n先跑：node scripts/build.mjs\n`);
  process.exit(2);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('400 请求路径无法解析');
    return;
  }

  // 子路径前缀：模拟 GitHub Pages 的项目站（/dshbaike/），用来在本地复现
  // 「部署根写错」这类只在子路径下暴露的问题（例如前端把 ./ 塌成 / 去取 data/*.json）。
  if (prefix !== '/') {
    if (pathname === prefix.slice(0, -1)) {
      res.writeHead(302, { location: prefix + (req.url.includes('#') ? '' : '') });
      res.end();
      return;
    }
    if (!pathname.startsWith(prefix)) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>404</title>
<body style="font:14px system-ui;padding:40px">
<h1 style="font-size:18px">404 这个服务器只在 ${prefix} 下提供站点</h1>
<p>你请求的是 <code>${pathname}</code>。试试 <a href="${prefix}">${prefix}</a>。</p>`);
      return;
    }
    pathname = '/' + pathname.slice(prefix.length);
  }

  // 路径穿越防护：解析后必须仍在 rootDir 之内
  const target = path.resolve(rootDir, `.${pathname}`);
  if (target !== rootDir && !target.startsWith(rootDir + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 越界');
    return;
  }

  const send = (code, file, body) => {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(code, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  };

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      // 目录 → 试 index.html
      const indexPath = path.join(stat?.isDirectory() ? target : target, 'index.html');
      fs.readFile(indexPath, (err2, buf) => {
        if (err2) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>404</title>
<body style="font:14px system-ui;padding:40px">
<h1 style="font-size:18px">404 找不到这个页面</h1>
<p><code>${pathname}</code> 不在构建产物里。</p>
<p>可能是还没构建（<code>node scripts/build.mjs</code>），或者编号不存在。</p>
<p><a href="/">回首页</a></p>`);
          return;
        }
        send(200, indexPath, buf);
      });
      return;
    }
    fs.readFile(target, (err3, buf) => {
      if (err3) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('500 读文件失败');
        return;
      }
      send(200, target, buf);
    });
  });
});

server.listen(port, host, () => {
  const where = prefix === '/' ? '' : prefix;
  process.stdout.write(`静态预览已启动：http://${host}:${port}${where}  （根目录 ${path.relative(REPO_ROOT, rootDir) || '.'}，前缀 ${prefix}）\n`);
  process.stdout.write('Ctrl+C 停止。这个服务器只读文件，不做构建。\n');
});
