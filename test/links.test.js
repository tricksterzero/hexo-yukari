'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLinkResolver } = require('../lib/links');

const posts = [
  { _id: 'a', path: '20200808_hexo.html', slug: '20200808_hexo', source: '_posts/20200808_hexo.md' },
  { _id: 'b', path: '2021/01/24/spitz/', slug: 'spitz', source: '_posts/spitz.md' },
  { _id: 'c', path: '日本語/記事.html', slug: '記事', source: '_posts/記事.md' },
];

test('サイト内の絶対パス・完全な URL・相対パス・post_link を記事に解決する', () => {
  const resolve = createLinkResolver(posts, { url: 'https://example.jp', root: '/' });
  const body = [
    '[絶対パス](/20200808_hexo.html)',
    '<a href="https://example.jp/2021/01/24/spitz/">完全な URL</a>',
    '[相対パス](../../../../%E6%97%A5%E6%9C%AC%E8%AA%9E/%E8%A8%98%E4%BA%8B.html)',
  ].join('\n');
  assert.deepEqual(new Set(resolve({ path: '2022/02/02/x/', _content: body })), new Set(['a', 'b', 'c']));
  assert.deepEqual(resolve({ path: 'x.html', _content: '{% post_link spitz %}' }), ['b']);
});

test('外部サイト・コードブロック内・該当なしのリンクは拾わない', () => {
  const resolve = createLinkResolver(posts, { url: 'https://example.jp', root: '/' });
  const body = '[外部](https://other.example/20200808_hexo.html)\n```\n[コード](/20200808_hexo.html)\n```\n[無い](/none.html)';
  assert.deepEqual(resolve({ path: 'x.html', _content: body }), []);
});

test('サブディレクトリに置いたサイトでは root を考慮する', () => {
  const resolve = createLinkResolver(posts, { url: 'https://example.jp/blog', root: '/blog/' });
  assert.deepEqual(resolve({ path: 'x.html', _content: '[a](/blog/20200808_hexo.html) [b](/20200808_hexo.html)' }), ['a']);
});
