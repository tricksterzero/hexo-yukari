'use strict';

// 記事の本文(Markdown)から、同じサイトの他の記事へのリンクを拾う。
// 本文でリンク済みの記事は読者の目にすでに入っているので、関連記事の欄には出さない。

const LINK_PATTERNS = [
  /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, // [文字](URL)
  /\bhref\s*=\s*["']([^"']+)["']/gi, // <a href="URL">
  /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm, // [参照]: URL
];
const POST_TAG = /\{%\s*post_(?:link|path)\s+("([^"]+)"|'([^']+)'|(\S+))/g; // {% post_link slug %}

/**
 * @param {Array<{_id: string, path: string, slug?: string, source?: string}>} posts
 * @param {{url: string, root?: string}} config Hexo の設定(url と root を使う)
 * @returns {(post: {path: string, _content?: string}) => string[]} 本文がリンクしている記事の _id を返す関数
 */
const createLinkResolver = (posts, config) => {
  const site = new URL(config.url);
  const root = (config.root || '/').replace(/\/?$/, '/');

  const byPath = new Map();
  const bySlug = new Map();
  for (const p of posts) {
    const path = decodeURI(String(p.path)).replace(/^\//, '');
    byPath.set(path, p._id);
    if (path.endsWith('index.html')) byPath.set(path.slice(0, -'index.html'.length), p._id);
    else if (path.endsWith('/')) byPath.set(`${path}index.html`, p._id);
    if (p.slug) bySlug.set(String(p.slug), p._id);
    if (p.source) bySlug.set(String(p.source).replace(/^_posts\//, '').replace(/\.[^.]+$/, ''), p._id);
  }

  const resolveUrl = (href, fromPath) => {
    let url;
    try {
      url = new URL(href, new URL(root + fromPath, site.origin));
    } catch {
      return undefined;
    }
    if (url.origin !== site.origin) return undefined;
    let path;
    try {
      path = decodeURI(url.pathname);
    } catch {
      path = url.pathname;
    }
    if (!path.startsWith(root)) return undefined;
    return byPath.get(path.slice(root.length));
  };

  return (post) => {
    const body = String(post._content || '').replace(/```[\s\S]*?```/g, ' ');
    const found = new Set();
    for (const pattern of LINK_PATTERNS) {
      for (const m of body.matchAll(pattern)) {
        const id = resolveUrl(m[1], String(post.path));
        if (id) found.add(id);
      }
    }
    for (const m of body.matchAll(POST_TAG)) {
      const id = bySlug.get(m[2] || m[3] || m[4]);
      if (id) found.add(id);
    }
    return [...found];
  };
};

module.exports = { createLinkResolver };
