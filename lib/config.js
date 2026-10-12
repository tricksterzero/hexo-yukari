'use strict';

// _config.yml の yukari を検査して既定値で補う。型の違う値は警告して既定値に戻し、黙って別の動作にしない

const DEFAULTS = { enable: true, count: 5 };
const EMBEDDING_DEFAULTS = { enable: false, combine: false, device: 'cpu' };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {unknown} raw hexo.config.yukari
 * @param {(format: string, ...args: unknown[]) => void} warn
 * @returns {{enable: boolean, count: number, embedding: {enable: boolean, combine: boolean, device: string}}}
 */
const normalizeConfig = (raw, warn) => {
  const config = { ...DEFAULTS, embedding: { ...EMBEDDING_DEFAULTS } };
  if (raw === undefined || raw === null) return config;
  // yukari: false / true でプラグイン全体を切り替えられるようにする
  if (typeof raw === 'boolean') return { ...config, enable: raw };
  if (!isObject(raw)) {
    warn('yukari: 設定 yukari はオブジェクトで書いてください。既定の設定で続けます');
    return config;
  }

  const bool = (value, name, fallback) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    warn('yukari: 設定 %s は true か false で書いてください。%s で続けます', name, fallback);
    return fallback;
  };

  config.enable = bool(raw.enable, 'yukari.enable', DEFAULTS.enable);
  if (raw.count !== undefined && raw.count !== null) {
    if (Number.isInteger(raw.count) && raw.count >= 0) config.count = raw.count;
    else warn('yukari: 設定 yukari.count は0以上の整数で書いてください。%d で続けます', DEFAULTS.count);
  }

  const embedding = raw.embedding;
  if (typeof embedding === 'boolean') {
    config.embedding.enable = embedding;
  } else if (isObject(embedding)) {
    config.embedding.enable = bool(embedding.enable, 'yukari.embedding.enable', EMBEDDING_DEFAULTS.enable);
    config.embedding.combine = bool(embedding.combine, 'yukari.embedding.combine', EMBEDDING_DEFAULTS.combine);
    if (embedding.device !== undefined && embedding.device !== null) {
      if (typeof embedding.device === 'string' && embedding.device) config.embedding.device = embedding.device;
      else warn('yukari: 設定 yukari.embedding.device は文字列で書いてください。%s で続けます', EMBEDDING_DEFAULTS.device);
    }
  } else if (embedding !== undefined && embedding !== null) {
    warn('yukari: 設定 yukari.embedding はオブジェクトで書いてください。意味ベクトルを使わずに続けます');
  }
  return config;
};

module.exports = { normalizeConfig };
