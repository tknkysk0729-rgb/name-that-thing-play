// Furigana for Japanese text. Each question may carry `furigana: { "切先": "きっさき" }`;
// every occurrence of a key in the Japanese text shown for that question gets a <ruby>.
// The kanji stay as written; English text is never passed through here.

const KANJI = /[\u4e00-\u9fff]/;

/** Splits `text` into plain strings and { base, reading } parts (longest key wins). */
export function segments(text, map) {
  const keys = Object.keys(map ?? {}).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!keys.length || !text) return [text];
  const out = [];
  let buf = '';
  let i = 0;
  while (i < text.length) {
    // a word only counts when kanji do not run on from either side (要 in 要点 is not かなめ)
    const key = keys.find((k) => text.startsWith(k, i) && !KANJI.test(text[i - 1] ?? '') && !KANJI.test(text[i + k.length] ?? ''));
    if (!key) { buf += text[i]; i += 1; continue; }
    const reading = map[key];
    const after = text.slice(i + key.length);
    // the text already spells the reading out right after the word, e.g. 繧繝縁（うんげんべり）
    const spelled = after.startsWith(`（${reading}）`) || after.startsWith(`(${reading})`);
    if (spelled) buf += key;
    else {
      if (buf) { out.push(buf); buf = ''; }
      out.push({ base: key, reading });
    }
    i += key.length;
  }
  if (buf) out.push(buf);
  return out;
}


export function rubyNodes(text, map, doc = document) {
  return segments(text, map).map((s) => {
    if (typeof s === 'string') return doc.createTextNode(s);
    const ruby = doc.createElement('ruby');
    ruby.append(doc.createTextNode(s.base));
    const rp1 = doc.createElement('rp'); rp1.textContent = '（';
    const rt = doc.createElement('rt'); rt.textContent = s.reading;
    const rp2 = doc.createElement('rp'); rp2.textContent = '）';
    ruby.append(rp1, rt, rp2);
    return ruby;
  });
}
