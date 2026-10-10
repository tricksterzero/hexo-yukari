'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEmbedder, embeddingText, EmbeddingCache } = require('../lib/embed');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yukari-'));
const silent = { info() {}, warn() {} };

test('意味ベクトルに渡す文章は、タイトルと記法を取り除いた本文', () => {
  assert.equal(embeddingText('題名', '本文の[リンク](/a.html)と`code`\n\n次の段落'), '題名\n本文のリンクと 次の段落');
});

test('キャッシュは文章が同じなら同じベクトルを返し、使わなかったものは保存時に捨てる', () => {
  const dir = tmp();
  const file = path.join(dir, 'embeddings.json');
  const a = new EmbeddingCache(file);
  a.set('記事A', [1, 0]);
  a.set('記事B', [0, 1]);
  a.save();

  const b = new EmbeddingCache(file);
  assert.deepEqual(b.get('記事A'), [1, 0]);
  assert.equal(b.get('記事C'), undefined);
  b.save(); // 記事B は今回使っていない

  const c = new EmbeddingCache(file);
  assert.deepEqual(c.get('記事A'), [1, 0]);
  assert.equal(c.get('記事B'), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('壊れたキャッシュは空として扱う', () => {
  const dir = tmp();
  const file = path.join(dir, 'embeddings.json');
  fs.writeFileSync(file, '{broken');
  assert.equal(new EmbeddingCache(file).get('記事A'), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('@huggingface/transformers が入っていなければ、使えないことを返す', () => {
  const dir = tmp();
  const warnings = [];
  const embedder = createEmbedder({ baseDir: dir, cacheDir: path.join(dir, '.yukari-cache'), log: { ...silent, warn: (...a) => warnings.push(a) } });
  assert.equal(embedder.available, false);
  assert.equal(warnings.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
