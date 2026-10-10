'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relate } = require('../lib/relate');

const day = (n) => Date.UTC(2026, 0, n);

// 3つの話題(ゲーム・料理・サーバー)が2〜3記事ずつある小さな記事群
const docs = [
  { id: 'game1', title: 'セイントのビルド', text: 'セイント 回復魔法 支援ビルド 聖属性', date: day(1) },
  { id: 'game2', title: 'セイントの装備', text: 'セイント 回復魔法 装備更新 聖属性', date: day(5) },
  { id: 'game3', title: 'セイントの近況', text: 'セイント 支援ビルド 装備更新', date: day(9) },
  { id: 'food1', title: 'スープカレー', text: 'スープカレー 札幌 野菜 辛さ', date: day(2) },
  { id: 'food2', title: 'スープカレー再訪', text: 'スープカレー 札幌 チキン 辛さ', date: day(6) },
  { id: 'srv1', title: 'サーバー移行', text: 'サーバー 移行 証明書 転送', date: day(3) },
  { id: 'srv2', title: 'サーバー設定', text: 'サーバー 設定 証明書 圧縮', date: day(7) },
  { id: 'alone', title: '誕生日', text: '誕生日 プレゼント', date: day(8) },
];

test('相互に上位に入る記事だけを関連記事にし、話題をまたがない', () => {
  const r = relate(docs, { count: 2 });
  assert.deepEqual(new Set(r.get('food1').related), new Set(['food2']));
  assert.deepEqual(new Set(r.get('srv2').related), new Set(['srv1']));
  for (const id of r.get('game1').related) assert.match(id, /^game/);
});

test('自分より新しい記事を先に並べる', () => {
  const r = relate(docs, { count: 2 });
  assert.deepEqual(r.get('game2').related, ['game3', 'game1']);
});

test('どの記事とも語を共有しない記事は関連記事なしになる', () => {
  const r = relate(docs, { count: 2 });
  assert.deepEqual(r.get('alone'), { related: [], fallback: true });
});

test('本文でリンク済みの記事は出さず、関連記事が無ければリンク済みの記事で代用する', () => {
  const linked = docs.map((d) => (d.id === 'food1' ? { ...d, links: ['food2'] } : d));
  const r = relate(linked, { count: 2 });
  assert.deepEqual(r.get('food1'), { related: ['food2'], fallback: true });
  assert.deepEqual(r.get('food2'), { related: ['food1'], fallback: false });
});

test('どの記事も count 件を超えて推薦されない', () => {
  const r = relate(docs, { count: 2 });
  const inDegree = new Map();
  for (const { related, fallback } of r.values()) {
    if (fallback) continue;
    for (const id of related) inDegree.set(id, (inDegree.get(id) || 0) + 1);
  }
  for (const n of inDegree.values()) assert.ok(n <= 2);
});

test('入力の順序を変えても結果が変わらない', () => {
  const a = relate(docs, { count: 2 });
  const b = relate([...docs].reverse(), { count: 2 });
  for (const d of docs) assert.deepEqual(b.get(d.id), a.get(d.id));
});
