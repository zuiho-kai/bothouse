#!/usr/bin/env -S uv run -q --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["ddgs", "trafilatura", "requests", "beautifulsoup4", "lxml"]
# ///
"""websearch search "query" [n] [engine]  → JSON list [{title, url, snippet, engine}] (free, no API key)
   websearch fetch URL [chars]             → the page's main text (trafilatura), cut at 6000 chars by default

engine (default auto: Chinese in the query → cn + global, else global):
   global  ddgs (DuckDuckGo/Bing/Brave… aggregated)        cn     baidu + sogou + bili merged
   baidu / sogou / so360                                   zhihu  sogou/baidu/360 with site:zhihu.com (titles and snippets only)
   bili    Bilibili video search API
Optional: WEBSEARCH_CN_PROXY=http://host:port, an HTTP proxy with a mainland-China exit for the Chinese engines.
Without it they are queried directly; when Baidu/Sogou answer with a captcha it falls back to 360.
Zhihu answers need a login to read in full; fetch returns whatever the public page shows."""
import json, os, re, socket, sys, urllib.parse
from concurrent.futures import ThreadPoolExecutor

CN_PROXY = os.environ.get("WEBSEARCH_CN_PROXY", "")  # optional: an HTTP proxy with a mainland-China exit
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9",
           "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}
CN_DOMAINS = (".cn", "baidu.com", "zhihu.com", "csdn.net", "bilibili.com", "sogou.com", "so.com",
              "weixin.qq.com", "qq.com", "jianshu.com", "juejin.cn", "douyin.com", "weibo.com")

def _cn_proxies():
    if not CN_PROXY: return None
    host, port = urllib.parse.urlsplit(CN_PROXY).hostname, urllib.parse.urlsplit(CN_PROXY).port
    try:
        socket.create_connection((host, port), timeout=1.5).close()
        return {"http": CN_PROXY, "https": CN_PROXY}
    except OSError:
        return None

def _session(proxies, warm=None):
    import requests
    s = requests.Session(); s.headers.update(HEADERS); s.proxies = proxies or {}
    if not proxies and CN_PROXY: s.trust_env = False  # a CN proxy is configured but down: go direct, not via an overseas env proxy
    if warm: s.get(warm, timeout=10)  # first-visit cookies (Baidu serves a captcha without BAIDUID)
    return s

def _soup(html):
    from bs4 import BeautifulSoup
    return BeautifulSoup(html, "lxml")

def _text(el):
    return el.get_text(" ", strip=True) if el else ""

def _blocked(html):
    return bool(re.search(r"百度安全验证|wappass\.baidu|antispider|请输入验证码", html[:20000]))

def baidu(q, n, px):
    s = _session(px, "https://www.baidu.com/")
    r = s.get("https://www.baidu.com/s", params={"wd": q, "rn": max(n, 10), "ie": "utf-8"},
              headers={"Referer": "https://www.baidu.com/"}, timeout=15)
    if _blocked(r.text): raise RuntimeError("baidu captcha")
    out = []
    for x in _soup(r.text).select("div.result.c-container"):
        a = x.select_one("h3 a")
        if not a: continue
        sn = x.select_one("[class*=content-right], .c-abstract, [data-module=abstract]")
        out.append({"title": _text(a), "url": x.get("mu") or a.get("href"),
                    "snippet": _text(sn) or _text(x)[len(_text(a)):][:200]})
    return out

def sogou(q, n, px):
    r = _session(px).get("https://www.sogou.com/web", params={"query": q}, timeout=15)
    if _blocked(r.text): raise RuntimeError("sogou captcha")
    out = []
    for x in _soup(r.text).select("div.vrwrap, div.rb"):
        a = x.select_one("h3 a"); du = x.select_one("[data-url]")
        if not a: continue
        url = du.get("data-url") if du else urllib.parse.urljoin("https://www.sogou.com", a.get("href", ""))
        sn = x.select_one(".star-wiki, .space-txt, p.str_info, .str-text-info, .text-layout")
        out.append({"title": _text(a), "url": url, "snippet": (_text(sn) or _text(x)[len(_text(a)):])[:200]})
    return out

def so360(q, n, px):
    r = _session(px).get("https://www.so.com/s", params={"q": q}, timeout=15)
    out = []
    for x in _soup(r.text).select("li.res-list"):
        a = x.select_one("h3 a")
        if not a: continue
        sn = x.select_one("p.res-desc, .res-rich")
        out.append({"title": _text(a), "url": a.get("data-mdurl") or a.get("href"), "snippet": _text(sn)[:200]})
    return out


def bili(q, n, px):
    for attempt in range(3):  # the API intermittently answers risk-control HTML instead of JSON; a fresh session usually passes
        s = _session(px, "https://www.bilibili.com/")
        r = s.get("https://api.bilibili.com/x/web-interface/search/type", timeout=15,
                  params={"search_type": "video", "keyword": q}, headers={"Referer": "https://search.bilibili.com/"})
        try:
            d = r.json()
            if d.get("code") == 0: break
        except ValueError:
            pass
    else:
        raise RuntimeError(f"bili blocked (HTTP {r.status_code})")
    clean = lambda t: re.sub(r"<[^>]+>", "", t or "")
    return [{"title": clean(v.get("title")), "url": v.get("arcurl"),
             "snippet": f"{v.get('author')} · 播放 {v.get('play')} · {clean(v.get('description'))[:150]}"}
            for v in (d.get("data") or {}).get("result") or []]

def ddgs(q, n, px=None):
    from ddgs import DDGS
    region = "cn-zh" if re.search(r"[\u4e00-\u9fff]", q) else "wt-wt"
    return [{"title": r.get("title"), "url": r.get("href"), "snippet": r.get("body")}
            for r in DDGS().text(q, max_results=n, region=region)]

def zhihu(q, n, px):
    return _first([sogou, baidu, so360], q + " site:zhihu.com", n, px)

def _first(engines, q, n, px):
    for e in engines:
        try:
            rs = e(q, n, px)
            if rs: return [dict(r, engine=r.get("engine", e.__name__)) for r in rs]
        except Exception as ex:
            print(f"[websearch] {e.__name__}: {ex}", file=sys.stderr)
    return []

def _merge(lists, n):
    seen, out = set(), []
    for row in zip(*[l + [None] * (n - len(l)) for l in lists]) if lists else []:
        for r in row:
            if r and r["url"] and r["url"] not in seen:
                seen.add(r["url"]); out.append(r)
    return out[:n]

def search(q, n=6, engine="auto"):
    px = _cn_proxies()
    cn_web = [baidu, sogou, so360] if px else [so360, baidu, sogou]
    if engine == "auto":
        engine = "cn+global" if re.search(r"[一-鿿]", q) else "global"
    groups = {"global": lambda: _first([ddgs], q, n, px), "cn": None, "zhihu": lambda: zhihu(q, n, px)}
    single = {"baidu": baidu, "sogou": sogou, "so360": so360, "bili": bili}
    if engine in single:
        return _first([single[engine]], q, n, px)[:n]
    parts = []
    for name in engine.split("+"):
        if name == "cn":
            parts += [lambda e=e: _first([e] + [x for x in cn_web if x is not e], q, n, px) for e in cn_web[:2]]
            parts.append(lambda: _first([bili], q, n, px))
        else:
            parts.append(groups[name])
    with ThreadPoolExecutor(len(parts)) as ex:
        return _merge(list(ex.map(lambda f: f(), parts)), n)

def fetch(url, chars=6000):  # 6000 沿用原版 websearch
    import trafilatura
    host = urllib.parse.urlsplit(url).hostname or ""
    px = _cn_proxies() if host.endswith(CN_DOMAINS) else None
    s = _session(px) if px else _session(None) if host.endswith(CN_DOMAINS) else None
    if s is None:
        import requests
        s = requests.Session(); s.headers.update(HEADERS)  # other sites: honour HTTP(S)_PROXY from the environment
    html = s.get(url, timeout=20).text
    text = trafilatura.extract(html or "", include_links=False) or ""
    return text[:chars]

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(__doc__)
    if sys.argv[1] == "search":
        n = int(sys.argv[3]) if len(sys.argv) > 3 else 6
        print(json.dumps(search(sys.argv[2], n, sys.argv[4] if len(sys.argv) > 4 else "auto"), ensure_ascii=False, indent=1))
    else:
        print(fetch(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 6000))
