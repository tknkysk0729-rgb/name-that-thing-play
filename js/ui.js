import { answer, currentQuestion, lastResult, next, skipQuestion, summary } from './game.js';
import { LANGS, pick } from './i18n.js';
import { rubyNodes } from './ruby.js';

const KEYS = ['A', 'B', 'C', 'D'];

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function markerStyle(m) {
  const pct = (n) => `${+(n * 100).toFixed(3)}%`;
  return [
    `left:${pct(m.cx - m.rx)}`,
    `top:${pct(m.cy - m.ry)}`,
    `width:${pct(m.rx * 2)}`,
    `height:${pct(m.ry * 2)}`,
    m.rotate ? `transform:rotate(${m.rotate}deg)` : '',
  ].filter(Boolean).join(';');
}

/**
 * The view layer. `deps` supplies translations, data and persistence so this
 * file holds only DOM code.
 */
export function createApp(root, deps) {
  const { data, t: getT, getLang, setLang, onRoundStart, onRoundEnd, shareFn } = deps;
  let game = null;
  let screen = 'start';
  let shownImage = null; // the image block on screen: the photo, or its illustration fallback

  const t = (k, p) => getT()(k, p);
  const lang = () => getLang();
  const L = (obj) => pick(obj, lang());
  // Japanese text of a question with furigana; any other language is returned untouched
  const R = (obj, q) => (lang() === 'ja' ? rubyNodes(obj.ja, q.furigana) : L(obj));
  const other = () => (lang() === 'ja' ? 'en' : 'ja');
  const categoryName = (q) => L(data.categories[q.category]);
  const stars = (q) => '★'.repeat(q.difficulty) + '☆'.repeat(3 - q.difficulty);

  /* ------------------------------------------------ chrome */
  function renderChrome() {
    document.documentElement.lang = lang();
    document.title = `Name That Thing — ${t('app.tagline')}`;

    const logo = document.getElementById('logo');
    logo.replaceChildren('Name That ', h('span', { class: 'ring' }, 'Thing'));
    logo.setAttribute('title', t('app.home'));
    logo.onclick = () => showStart();

    const langBox = document.getElementById('lang');
    langBox.setAttribute('aria-label', t('lang.label'));
    langBox.replaceChildren(...LANGS.map((code) => h('button', {
      type: 'button',
      lang: code,
      'aria-pressed': String(code === lang()),
      onclick: () => { if (code !== lang()) { setLang(code); render(); } },
    }, t(`lang.${code}`))));

    document.getElementById('footer').replaceChildren(
      h('p', {}, t('footer.note')),
      h('p', {}, h('a', { href: 'credits.html' }, t('footer.credits'))),
    );
  }

  /* ------------------------------------------------ start */
  function renderStart() {
    const count = Math.min(10, data.questions.length);
    const step = (n) => h('li', {}, h('strong', {}, t(`start.step${n}.title`)), h('span', {}, t(`start.step${n}.body`)));
    root.replaceChildren(
      h('section', { class: 'hero' },
        h('h1', {}, 'Name That ', h('span', { class: 'ring' }, 'Thing')),
        h('p', { class: 'tagline' }, t('app.tagline')),
        h('p', { class: 'lead' }, t('app.lead')),
      ),
      h('ol', { class: 'steps' }, step(1), step(2), step(3)),
      h('button', { type: 'button', class: 'btn primary', id: 'start', onclick: startRound }, t('start.cta', { count })),
      h('p', { class: 'pool' }, t('start.pool', { n: data.questions.length })),
    );
  }

  /* ------------------------------------------------ quiz */
  function renderQuiz() {
    const q = currentQuestion(game);
    const total = game.questions.length;
    const answered = game.phase === 'answered';
    const num = game.index + 1;
    shownImage = q.image;
    let usedFallback = false;

    const frame = h('div', { class: 'frame', 'data-state': 'loading', style: `aspect-ratio:${q.image.width}/${q.image.height}` });
    const markerEl = h('span', { class: 'marker', style: markerStyle(q.image.marker), 'aria-hidden': 'true' });
    const img = h('img', {
      src: q.image.src, alt: L(q.image.alt), width: q.image.width, height: q.image.height,
      decoding: 'async', draggable: 'false',
    });
    const errorBox = h('div', { class: 'img-error', role: 'alert' },
      h('p', {}, t('quiz.imageError')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn quiet', onclick: () => { frame.dataset.state = 'loading'; img.src = bust(shownImage.src); } }, t('quiz.retry')),
        h('button', { type: 'button', class: 'btn quiet', onclick: skip }, t('quiz.skip')),
      ),
    );
    img.addEventListener('load', () => { frame.dataset.state = 'ok'; setChoicesLocked(false); });
    img.addEventListener('error', () => {
      const fb = q.image.fallback;
      if (fb && !usedFallback) {
        // The photo could not be loaded: show the original illustration (own marker, own credit) instead.
        usedFallback = true;
        shownImage = fb;
        frame.style.aspectRatio = `${fb.width}/${fb.height}`;
        markerEl.setAttribute('style', markerStyle(fb.marker));
        img.alt = L(fb.alt);
        img.width = fb.width;
        img.height = fb.height;
        img.src = fb.src;
        return;
      }
      frame.dataset.state = 'error';
      setChoicesLocked(true);
    });
    if (img.complete && img.naturalWidth > 0) frame.dataset.state = 'ok';
    frame.append(img, markerEl, errorBox);

    const choices = h('div', { class: 'choices', role: 'group', 'aria-label': t('quiz.choices'), id: 'choices' },
      q.choices.map((c, i) => h('button', {
        type: 'button', class: 'choice', 'data-id': c.id, 'aria-disabled': answered ? 'true' : null,
        onclick: () => choose(c.id),
      },
      h('span', { class: 'key', 'aria-hidden': 'true' }, KEYS[i]),
      h('span', { class: 'label' }, R(c, q)),
      h('span', { class: 'state' }))),
    );

    const reveal = h('section', { class: 'reveal', id: 'reveal', 'aria-live': 'polite', hidden: !answered });

    root.replaceChildren(
      h('section', { class: 'quiz' },
        h('div', { class: 'status' },
          h('span', { class: 'progress' }, t('quiz.progress', { n: num, total })),
          h('span', { class: 'score', id: 'score' }, t('quiz.score', { n: summary(game).correct })),
        ),
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': answered ? num : num - 1, 'aria-label': t('quiz.progress', { n: num, total }) },
          h('span', { style: `width:${((answered ? num : num - 1) / total) * 100}%` })),
        h('figure', { class: 'photo', 'aria-label': t('quiz.photoLabel') },
          frame,
          h('figcaption', { class: 'caption' },
            h('span', {}, categoryName(q)),
            h('span', { class: 'dot' }, t(`difficulty.${q.difficulty}`), ' ', h('span', { 'aria-hidden': 'true' }, stars(q))),
            h('span', { class: 'sr-only' }, t('quiz.markerNote')),
          ),
        ),
        h('h2', { class: 'prompt', id: 'prompt', tabindex: '-1' }, R(q.prompt, q)),
        choices,
        reveal,
      ),
    );

    if (answered) applyAnswer(q, lastResult(game));
    preloadNext();
    if (!answered) document.getElementById('prompt').focus({ preventScroll: true });
  }

  function bust(src) {
    return `${src}${src.includes('?') ? '&' : '?'}r=${Date.now()}`;
  }

  function setChoicesLocked(locked) {
    const box = document.getElementById('choices');
    if (!box) return;
    if (locked) box.dataset.locked = 'image'; else delete box.dataset.locked;
  }

  function preloadNext() {
    const nq = game.questions[game.index + 1];
    if (nq) new Image().src = nq.image.src;
  }

  function choose(choiceId) {
    if (game.phase !== 'asking') return;
    const frame = root.querySelector('.frame');
    if (frame && frame.dataset.state !== 'ok') return; // cannot answer a question whose image is not visible
    const after = answer(game, choiceId);
    if (after === game) return;
    game = after;
    const q = currentQuestion(game);
    applyAnswer(q, lastResult(game));
    document.getElementById('score').textContent = t('quiz.score', { n: summary(game).correct });
    const reveal = document.getElementById('reveal');
    reveal.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    reveal.querySelector('.next')?.focus({ preventScroll: true });
  }

  function applyAnswer(q, result) {
    const box = document.getElementById('choices');
    for (const btn of box.querySelectorAll('.choice')) {
      const id = btn.dataset.id;
      const state = btn.querySelector('.state');
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.remove('is-correct', 'is-wrong', 'is-dim');
      if (id === q.correctChoiceId) {
        btn.classList.add('is-correct');
        state.textContent = `✓ ${t('quiz.correctMark')}`;
      } else if (id === result.choiceId) {
        btn.classList.add('is-wrong');
        state.textContent = `✕ ${t('quiz.wrongMark')}`;
      } else {
        btn.classList.add('is-dim');
        state.textContent = '';
      }
    }
    const bar = root.querySelector('.bar');
    bar.setAttribute('aria-valuenow', game.index + 1);
    bar.firstElementChild.style.width = `${((game.index + 1) / game.questions.length) * 100}%`;

    const reveal = document.getElementById('reveal');
    reveal.hidden = false;
    reveal.replaceChildren(...buildReveal(q, result).filter(Boolean));
  }

  function buildReveal(q, result) {
    const ok = result.correct;
    const a = q.answer;
    const second = other();
    const readingOf = (code) => (code === 'ja' && a.reading && lang() !== 'ja' ? a.reading : '');
    const credit = (shownImage ?? q.image).credit;
    const isLast = game.index + 1 >= game.questions.length;

    const others = q.choices.filter((c) => c.id !== q.correctChoiceId && c.note);
    const othersBlock = others.length ? h('div', { class: 'others' },
      h('h4', {}, t('quiz.others')),
      h('ul', {}, others.map((c) => h('li', {}, h('strong', { lang: lang() }, R(c, q)), h('span', {}, R(c.note, q))))),
    ) : null;

    const creditLine = h('p', { class: 'credit' },
      `${t('quiz.credit')}: `,
      credit.sourcePageUrl ? h('a', { href: credit.sourcePageUrl, target: '_blank', rel: 'noopener noreferrer' }, credit.attribution) : credit.attribution,
      credit.licenseUrl ? [' / ', h('a', { href: credit.licenseUrl, target: '_blank', rel: 'noopener noreferrer' }, credit.license)] : null,
    );

    return [
      h('div', { class: `verdict ${ok ? 'ok' : 'ng'}` },
        h('span', { class: 'icon', 'aria-hidden': 'true' }, ok ? '✓' : '✕'),
        h('h3', {}, ok ? t('quiz.correct') : t('quiz.incorrect')),
      ),
      h('div', { class: 'answer-card' },
        h('p', { class: 'eyebrow' }, t('quiz.answerIs')),
        h('p', { class: 'answer-main', lang: lang() }, R(a, q)),
        h('p', { class: 'answer-sub', lang: second }, a[second], readingOf(second) ? h('span', { class: 'reading' }, ` (${readingOf(second)})`) : null),
      ),
      h('dl', { class: 'facts' },
        h('div', {}, h('dt', {}, t('quiz.usage')), h('dd', {}, R(q.explanation.usage, q))),
        h('div', {}, h('dt', {}, t('quiz.trivia')), h('dd', { class: 'trivia' }, R(q.explanation.trivia, q))),
      ),
      othersBlock,
      h('button', { type: 'button', class: 'btn quiet challenge', onclick: () => challenge(q) }, t('quiz.challenge')),
      creditLine,
      q.verification.fact.status !== 'unverified' ? null : h('p', { class: 'unverified' }, t('quiz.unverified')),
      h('div', { class: 'next-bar' },
        h('button', { type: 'button', class: 'btn primary next', onclick: goNext }, isLast ? t('quiz.finish') : t('quiz.next'))),
    ];
  }

  function goNext() {
    const after = next(game);
    if (after === game) return;
    game = after;
    if (game.phase === 'finished') finishRound(); else { renderQuiz(); window.scrollTo(0, 0); }
  }

  function skip() {
    game = skipQuestion(game);
    if (game.phase === 'finished') finishRound(); else { renderQuiz(); window.scrollTo(0, 0); }
  }

  /* ------------------------------------------------ result */
  function renderResult() {
    const s = summary(game);
    if (!s.total) {
      root.replaceChildren(h('div', { class: 'error-box' }, h('p', {}, t('result.empty')),
        h('button', { type: 'button', class: 'btn primary', onclick: showStart }, t('app.home'))));
      return;
    }
    const tier = s.percent === 100 ? 'perfect' : s.percent >= 70 ? 'high' : s.percent >= 40 ? 'mid' : 'low';
    const byId = new Map(game.questions.map((q) => [q.id, q]));
    const rows = game.results.map((r) => {
      const q = byId.get(r.questionId);
      const sec = other();
      return h('li', { class: r.correct ? 'ok' : 'ng' },
        h('span', { class: 'mark', role: 'img', 'aria-label': r.correct ? t('quiz.correctMark') : t('quiz.wrongMark') }, r.correct ? '✓' : '✕'),
        h('div', {},
          h('div', { class: 'name', lang: lang() }, R(q.answer, q)),
          h('div', { class: 'sub', lang: sec }, q.answer[sec]),
        ),
      );
    });

    root.replaceChildren(
      h('section', { class: 'result' },
        h('h2', { tabindex: '-1', id: 'result-title' }, t('result.title')),
        h('div', { class: 'score-ring', style: `--p:${s.percent}`, role: 'img', 'aria-label': `${t('result.scoreLabel')}: ${t('result.score', { correct: s.correct, total: s.answered })}` },
          h('div', {},
            h('span', { class: 'score-num' }, t('result.score', { correct: s.correct, total: s.answered })),
            h('span', { class: 'score-sub' }, t('result.scoreLabel')),
          )),
        h('p', { class: 'accuracy' }, t('result.accuracy', { percent: s.percent })),
        h('p', { class: 'message' }, t(`result.msg.${tier}`)),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', id: 'again', onclick: startRound }, t('result.again')),
          h('button', { type: 'button', class: 'btn quiet', id: 'share', onclick: share }, t('result.share')),
          h('button', { type: 'button', class: 'btn quiet', onclick: showStart }, t('app.home')),
        ),
        h('p', { class: 'review-head' }, t('result.review')),
        h('ul', { class: 'review' }, rows),
      ),
    );
    document.getElementById('result-title').focus({ preventScroll: true });
  }

  async function share() {
    const s = summary(game);
    const text = t('result.shareText', { correct: s.correct, total: s.answered });
    const url = location.href.split('#')[0];
    const outcome = await shareFn({ title: 'Name That Thing', text, url });
    if (outcome === 'copied') toast(t('result.copied'));
  }

  async function challenge(q) {
    // Spoiler-free: the link opens this one question, the text never names the answer.
    const url = `${location.origin}${location.pathname}?q=${q.id}`;
    const outcome = await shareFn({ title: 'Name That Thing', text: t('quiz.challengeText'), url });
    if (outcome === 'copied') toast(t('result.copied'));
  }

  function toast(message) {
    document.querySelector('.toast')?.remove();
    const el = h('div', { class: 'toast', role: 'status' }, message);
    document.body.append(el);
    setTimeout(() => el.remove(), 2200);
  }

  /* ------------------------------------------------ flow */
  function startRound() {
    game = onRoundStart();
    screen = 'quiz';
    if (game.phase === 'finished') { screen = 'result'; renderResult(); return; }
    renderQuiz();
    window.scrollTo(0, 0);
  }

  function finishRound() {
    onRoundEnd(game);
    screen = 'result';
    renderResult();
    window.scrollTo(0, 0);
  }

  function showStart() {
    game = null;
    screen = 'start';
    renderStart();
    window.scrollTo(0, 0);
  }

  function render() {
    renderChrome();
    if (screen === 'start' || !game) renderStart();
    else if (screen === 'quiz') renderQuiz();
    else renderResult();
  }

  document.addEventListener('keydown', (e) => {
    if (screen !== 'quiz' || !game || game.phase !== 'asking' || e.ctrlKey || e.metaKey || e.altKey) return;
    const idx = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase());
    if (idx < 0 || e.key.length !== 1) return;
    const q = currentQuestion(game);
    if (q?.choices[idx]) choose(q.choices[idx].id);
  });

  return { render, showStart, startRound };
}
