'use strict';

const { tokenize } = require('./tokenize');

// 関連の近さ: mutual proximity(MP)。記事Aから見てBより遠い記事、かつBから見てAより遠い記事の割合で、
// 両方向の順位がどちらも高い組ほど大きい(Schnitzer ら 2012「Local and Global Scaling Reduce Hubs in Space」
// JMLR 13、3.2.1節の経験分布による定義)。
// 類似度そのものではなく両方向の順位で近さを測るので、多くの記事と似ている記事(ハブ)が並びすぎるのを抑えつつ、
// 片方向にしか上位に入らない記事にも候補を出せる。
// 調整値は表示件数 count だけで、類似度の閾値は持たない。
//
// 近さを測る信号(signal)は3つから選ぶ。
// - text: 本文の語(TF-IDF のコサイン)。語を1つも共有しない記事は候補にしない
// - embedding: 意味ベクトル(lib/embed.js)のコサイン。語が重ならなくても話題が近い記事を拾う
// - both: 両方の MP の平均。MP はどちらも0〜1の割合なので、重みを調整せずに足せる

/**
 * @typedef {object} Doc
 * @property {string} id
 * @property {string} title
 * @property {string} text 本文(Markdown)
 * @property {number} date 公開日時(ミリ秒)
 * @property {string[]} [links] 本文からリンクしている記事の id
 * @property {number[]} [embedding] 意味ベクトル。signal が embedding か both のとき必須
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

// 記事の組ごとの値を対称な行列にする。足し算の順序を id の順で固定し、入力の並びが変わっても同じ値になるようにする
const symmetric = (docs, f) => {
  const n = docs.length;
  const m = docs.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = docs[i].id < docs[j].id ? f(i, j) : f(j, i);
      m[i][j] = s;
      m[j][i] = s;
    }
  }
  return m;
};

// 意味ベクトルから全記事の平均を引いて単位ベクトルにする(中心化)。
// 文章埋め込みは全体がある方向に偏るため、引かないと多くの記事と似る記事(ハブ)ができやすい
const centerVectors = (docs) => {
  const dim = docs[0].embedding.length;
  const mean = new Float64Array(dim);
  // 平均も id の順で足す
  for (const d of [...docs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (let k = 0; k < dim; k++) mean[k] += d.embedding[k] / docs.length;
  }
  return docs.map((d) => {
    const v = d.embedding.map((x, k) => x - mean[k]);
    const norm = Math.hypot(...v);
    return norm > 0 ? v.map((x) => x / norm) : v;
  });
};

const cosine = (a, b) => {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
};

// MP: Aから見てBより遠く(類似度が低く)、かつBから見てAより遠い記事の数 / 記事数。
// 候補にしない組(isPair が false)は計算しない。記事数の3乗に比例する
const mutualProximity = (sim, isPair) => {
  const n = sim.length;
  const mp = sim.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const si = sim[i];
    for (let j = i + 1; j < n; j++) {
      if (!isPair(i, j)) continue;
      const s = si[j];
      const sj = sim[j];
      let c = 0;
      for (let k = 0; k < n; k++) if (k !== i && k !== j && si[k] < s && sj[k] < s) c++;
      mp[i][j] = c / n;
      mp[j][i] = c / n;
    }
  }
  return mp;
};

const SIGNALS = ['text', 'embedding', 'both'];

/**
 * 全記事の関連記事を求める。
 * @param {Doc[]} docs
 * @param {{count?: number, signal?: 'text' | 'embedding' | 'both'}} [options] count: 表示件数。signal: 近さを測る信号
 * @returns {Map<string, Result>}
 */
const relate = (docs, { count = 5, signal = 'text' } = {}) => {
  if (!SIGNALS.includes(signal)) throw new Error(`unknown signal: ${signal}`);
  if (signal !== 'text' && !docs.every((d) => d.embedding)) throw new Error(`signal "${signal}" needs embedding for every doc`);
  const n = docs.length;
  if (n === 0) return new Map();
  const useText = signal !== 'embedding';
  const useEmbedding = signal !== 'text';

  let textSim;
  let embSim;
  if (useText) {
    const vectors = buildVectors(docs);
    textSim = symmetric(docs, (i, j) => dot(vectors[i], vectors[j]));
  }
  if (useEmbedding) {
    const vectors = centerVectors(docs);
    embSim = symmetric(docs, (i, j) => cosine(vectors[i], vectors[j]));
  }

  // 本文の語だけで測るときは、語を1つも共有しない記事を候補にしない。意味ベクトルを使うときは全記事が候補
  const isCandidate = signal === 'text' ? (i, j) => textSim[i][j] > 0 : () => true;
  let score;
  if (signal === 'text') score = mutualProximity(textSim, isCandidate);
  else if (signal === 'embedding') score = mutualProximity(embSim, isCandidate);
  else {
    const a = mutualProximity(textSim, isCandidate);
    const b = mutualProximity(embSim, isCandidate);
    score = a.map((row, i) => row.map((x, j) => (x + b[i][j]) / 2));
  }
  const sim = useEmbedding ? embSim : textSim;

  // MP は件数の比なので同点が多い。類似度、パスの順の順で決め、ビルドごとに結果が揺れないようにする
  const byScore = (i) => (a, b) => score[i][b] - score[i][a] || sim[i][b] - sim[i][a] || (docs[a].id < docs[b].id ? -1 : 1);

  const index = new Map(docs.map((d, i) => [d.id, i]));
  const result = new Map();
  for (let i = 0; i < n; i++) {
    const linked = new Set((docs[i].links || []).map((id) => index.get(id)).filter((j) => j !== undefined && j !== i));
    // 本文でリンク済みの記事は読者の目にすでに入っているので、候補から外してから上位 count 件を取る
    const candidates = [];
    for (let j = 0; j < n; j++) if (j !== i && isCandidate(i, j) && !linked.has(j)) candidates.push(j);
    const related = candidates.sort(byScore(i)).slice(0, count);
    if (related.length) {
      // 新しい記事を先に出す。古い記事に着地した読者を、同じ話題の新しい記事へ案内するため
      const newer = related.filter((j) => docs[j].date > docs[i].date);
      const older = related.filter((j) => docs[j].date <= docs[i].date);
      result.set(docs[i].id, { related: [...newer, ...older].map((j) => docs[j].id), fallback: false });
    } else {
      const fallback = [...linked].sort(byScore(i)).slice(0, count);
      result.set(docs[i].id, { related: fallback.map((j) => docs[j].id), fallback: true });
    }
  }
  return result;
};

module.exports = { relate, SIGNALS };
