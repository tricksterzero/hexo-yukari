'use strict';

// 意味ベクトル(文章埋め込み)の部品。使うときだけ、サイト側に入れた @huggingface/transformers を読み込む。
// 本体はこの部品が無くても動き、依存も持たない。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { stripMarkup } = require('./tokenize');

// 日本語の文章埋め込みモデル ruri-v3-30m(Apache-2.0)。ONNX 版にはトークナイザーが無いので、トークナイザーは元のモデルから読む
const MODEL = 'onnx-community/ruri-v3-30m-ONNX';
const TOKENIZER = 'cl-nagoya/ruri-v3-30m';
const DTYPE = 'fp32';
const MAX_TOKENS = 8192; // 元のモデルの sentence_bert_config.json の max_seq_length
// キャッシュの鍵に含める。モデルや入力の作り方を変えたら上げ、古いベクトルを使わないようにする
const VERSION = `${MODEL}|${TOKENIZER}|${DTYPE}|${MAX_TOKENS}|1`;

/**
 * 意味ベクトルに渡す文章。タイトルと、記法を取り除いた本文。
 * @param {string} title
 * @param {string} content Markdown
 */
const embeddingText = (title, content) => `${title || ''}\n${stripMarkup(content).replace(/\s+/g, ' ').trim()}`;

const keyOf = (text) => crypto.createHash('sha256').update(`${VERSION}\n${text}`).digest('hex');

/**
 * 文章のハッシュをキーにしたベクトルのキャッシュ。変わった記事だけを計算し直す。
 * 作り直したベクトルは小数点以下5桁目付近で揺れることがあるので、キャッシュは結果を揃える役目も持つ。
 */
class EmbeddingCache {
  constructor(file) {
    this.file = file;
    this.entries = new Map();
    this.used = new Set();
    this.dirty = false;
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (json.version === VERSION) this.entries = new Map(Object.entries(json.entries));
    } catch {
      // 無いか壊れていれば空から始める
    }
  }

  get(text) {
    const key = keyOf(text);
    this.used.add(key);
    return this.entries.get(key);
  }

  set(text, vector) {
    const key = keyOf(text);
    this.used.add(key);
    this.entries.set(key, vector);
    this.dirty = true;
  }

  /** 今回使わなかった記事(削除・変更された記事)のベクトルを捨てて保存する */
  save() {
    for (const key of this.entries.keys()) {
      if (!this.used.has(key)) {
        this.entries.delete(key);
        this.dirty = true;
      }
    }
    this.used.clear();
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ version: VERSION, entries: Object.fromEntries(this.entries) }));
    this.dirty = false;
  }
}

/**
 * @param {{baseDir: string, cacheDir: string, device?: string, log: {info: Function, warn: Function}}} options
 *   baseDir: @huggingface/transformers を探すサイトのディレクトリ。cacheDir: ベクトルとモデルの置き場所。
 *   device: transformers.js の device(cpu / gpu / dml / webgpu / cuda など)。読み込めなければ cpu で続ける
 * @returns {{embed: (texts: string[]) => Promise<number[][]>, available: boolean, device: string}}
 */
const createEmbedder = ({ baseDir, cacheDir, device = 'cpu', log }) => {
  let transformers;
  try {
    transformers = createRequire(path.join(baseDir, 'package.json'))('@huggingface/transformers');
  } catch (err) {
    log.warn('yukari: @huggingface/transformers を読み込めないため、意味ベクトルを使わずに本文の語で判定します(%s)', err.code || err.message);
    return { available: false, device: null, embed: null };
  }
  const { AutoTokenizer, AutoModel, env } = transformers;
  env.cacheDir = path.join(cacheDir, 'models');
  const cache = new EmbeddingCache(path.join(cacheDir, 'embeddings.json'));

  let loaded; // { tokenizer, model, device } のプロミス。hexo server では生成のたびに作り直さない
  const load = async () => {
    const tokenizer = await AutoTokenizer.from_pretrained(TOKENIZER);
    try {
      return { tokenizer, model: await AutoModel.from_pretrained(MODEL, { dtype: DTYPE, device }), device };
    } catch (err) {
      if (device === 'cpu') throw err;
      log.warn('yukari: device "%s" でモデルを読み込めないため cpu で続けます(%s)', device, String(err.message).split('\n')[0]);
      return { tokenizer, model: await AutoModel.from_pretrained(MODEL, { dtype: DTYPE, device: 'cpu' }), device: 'cpu' };
    }
  };

  // 1件ずつ(パディング無し)渡すので、全トークンの平均がそのまま mean pooling になる
  const encode = async ({ tokenizer, model }, text) => {
    const { last_hidden_state: h } = await model(tokenizer(text, { truncation: true, max_length: MAX_TOKENS }));
    const [, n, dim] = h.dims;
    const v = new Float64Array(dim);
    for (let i = 0; i < n; i++) for (let j = 0; j < dim; j++) v[j] += h.data[i * dim + j];
    const norm = Math.hypot(...v);
    // 桁を落としてキャッシュを小さくし、計算の細かな揺れが結果に出にくくする
    return Array.from(v, (x) => Math.round((x / norm) * 1e5) / 1e5);
  };

  const embedder = {
    available: true,
    device,
    /**
     * @param {string[]} texts embeddingText() で作った文章
     * @returns {Promise<number[][]>}
     */
    async embed(texts) {
      const vectors = texts.map((t) => cache.get(t));
      const missing = vectors.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      if (missing.length) {
        // 失敗したら次の生成で読み込みからやり直す
        loaded = loaded || load().catch((err) => { loaded = undefined; throw err; });
        const m = await loaded;
        embedder.device = m.device;
        const started = Date.now();
        for (const i of missing) {
          vectors[i] = await encode(m, texts[i]);
          cache.set(texts[i], vectors[i]);
        }
        log.info('yukari: %d posts embedded on %s, %d ms', missing.length, m.device, Date.now() - started);
      }
      cache.save();
      return vectors;
    },
  };
  return embedder;
};

module.exports = { createEmbedder, embeddingText, EmbeddingCache, VERSION };
