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

test('root が日本語でも、エンコードされた root で解決する', () => {
  const resolve = createLinkResolver(posts, { url: 'https://example.jp', root: '/%E6%97%A5%E8%A8%98/' });
  assert.deepEqual(resolve({ path: 'x.html', _content: '[a](/日記/20200808_hexo.html)' }), ['a']);
});

test('パスに % を含む記事があっても止まらず、その記事へのリンクを解決する', () => {
  const withPercent = [...posts, { _id: 'p', path: '2020/01/01/100%-off/' }];
  const resolve = createLinkResolver(withPercent, { url: 'https://example.jp', root: '/' });
  assert.deepEqual(resolve({ path: 'x.html', _content: '[p](/2020/01/01/100%25-off/)' }), ['p']);
});

test('index.html・末尾のスラッシュ・.html の有無が違う書き方も同じ記事に解決する', () => {
  const resolve = createLinkResolver(
    [...posts, { _id: 'e', path: 'entry/index.html' }],
    { url: 'https://example.jp', root: '/' },
  );
  const body = '[e](/entry) [b](/2021/01/24/spitz) [b2](/2021/01/24/spitz/index.html) [a](/20200808_hexo)';
  assert.deepEqual(new Set(resolve({ path: 'x.html', _content: body })), new Set(['e', 'b', 'a']));
});

test('インラインコード・HTML コメント・~~~ のコードブロックの中のリンクは拾わない', () => {
  const resolve = createLinkResolver(posts, { url: 'https://example.jp', root: '/' });
  const body = '`[コード](/20200808_hexo.html)`\n<!-- [コメント](/2021/01/24/spitz/) -->\n~~~\n{% post_link 記事 %}\n~~~';
  assert.deepEqual(resolve({ path: 'x.html', _content: body }), []);
});
