/* global hexo */
'use strict';

const { relate } = require('./lib/relate');
const { createLinkResolver } = require('./lib/links');

const config = Object.assign({ enable: true, count: 5 }, hexo.config.yukari);

if (config.enable) {
  /** @type {Map<string, string[]>} 記事の _id → 関連記事の path(表示順) */
  let relatedPaths = new Map();

  // 記事の描画状況(db.json のキャッシュ)に左右されないよう、生成のたびに Markdown の本文から計算する
  hexo.extend.filter.register('before_generate', function () {
    const started = Date.now();
    const posts = hexo.locals.get('posts').toArray();
    const linksOf = createLinkResolver(posts, hexo.config);
    // _id は db.json を作り直すたびに変わるので、同点の並びや計算順を決める id には path を使う
    const pathOf = new Map(posts.map((post) => [post._id, post.path]));
    const docs = posts.map((post) => ({
      id: post.path,
      title: post.title || '',
      text: post._content || '',
      date: post.date.valueOf(),
      links: linksOf(post).map((id) => pathOf.get(id)),
    }));
    const result = relate(docs, { count: config.count });

    relatedPaths = new Map(posts.map((post) => [post._id, result.get(post.path).related]));

    const fallback = [...result.values()].filter((r) => r.fallback).length;
    hexo.log.info('yukari: %d posts, %d without related posts, %d ms', posts.length, fallback, Date.now() - started);
  });

  // テーマには page.related_posts(記事の path の配列)として渡す。NexT はこの形をそのまま表示できる。
  // 他のプラグインが db.json に残した値で表示されないよう、記事のページでは必ず上書きする
  hexo.extend.filter.register('template_locals', (locals) => {
    if (locals.page && locals.page.__post) {
      locals.page.related_posts = relatedPaths.get(locals.page._id) || [];
    }
    return locals;
  });
}
