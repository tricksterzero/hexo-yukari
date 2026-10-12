/* global hexo */
'use strict';

const path = require('path');
const { relate } = require('./lib/relate');
const { createLinkResolver } = require('./lib/links');
const { normalizeConfig } = require('./lib/config');

const config = normalizeConfig(hexo.config.yukari, hexo.log.warn.bind(hexo.log));
// 意味ベクトル(lib/embed.js)。使うにはサイト側に @huggingface/transformers を入れる
const { embedding } = config;

if (config.enable) {
  /** @type {Map<string, string[]>} 記事の _id → 関連記事の path(表示順) */
  let relatedPaths = new Map();
  let embedder;

  // 記事の描画状況(db.json のキャッシュ)に左右されないよう、生成のたびに Markdown の本文から計算する
  hexo.extend.filter.register('before_generate', async function () {
    const started = Date.now();
    const posts = hexo.locals.get('posts').toArray();
    if (config.count === 0) {
      relatedPaths = new Map();
      return;
    }
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

    let signal = 'text';
    let result;
    if (embedding.enable && docs.length) {
      // Transformers.js の読み込みには時間がかかるので、hexo new などでは読み込まず、最初の生成で読み込む
      if (!embedder) {
        const { createEmbedder } = require('./lib/embed');
        embedder = createEmbedder({
          baseDir: hexo.base_dir,
          cacheDir: path.join(hexo.base_dir, '.yukari-cache'),
          device: embedding.device,
          log: hexo.log,
        });
      }
      if (embedder.available) {
        try {
          const { embeddingText } = require('./lib/embed');
          const vectors = await embedder.embed(docs.map((d) => embeddingText(d.title, d.text)));
          const withVectors = docs.map((d, i) => ({ ...d, embedding: vectors[i] }));
          signal = embedding.combine ? 'both' : 'embedding';
          result = relate(withVectors, { count: config.count, signal });
        } catch (err) {
          signal = 'text';
          hexo.log.warn('yukari: 意味ベクトルを使えないため、本文の語で判定します(%s)', String(err.message).split('\n')[0]);
        }
      }
    }
    if (!result) result = relate(docs, { count: config.count, signal: 'text' });

    relatedPaths = new Map(posts.map((post) => [post._id, result.get(post.path).related]));

    const fallback = [...result.values()].filter((r) => r.fallback).length;
    hexo.log.info('yukari: %d posts, %d without related posts, signal %s, %d ms', posts.length, fallback, signal, Date.now() - started);
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
