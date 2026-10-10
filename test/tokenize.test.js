'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, stripMarkup } = require('../lib/tokenize');

test('漢字・カタカナ・英数字の連続を語にし、ひらがなを捨てる', () => {
  assert.deepEqual(
    tokenize('スラッシュアックスの装備は大剣と弓', { bigram: false }),
    ['スラッシュアックス', '装備', '大剣', '弓'],
  );
});

test('1文字の漢字の直後がひらがななら動詞・形容詞の語幹として捨てる', () => {
  assert.deepEqual(tokenize('記事を書いて良いと言った', { bigram: false }), ['記事']);
});

test('3文字以上の漢字の連続は2文字ずつにも分ける', () => {
  assert.deepEqual(tokenize('高難易度', { bigram: true }), ['高難易度', '高難', '難易', '易度']);
});

test('全角英数字と半角カタカナをそろえ、英字は小文字にする', () => {
  assert.deepEqual(tokenize('ＨｅｘｏとｶﾀｶﾅとNexT', { bigram: false }), ['hexo', 'カタカナ', 'next']);
});

test('数字だけの語とカタカナ1文字の語は捨てる', () => {
  assert.deepEqual(tokenize('2026年版のア', { bigram: false }), ['年版']);
});

test('コード・タグプラグイン・URL・HTML を取り除き、リンクの文字は残す', () => {
  const md = '[関連記事](/a.html)\n```js\nconst x = 1;\n```\n{% tweet 123 %}\n<div class="x">本文</div> https://example.com/path';
  assert.equal(stripMarkup(md).replace(/\s+/g, ' ').trim(), '関連記事 本文');
});
