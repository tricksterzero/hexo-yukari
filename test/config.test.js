'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig } = require('../lib/config');

const collect = () => {
  const warnings = [];
  return { warnings, warn: (...a) => warnings.push(a) };
};

test('書かなければ既定の設定になる', () => {
  const { warnings, warn } = collect();
  assert.deepEqual(normalizeConfig(undefined, warn), {
    enable: true, count: 5, embedding: { enable: false, combine: false, device: 'cpu' },
  });
  assert.equal(warnings.length, 0);
});

test('yukari: false でプラグイン全体を無効にする', () => {
  assert.equal(normalizeConfig(false, () => {}).enable, false);
});

test('count は0以上の整数だけを受け付け、それ以外は警告して既定値に戻す', () => {
  for (const count of [0, 1, 10]) assert.equal(normalizeConfig({ count }, () => {}).count, count);
  for (const count of [-1, 2.5, '3', 'abc', true]) {
    const { warnings, warn } = collect();
    assert.equal(normalizeConfig({ count }, warn).count, 5, `count: ${JSON.stringify(count)}`);
    assert.equal(warnings.length, 1);
  }
});

test('真偽値でない enable は警告して既定値に戻す', () => {
  const { warnings, warn } = collect();
  assert.equal(normalizeConfig({ enable: 'false' }, warn).enable, true);
  assert.equal(warnings.length, 1);
});

test('embedding: true で意味ベクトルを有効にする。オブジェクトなら各項目を読む', () => {
  assert.equal(normalizeConfig({ embedding: true }, () => {}).embedding.enable, true);
  assert.deepEqual(
    normalizeConfig({ embedding: { enable: true, combine: true, device: 'webgpu' } }, () => {}).embedding,
    { enable: true, combine: true, device: 'webgpu' },
  );
});
