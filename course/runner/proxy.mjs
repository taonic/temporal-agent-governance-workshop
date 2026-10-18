// Reverse proxies from the course's origin to a learner's sandbox, through Daytona's signed
// preview URLs (which can't be framed directly: they send X-Frame-Options, and their cookies
// are third-party inside the course's page).
//
//   the console      /sbx/console/*  on the course's own origin. Its page uses relative
//                    paths, so a prefix works. Chat and session updates stream as SSE.
//   the Temporal UI  every path, on the UI proxy's port: it uses root-absolute paths, so it
//                    needs an origin of its own. Same host, so the session cookie reaches it.
//
// Adapted from the loan-origination course's runner (scripts/course-sandbox-runner.mjs),
// which worked out the cookie, CSP and SvelteKit navigation details for the Temporal UI.
import { Readable } from "node:stream";
import zlib from "node:zlib";

import { SESSION_COOKIE } from "./auth.mjs";

const DROP_REQUEST = new Set(["host", "connection", "content-length", "accept-encoding", "upgrade", "keep-alive"]);
const DROP_RESPONSE = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "set-cookie",
  "location",
]);
const COMPRESSIBLE = /^(?:text\/(?!event-stream)|application\/(?:javascript|json|manifest\+json|xml|wasm)|image\/svg\+xml)/i;

// Hashed assets are identical across sandboxes (same Temporal and harness versions), so one
// cache serves every learner. Bounded, first in first out.
const assetCache = new Map();
const ASSET_CACHE_MAX = 1024;

function acceptsBr(req) {
  return /\bbr\b/i.test(req.headers["accept-encoding"] || "");
}
function acceptsGzip(req) {
  return /\bgzip\b/i.test(req.headers["accept-encoding"] || "");
}

function encode(req, entry) {
  if (entry.compressible) {
    if (acceptsBr(req)) {
      entry.br ??= zlib.brotliCompressSync(entry.body, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 10, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.body.length },
      });
      return { encoding: "br", buf: entry.br };
    }
    if (acceptsGzip(req)) {
      entry.gzip ??= zlib.gzipSync(entry.body);
      return { encoding: "gzip", buf: entry.gzip };
    }
  }
  return { encoding: null, buf: entry.body };
}

function sendBuffered(req, res, status, headers, entry) {
  const { encoding, buf } = encode(req, entry);
  if (encoding) headers["content-encoding"] = encoding;
  headers.vary = "Accept-Encoding";
  headers["content-length"] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : buf);
}

// Inside every Temporal UI page: a loading overlay that removes itself once the SPA renders,
// and a postMessage bridge so the course page can navigate it without a reload. A bare
// .click() fails SvelteKit's which===1 check, hence the constructed MouseEvent. Given a
// workflow (and a tab) instead of a path, it looks up the latest run with the UI's own API. The
// UI writes its history filter to ?category= but doesn't read it back on load (2.50), so for
// history?category=… the loader sets the Filter menu itself.
const UI_LOADER = `<style>
#__course_loading{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;
align-items:center;justify-content:center;gap:14px;background:#1d1d20;color:#e7ebf2;
font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;transition:opacity .25s ease}
#__course_loading .__s{width:30px;height:30px;border-radius:50%;border:3px solid rgba(231,235,242,.25);
border-top-color:#818cf8;animation:__cspin .8s linear infinite}
@keyframes __cspin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){#__course_loading .__s{animation-duration:2s}}
</style>
<div id="__course_loading"><div class="__s"></div><div>Loading the Temporal UI…</div></div>
<script>(function(){var el=document.getElementById('__course_loading');
function done(){if(!el)return;var node=el;el=null;node.style.pointerEvents='none';node.style.opacity='0';setTimeout(function(){if(node.parentNode)node.parentNode.removeChild(node);},250);}
function ready(){return!!document.querySelector('main,nav,header,[data-testid]')||document.body.querySelectorAll('*').length>40;}
function reply(m){try{parent.postMessage(m,'*');}catch(e){}}
var announced=false;function announce(){if(announced)return;announced=true;reply({__course:'ready'});}
if(el){var obs=new MutationObserver(function(){if(ready()){obs.disconnect();done();announce();}});
try{obs.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
setTimeout(function(){if(ready()){obs.disconnect();done();announce();}},400);
setTimeout(function(){try{obs.disconnect();}catch(e){}done();announce();},15000);}else{announce();}
function go(path){try{var root=document.getElementById('svelte')||document.body;var a=document.createElement('a');a.href=path;root.appendChild(a);
var prevented=!a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,button:0}));
setTimeout(function(){if(a.parentNode)a.remove();},0);
reply({__course:prevented?'navok':'navfail',path:path});
}catch(err){reply({__course:'navfail',path:path});}}
var LABELS={activity:'Activity','local-activity':'Local Activity',signal:'Signal',timer:'Timer',update:'Update','child-workflow':'Child Workflow',nexus:'Nexus',workflow:'Workflow',other:'Other'};
function filterTo(cats,tries){var btn=[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.textContent.trim()==='Filter';})[0];
if(!btn){if(tries<40)setTimeout(function(){filterTo(cats,tries+1);},250);return;}
function box(n){return document.querySelector('input[type=checkbox][data-track-text="'+n+'"]');}
function pick(left){cats.forEach(function(c){var b=box(LABELS[c]||c);if(b&&!b.checked)b.click();});
setTimeout(function(){var ok=cats.every(function(c){var b=box(LABELS[c]||c);return b&&b.checked;});if(!ok&&left>0)pick(left-1);else btn.click();},250);}
btn.click();setTimeout(function(){var none=box('None');if(none)none.click();setTimeout(function(){pick(4);},250);},300);}
window.addEventListener('message',function(e){var d=e.data;if(!d||d.__course!=='nav')return;
if(d.workflow){var wf='/namespaces/default/workflows/'+encodeURIComponent(d.workflow);var tab=d.tab||'history';
fetch('/api/v1'+wf).then(function(r){return r.json();}).then(function(j){go(wf+'/'+j.workflowExecutionInfo.execution.runId+'/'+tab);
var m=tab.match(/^history\\?category=([\\w,-]+)/);if(m)setTimeout(function(){filterTo(m[1].split(','),0);},300);})
.catch(function(){reply({__course:'navfail',path:wf});});return;}
if(d.path)go(d.path);});})();</script>`;

function injectUiLoader(html) {
  // The page's CSP meta (strict-dynamic) would block the injected script.
  const stripped = html.replace(/<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
  const match = stripped.match(/<body[^>]*>/i);
  return match ? stripped.replace(match[0], match[0] + UI_LOADER) : UI_LOADER + stripped;
}

function withoutSessionCookie(header) {
  if (!header) return undefined;
  const kept = header
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${SESSION_COOKIE}=`))
    .join("; ");
  return kept || undefined;
}

// Forwards one request to `${base}${path}`. Options:
//   cacheable(path)  hashed assets to keep in the shared cache
//   rewriteHtml      transforms HTML documents (the Temporal UI's loader)
//   mountPrefix      where this proxy is mounted, for rewriting redirects
export async function proxyRequest(req, res, { base, path, cacheable = () => false, rewriteHtml = null, mountPrefix = "" }) {
  const isRead = req.method === "GET" || req.method === "HEAD";
  const pathname = path.split("?")[0];
  const cacheKey = `${new URL(base).port || "443"}${pathname}`;
  if (isRead && cacheable(pathname)) {
    const hit = assetCache.get(cacheKey);
    if (hit) return sendBuffered(req, res, 200, { "content-type": hit.contentType, "cache-control": "public, max-age=31536000, immutable" }, hit);
  }

  const headers = { "x-daytona-skip-preview-warning": "true" };
  for (const [key, value] of Object.entries(req.headers)) {
    if (!DROP_REQUEST.has(key.toLowerCase()) && key.toLowerCase() !== "cookie") headers[key] = value;
  }
  const cookie = withoutSessionCookie(req.headers.cookie);
  if (cookie) headers.cookie = cookie;

  let body;
  if (!isRead) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const upstream = await fetch(`${base}${path}`, { method: req.method, headers, body, redirect: "manual", signal: controller.signal });

  const out = {};
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE.has(key.toLowerCase())) out[key] = value;
  });
  const location = upstream.headers.get("location");
  if (location) {
    const relative = location.startsWith(base) ? location.slice(base.length) || "/" : location;
    out.location = relative.startsWith("/") ? `${mountPrefix}${relative}` : relative;
  }
  const cookies = (upstream.headers.getSetCookie?.() ?? []).map((c) =>
    c.replace(/;\s*Domain=[^;]*/i, "").replace(/;\s*Secure/i, "").replace(/;\s*Path=\//i, `; Path=${mountPrefix || "/"}`),
  );
  if (cookies.length) out["set-cookie"] = cookies;

  const contentType = upstream.headers.get("content-type") || "";
  const compressible = upstream.status === 200 && COMPRESSIBLE.test(contentType);

  if (isRead && upstream.status === 200 && cacheable(pathname)) {
    const entry = { contentType, body: Buffer.from(await upstream.arrayBuffer()), compressible };
    if (assetCache.size >= ASSET_CACHE_MAX) assetCache.delete(assetCache.keys().next().value);
    assetCache.set(cacheKey, entry);
    return sendBuffered(req, res, 200, { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" }, entry);
  }

  if (rewriteHtml && upstream.status === 200 && /\btext\/html\b/i.test(contentType)) {
    const html = Buffer.from(rewriteHtml(Buffer.from(await upstream.arrayBuffer()).toString("utf8")), "utf8");
    return sendBuffered(req, res, upstream.status, out, { body: html, compressible: true });
  }

  if (/text\/event-stream/i.test(contentType)) {
    out["cache-control"] = "no-cache, no-transform";
    out["x-accel-buffering"] = "no";
  }
  const gzip = compressible && acceptsGzip(req) && upstream.body && req.method !== "HEAD";
  if (gzip) {
    out["content-encoding"] = "gzip";
    out.vary = "Accept-Encoding";
  }
  res.writeHead(upstream.status, out);
  if (!upstream.body || req.method === "HEAD") return res.end();
  res.flushHeaders?.();
  const source = Readable.fromWeb(upstream.body);
  source.on("error", () => res.destroy());
  if (gzip) source.pipe(zlib.createGzip()).pipe(res);
  else source.pipe(res);
}

export const temporalUi = {
  cacheable: (pathname) => pathname.startsWith("/_app/immutable/"),
  rewriteHtml: injectUiLoader,
};

export const harnessConsole = {
  cacheable: (pathname) => /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(pathname),
};
