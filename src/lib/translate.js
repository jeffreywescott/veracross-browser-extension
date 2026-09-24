// Optional English translation using the browser's built-in, on-device Translator API
// (Chrome 138+). Nothing is sent to a translation service. When the API isn't available the
// dashboard simply doesn't offer translation.

export function translationAvailable() {
  return typeof globalThis.Translator !== 'undefined' && typeof globalThis.LanguageDetector !== 'undefined';
}

// Cheap check used to decide whether to offer translation at all (real detection happens on click).
const EN_STOPWORDS = new Set('the and to of a is in for you your with on please will be are this that it we our at by from have has'.split(' '));
export function probablyNotEnglish(text) {
  const words = String(text).toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 4) return false;
  const en = words.filter((w) => EN_STOPWORDS.has(w)).length;
  return en / words.length < 0.08 || /[äöüßàâçéèêëîïôûùœ]/i.test(text) && en / words.length < 0.15;
}

let detector = null;
const translators = new Map();

export async function detectLanguage(text) {
  if (!translationAvailable()) return null;
  detector ??= await globalThis.LanguageDetector.create();
  const [top] = await detector.detect(text.slice(0, 2000));
  return top && top.confidence > 0.6 ? top.detectedLanguage : null;
}

export async function toEnglish(text) {
  const source = await detectLanguage(text);
  if (!source || source === 'en') return { source, text: null };
  const avail = await globalThis.Translator.availability({ sourceLanguage: source, targetLanguage: 'en' });
  if (avail === 'unavailable') throw new Error(`No on-device translation from “${source}”.`);
  if (!translators.has(source)) {
    translators.set(source, await globalThis.Translator.create({ sourceLanguage: source, targetLanguage: 'en' }));
  }
  // Translate paragraph by paragraph so line breaks survive.
  const t = translators.get(source);
  const parts = [];
  for (const p of text.split(/\n{2,}/)) parts.push(p.trim() ? await t.translate(p) : p);
  return { source, text: parts.join('\n\n') };
}
