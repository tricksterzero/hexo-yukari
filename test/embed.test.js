'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEmbedder, embeddingText, EmbeddingCache, DIM } = require('../lib/embed');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yukari-'));
const silent = { info() {}, warn() {} };
// 長さ DIM の、k 番目だけが1のベクトル
const unit = (k) => Array.from({ length: DIM }, (_, i) => (i === k ? 1 : 0));

test('意味ベクトルに渡す文章は、タイトルと記法を取り除いた本文', () => {
  assert.equal(embeddingText('題名', '本文の[リンク](/a.html)と`code`\n\n次の段落'), '題名\n本文のリンクと 次の段落');
});

test('キャッシュは文章が同じなら同じベクトルを返し、使わなかったものは保存時に捨てる', () => {
  const dir = tmp();
  const file = path.join(dir, 'embeddings.json');
  const a = new EmbeddingCache(file);
  a.set('記事A', unit(0));
  a.set('記事B', unit(1));
  a.save();

  const b = new EmbeddingCache(file);
  assert.deepEqual(b.get('記事A'), unit(0));
  assert.equal(b.get('記事C'), undefined);
  b.save(); // 記事B は今回使っていない

  const c = new EmbeddingCache(file);
  assert.deepEqual(c.get('記事A'), unit(0));
  assert.equal(c.get('記事B'), undefined);
  // 一時ファイルは置き換えたあとに残らない
  assert.deepEqual(fs.readdirSync(dir), ['embeddings.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('壊れたキャッシュは空として扱う', () => {
  const dir = tmp();
  const file = path.join(dir, 'embeddings.json');
  fs.writeFileSync(file, '{broken');
  assert.equal(new EmbeddingCache(file).get('記事A'), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('形の正しくないベクトルは、キャッシュに無いものとして扱う', () => {
  const dir = tmp();
  const file = path.join(dir, 'embeddings.json');
  const a = new EmbeddingCache(file);
  a.set('オブジェクト', {});
  a.set('短い', [1, 0]);
  a.set('文字列入り', [...unit(0).slice(1), 'x']);
  a.set('正しい', unit(2));
  a.save();
  const b = new EmbeddingCache(file);
  for (const text of ['オブジェクト', '短い', '文字列入り']) assert.equal(b.get(text), undefined);
  assert.deepEqual(b.get('正しい'), unit(2));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('途中で失敗した生成の使用記録は、次の生成に持ち越さない', () => {
  const dir = tmp();
  const file = path.join(dir, 'embeddings.json');
  const a = new EmbeddingCache(file);
  a.set('記事A', unit(0));
  a.set('記事B', unit(1));
  a.save();

  const b = new EmbeddingCache(file);
  b.begin();
  b.get('記事B'); // この生成は保存の前に失敗した
  b.begin();
  b.get('記事A');
  b.save();
  assert.equal(new EmbeddingCache(file).get('記事B'), undefined);
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

// サイトに、Transformers.js の代わりの偽のモジュールを置く。cpu 以外の device では、読み込みは成功するが計算で失敗する
const fakeSite = () => {
  const dir = tmp();
  const pkg = path.join(dir, 'node_modules', '@huggingface', 'transformers');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"@huggingface/transformers","main":"index.js"}');
  fs.writeFileSync(path.join(pkg, 'index.js'), `
    exports.env = {};
    exports.loads = [];
    exports.AutoTokenizer = { from_pretrained: async () => () => ({}) };
    exports.AutoModel = {
      from_pretrained: async (name, { device }) => {
        exports.loads.push(device);
        return async () => {
          if (device !== 'cpu') throw new Error('device lost');
          const data = new Float32Array(${DIM});
          data[0] = 1;
          return { last_hidden_state: { dims: [1, 1, ${DIM}], data } };
        };
      },
    };
  `);
  return dir;
};

test('device で計算に失敗したら、cpu で読み込み直して続ける', async () => {
  const dir = fakeSite();
  const warnings = [];
  const embedder = createEmbedder({ baseDir: dir, cacheDir: path.join(dir, '.yukari-cache'), device: 'webgpu', log: { ...silent, warn: (...a) => warnings.push(a) } });
  assert.equal(embedder.available, true);
  const vectors = await embedder.embed(['記事A', '記事B']);
  assert.deepEqual(vectors, [unit(0), unit(0)]);
  assert.equal(embedder.device, 'cpu');
  assert.equal(warnings.length, 1);

  // 次の生成でも、失敗した device には戻らない
  await embedder.embed(['記事C']);
  const fake = require(path.join(dir, 'node_modules', '@huggingface', 'transformers'));
  assert.deepEqual(fake.loads, ['webgpu', 'cpu']);
  fs.rmSync(dir, { recursive: true, force: true });
});
