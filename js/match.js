// Typed-answer judging for the very-hard mode. Pure functions, no DOM.
//
// A typed answer is accepted when, after normalising both sides, it equals one of the accepted forms of the question:
//   Japanese: answer.ja, the text outside / inside full-width brackets ("舌（ぜつ）" -> 舌, ぜつ), answer.reading, answer.aliases.ja
//   English:  answer.en and the text outside its brackets ("Baran (sushi grass)" -> Baran), answer.aliases.en
//             (the bracketed part of an English answer is a gloss, not a name, so "grass" or "tip" alone never counts)
// Normalisation is deliberately forgiving about spelling and script, never about the word itself:
// width and case, spaces and punctuation, katakana vs hiragana, the long-vowel mark, diacritics (Sōrin = Sorin).

const KATAKANA = /[ァ-ヶ]/g;

/** "ヴ" -> "ぶ" is not a spelling rule of Japanese but players type both; everything else maps one to one. */
export function normalizeAnswer(text) {
  if (text == null) return '';
  let s = String(text).normalize('NFKC').toLowerCase();
  s = s.replace(KATAKANA, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)); // katakana -> hiragana
  s = s.replace(/ゔ/g, 'ぶ');
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC'); // ō -> o  (the dakuten of か゛ etc. is NFKC-composed already)
  // drop everything that is not a letter or a digit: spaces, ・, ー, hyphens, apostrophes, full stops, brackets
  s = s.replace(/[^\p{L}\p{N}]/gu, '').replace(/ー/g, '');
  return s;
}

/** Text outside and inside the first pair of brackets: "舌（ぜつ）" -> ["舌（ぜつ）", "舌", "ぜつ"]. */
export function bracketParts(text) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const m = t.match(/^(.*?)\s*[（(]\s*(.+?)\s*[）)]\s*(.*)$/);
  if (!m) return [t];
  const outside = `${m[1]}${m[3]}`.trim();
  return [t, outside, m[2]].filter(Boolean);
}

/** All forms accepted for a question, as normalised strings (deduplicated, empty strings removed). */
export function acceptedForms(question) {
  const a = question?.answer ?? {};
  const raw = [
    ...bracketParts(a.ja),
    a.reading,
    ...(a.aliases?.ja ?? []),
    ...bracketParts(a.en).slice(0, 2),
    ...(a.aliases?.en ?? []),
  ];
  return Array.from(new Set(raw.map(normalizeAnswer).filter(Boolean)));
}

/**
 * Judges a typed answer. `matched` is the accepted form that was hit, so the UI/tests can say why it counted.
 * An empty (or symbol-only) input is never correct.
 */
export function judgeTyped(question, input) {
  const typed = normalizeAnswer(input);
  if (!typed) return { correct: false, empty: true, matched: null };
  const hit = acceptedForms(question).find((f) => f === typed) ?? null;
  return { correct: hit != null, empty: false, matched: hit };
}
