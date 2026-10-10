'use strict';

const { tokenize } = require('./tokenize');

// 関連の定義: 記事Aの類似度上位 count 件に記事Bが入り、かつ記事Bの上位 count 件にも記事Aが入るとき、AとBは関連する。
// 調整値は表示件数 count だけで、類似度の閾値は持たない。

/**
 * @typedef {object} Doc
 * @property {string} id
 * @property {string} title
 * @property {string} text 本文(Markdown)
 * @property {number} date 公開日時(ミリ秒)
 * @property {string[]} [links] 本文からリンクしている記事の id
 */

/**
 * @typedef {object} Result
 * @property {string[]} related 表示する記事の id(表示順)
 * @property {boolean} fallback 関連記事が無く、本文でリンク済みの記事で代用したとき true
 */

// 語の出現回数から、TF-IDF を単位ベクトルにしたものを作る(tf は 1 + log)
const buildVectors = (docs) => {
  const counts = docs.map((d) => {
    const c = new Map();
    for (const t of tokenize(`${d.title}\n${d.text}`)) c.set(t, (c.get(t) || 0) + 1);
    return c;
  });
  const df = new Map();
  for (const c of counts) for (const t of c.keys()) df.set(t, (df.get(t) || 0) + 1);

  const n = docs.length;
  return counts.map((c) => {
    const v = new Map();
    let norm = 0;
    for (const [t, k] of c) {
      const d = df.get(t);
      if (d < 2) continue; // 1記事にしか出ない語は、記事どうしの類似度に寄与しない
      const w = (1 + Math.log(k)) * Math.log(n / d);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
};

const dot = (a, b) => {
  if (b.size < a.size) [a, b] = [b, a];
  let s = 0;
  for (const [t, x] of a) {
    const y = b.get(t);
    if (y) s += x * y;
  }
  return s;
};

/**
 * 全記事の関連記事を求める。
 * @param {Doc[]} docs
 * @param {{count?: number}} [options] count: 表示件数。相互判定の上位件数にも使う
 * @returns {Map<string, Result>}
 */
const relate = (docs, { count = 5 } = {}) => {
  const n = docs.length;
  const vectors = buildVectors(docs);
  const sim = docs.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // 足し算の順序を id の順で固定し、入力の並びが変わっても同じ値になるようにする
      const s = docs[i].id < docs[j].id ? dot(vectors[i], vectors[j]) : dot(vectors[j], vectors[i]);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }

  // 同点はパスの順で決め、ビルドごとに結果が揺れないようにする
  const byScore = (i) => (a, b) => sim[i][b] - sim[i][a] || (docs[a].id < docs[b].id ? -1 : 1);
  const top = docs.map((_, i) => {
    const candidates = [];
    for (let j = 0; j < n; j++) if (j !== i && sim[i][j] > 0) candidates.push(j);
    return new Set(candidates.sort(byScore(i)).slice(0, count));
  });

  const index = new Map(docs.map((d, i) => [d.id, i]));
  const result = new Map();
  for (let i = 0; i < n; i++) {
    const linked = new Set((docs[i].links || []).map((id) => index.get(id)).filter((j) => j !== undefined && j !== i));
    const related = [...top[i]].filter((j) => top[j].has(i) && !linked.has(j));
    if (related.length) {
      // 新しい記事を先に出す。古い記事に着地した読者を、同じ話題の新しい記事へ案内するため
      const newer = related.filter((j) => docs[j].date > docs[i].date).sort(byScore(i));
      const older = related.filter((j) => docs[j].date <= docs[i].date).sort(byScore(i));
      result.set(docs[i].id, { related: [...newer, ...older].map((j) => docs[j].id), fallback: false });
    } else {
      const fallback = [...linked].sort(byScore(i)).slice(0, count);
      result.set(docs[i].id, { related: fallback.map((j) => docs[j].id), fallback: true });
    }
  }
  return result;
};

module.exports = { relate };
