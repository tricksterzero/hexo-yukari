'use strict';

// 日本語の文章を、辞書を使わずに文字の種類の切れ目で語に分ける。
// 内容を表す語の多くは漢字かカタカナで書かれ、助詞や活用語尾はひらがなで書かれる、という書き方の性質を使う。

// 漢字の連続 / カタカナの連続 / 英数字の連続 / ひらがなの連続
const RUN = /([\p{Script=Han}々〆ヶ]+)|([\p{Script=Katakana}ー]+)|([a-z0-9][a-z0-9._+#-]*)|(\p{Script=Hiragana}+)/gu;
const HIRAGANA = /\p{Script=Hiragana}/u;
const NUMBER = /^[\d.,]+$/;

/**
 * Markdown と HTML の記法を取り除き、本文の文字だけを残す。
 * @param {string} source
 * @returns {string}
 */
const stripMarkup = (source) => String(source || '')
  .replace(/```[\s\S]*?```/g, ' ') // コードブロック
  .replace(/`[^`\n]*`/g, ' ') // インラインコード
  .replace(/\{%[\s\S]*?%\}/g, ' ') // Hexo のタグプラグイン
  .replace(/<!--[\s\S]*?-->/g, ' ') // コメントと <!-- more -->
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 画像
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // リンクは文字だけ残す
  .replace(/<[^>]+>/g, ' ') // HTML タグ
  .replace(/https?:\/\/\S+/g, ' ') // 生の URL
  .replace(/&[a-z]+;|&#\d+;/gi, ' '); // 文字参照

/**
 * 文章を語の配列にする。
 * @param {string} text
 * @param {{bigram?: boolean}} [options] bigram: 3文字以上の漢字の連続を2文字ずつにも分け、複合語の部分一致を拾う
 * @returns {string[]}
 */
const tokenize = (text, { bigram = true } = {}) => {
  const s = stripMarkup(text).normalize('NFKC').toLowerCase();
  const tokens = [];
  for (const m of s.matchAll(RUN)) {
    const [, han, kata, alnum] = m;
    if (han) {
      // 1文字の漢字の直後がひらがななら、動詞・形容詞の語幹(書く・言う・良い)とみなして捨てる
      const next = s[m.index + han.length];
      if (han.length === 1 && next && HIRAGANA.test(next)) continue;
      tokens.push(han);
      if (bigram && han.length >= 3) {
        for (let i = 0; i + 2 <= han.length; i++) tokens.push(han.slice(i, i + 2));
      }
    } else if (kata) {
      if (kata.replace(/ー/g, '').length >= 2) tokens.push(kata);
    } else if (alnum) {
      if (!NUMBER.test(alnum)) tokens.push(alnum);
    }
    // ひらがなの連続(助詞・活用語尾)は捨てる
  }
  return tokens;
};

module.exports = { tokenize, stripMarkup };
