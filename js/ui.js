import {
  MODES, MODE_IDS, answer, clockElapsed, clockStart, clockStop, createClock, currentQuestion, isFinalStep, lastResult,
  modeAvailability, next, qualifyingCorrect, skipQuestion, summary, survivalOutcome,
} from './game.js';
import { formatTime } from './records.js';
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
  const { data, t: getT, getLang, setLang, onRoundStart, onRoundEnd, getRecords, shareFn } = deps;
  let game = null;
  let clock = createClock(); // time modes: counts only while a question waits for its answer
  let ticker = null;
  let outcome = null; // what the finished game did to the records (kept so a language switch does not record twice)
  let finalTimeMs = 0;
  const now = () => performance.now();
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
    logo.onclick = () => leaveToStart();

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
  function recordLine(id) {
    const rec = getRecords?.()?.[id];
    if (id === 'normal') return null;
    if (id === 'survival') {
      return rec && rec.plays ? t('mode.record.survival', { n: rec.bestCorrect, clears: rec.clears }) : t('mode.record.none');
    }
    if (rec && rec.bestTimeMs != null) {
      return t('mode.record.time', { time: formatTime(rec.bestTimeMs), correct: rec.bestTimeCorrect, total: MODES[id].count });
    }
    return t('mode.record.timeNone');
  }

  function modeCard(id) {
    const avail = modeAvailability(id, data.questions.length);
    const cta = id === 'normal' ? t('start.cta', { count: Math.min(MODES.normal.count, data.questions.length) }) : t(`mode.cta.${id}`);
    const record = recordLine(id);
    return h('li', { class: `mode-card${id === 'normal' ? ' is-main' : ''}`, 'data-mode': id },
      h('div', { class: 'mode-head' },
        h('h3', {}, t(`mode.${id}.name`)),
        h('span', { class: 'mode-count' }, t(`mode.${id}.count`))),
      h('p', { class: 'mode-rule' }, t(`mode.${id}.rule`)),
      h('p', { class: 'mode-feature' }, t(`mode.${id}.feature`)),
      record ? h('p', { class: 'mode-record' }, record) : null,
      avail.ok ? null : h('p', { class: 'mode-unavailable', role: 'status' }, t('mode.unavailable', { need: avail.need, have: avail.have })),
      h('button', {
        type: 'button', class: `btn ${id === 'normal' ? 'primary' : 'quiet'}`, id: id === 'normal' ? 'start' : `start-${id}`,
        disabled: !avail.ok, onclick: () => startRound(id),
      }, cta),
    );
  }

  function renderStart() {
    const step = (n) => h('li', {}, h('strong', {}, t(`start.step${n}.title`)), h('span', {}, t(`start.step${n}.body`)));
    root.replaceChildren(
      h('section', { class: 'hero' },
        h('h1', {}, 'Name That ', h('span', { class: 'ring' }, 'Thing')),
        h('p', { class: 'tagline' }, t('app.tagline')),
        h('p', { class: 'lead' }, t('app.lead')),
      ),
      h('ol', { class: 'steps' }, step(1), step(2), step(3)),
      h('h2', { class: 'modes-head' }, t('mode.heading')),
      h('ul', { class: 'modes' }, MODE_IDS.map(modeCard)),
      h('p', { class: 'mode-timerule' }, t('mode.timeRule')),
      h('p', { class: 'pool' }, t('start.pool', { n: data.questions.length })),
    );
  }

  /* ------------------------------------------------ clock (time modes) */
  const isTimed = () => Boolean(MODES[game?.mode]?.timed);
  const isSurvival = () => Boolean(MODES[game?.mode]?.suddenDeath);

  function timerText() {
    return t('quiz.time', { time: formatTime(clockElapsed(clock, now())) });
  }
  function tick() {
    const el = document.getElementById('timer');
    if (!el || screen !== 'quiz') { stopTicker(); return; }
    el.textContent = timerText();
  }
  function stopTicker() {
    if (ticker != null) { clearInterval(ticker); ticker = null; }
  }
  function startClock() {
    if (!isTimed() || !game || game.phase !== 'asking') return;
    clock = clockStart(clock, now());
  }
  function stopClock() {
    clock = clockStop(clock, now());
  }

  document.addEventListener('visibilitychange', () => {
    if (!isTimed() || screen !== 'quiz') return;
    if (document.hidden) { stopClock(); return; }
    if (root.querySelector('.frame')?.dataset.state === 'ok') startClock();
  });

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
    img.addEventListener('load', () => { frame.dataset.state = 'ok'; setChoicesLocked(false); startClock(); });
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
    if (img.complete && img.naturalWidth > 0) { frame.dataset.state = 'ok'; startClock(); }
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
        game.mode !== 'normal' ? h('p', { class: 'mode-badge' }, t(`mode.${game.mode}.name`)) : null,
        h('div', { class: 'status' },
          h('span', { class: 'progress' }, t('quiz.progress', { n: num, total }),
            game.mode !== 'normal' ? h('span', { class: 'remain' }, ` · ${t('quiz.remaining', { n: total - num })}`) : null),
          isTimed() ? h('span', { class: 'timer', id: 'timer', role: 'timer' }, timerText()) : null,
          h('span', { class: 'score', id: 'score' }, scoreText()),
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

    if (isTimed()) {
      stopTicker();
      ticker = setInterval(tick, 100);
    }
    if (answered) applyAnswer(q, lastResult(game));
    preloadNext();
    if (!answered) document.getElementById('prompt').focus({ preventScroll: true });
  }

  function scoreText() {
    return isSurvival() ? t('quiz.streak', { n: summary(game).correct }) : t('quiz.score', { n: summary(game).correct });
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
    stopClock();
    const q = currentQuestion(game);
    applyAnswer(q, lastResult(game));
    document.getElementById('score').textContent = scoreText();
    if (isTimed()) tick();
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
    const isLast = isFinalStep(game);
    const gameOver = isSurvival() && !result.correct;

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
      isTimed() ? h('p', { class: 'timer-note' }, t('quiz.timerNote')) : null,
      h('div', { class: 'next-bar' },
        h('button', { type: 'button', class: 'btn primary next', onclick: goNext }, gameOver ? t('quiz.toGameOver') : isLast ? t('quiz.finish') : t('quiz.next'))),
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
    if (game.mode === 'survival' && summary(game).total) return renderSurvivalResult();
    renderScoreResult();
  }

  function reviewList() {
    const byId = new Map(game.questions.map((q) => [q.id, q]));
    return game.results.map((r) => {
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
  }

  function resultActions() {
    return h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn primary', id: 'again', onclick: () => startRound(game.mode) }, t('result.again')),
      h('button', { type: 'button', class: 'btn quiet', id: 'share', onclick: share }, t('result.share')),
      h('button', { type: 'button', class: 'btn quiet', id: 'modes', onclick: showStart }, game.mode === 'normal' ? t('app.home') : t('mode.heading')),
    );
  }

  function timedBlock(s) {
    const rec = getRecords?.()?.[game.mode];
    const f = outcome ?? {};
    const need = qualifyingCorrect(s.total);
    return h('div', { class: 'time-result' },
      h('p', { class: 'time-big', id: 'time-total' }, `${t('result.time.label')} ${formatTime(finalTimeMs)}`),
      f.newBestTime ? h('p', { class: 'badge-best', id: 'new-best' }, t('result.time.newBest')) : null,
      !f.qualified ? h('p', { class: 'time-note warn', id: 'not-qualified' }, t('result.time.notQualified', { need })) : null,
      f.newBestCorrect && !f.firstPlay ? h('p', { class: 'time-note', id: 'new-best-correct' }, t('result.time.newBestCorrect')) : null,
      f.firstPlay ? h('p', { class: 'time-note' }, t('result.time.first')) : null,
      f.previous?.bestTimeMs != null && !f.newBestTime ? h('p', { class: 'time-note' }, t('result.time.previous', { time: formatTime(f.previous.bestTimeMs) })) : null,
      rec?.bestTimeMs != null ? h('p', { class: 'time-note', id: 'best-time' }, t('result.time.best', { time: formatTime(rec.bestTimeMs) })) : null,
      h('p', { class: 'time-note' }, t('result.time.note')),
    );
  }

  function renderSurvivalResult() {
    const o = survivalOutcome(game);
    const f = outcome ?? {};
    const rec = getRecords?.()?.survival;
    const missed = o.wrongQuestionId ? game.questions.find((q) => q.id === o.wrongQuestionId) : null;
    const missedResult = game.results.find((r) => !r.correct);
    const sec = other();
    const pickedChoice = missed && missedResult ? missed.choices.find((c) => c.id === missedResult.choiceId) : null;
    root.replaceChildren(
      h('section', { class: `result survival ${o.cleared ? 'is-clear' : 'is-over'}` },
        h('h2', { tabindex: '-1', id: 'result-title' }, o.cleared ? t('result.sv.clear') : t('result.sv.over')),
        h('p', { class: 'mode-badge' }, t('mode.survival.name')),
        h('div', { class: 'score-ring', style: `--p:${Math.round((o.correct / MODES.survival.count) * 100)}`, role: 'img', 'aria-label': t('result.sv.correctCount', { n: o.correct }) },
          h('div', {},
            h('span', { class: 'score-num' }, `${o.correct}`),
            h('span', { class: 'score-sub' }, `/ ${MODES.survival.count}`),
          )),
        h('p', { class: 'accuracy' }, o.cleared ? t('result.sv.correctCount', { n: o.correct }) : `${t('result.sv.reached', { n: o.reached })} · ${t('result.sv.correctCount', { n: o.correct })}`),
        h('p', { class: 'message' }, o.cleared ? t('result.sv.clearMsg') : t('result.sv.overMsg')),
        f.newBestCorrect ? h('p', { class: 'badge-best', id: 'new-best' }, t('result.sv.newBest')) : null,
        rec ? h('p', { class: 'time-note', id: 'best-survival' }, `${t('result.sv.best', { n: rec.bestCorrect })} · ${t('result.sv.clears', { n: rec.clears })}`) : null,
        missed ? h('div', { class: 'missed', id: 'missed' },
          h('p', { class: 'review-head' }, t('result.sv.missed')),
          h('div', { class: 'frame-mini' }, h('img', { src: missed.image.src, alt: L(missed.image.alt), width: missed.image.width, height: missed.image.height })),
          h('p', { class: 'eyebrow' }, t('result.sv.rightAnswer')),
          h('p', { class: 'answer-main', lang: lang() }, R(missed.answer, missed)),
          h('p', { class: 'answer-sub', lang: sec }, missed.answer[sec]),
          pickedChoice ? h('p', { class: 'picked' }, `${t('result.sv.yourPick')}: `, h('span', { lang: lang() }, R(pickedChoice, missed))) : null,
          h('p', { class: 'trivia' }, R(missed.explanation.usage, missed)),
        ) : null,
        resultActions(),
        h('p', { class: 'review-head' }, t('result.review')),
        h('ul', { class: 'review' }, reviewList()),
      ),
    );
    document.getElementById('result-title').focus({ preventScroll: true });
  }

  function renderScoreResult() {
    const s = summary(game);
    if (!s.total) {
      root.replaceChildren(h('div', { class: 'error-box' }, h('p', {}, t('result.empty')),
        h('button', { type: 'button', class: 'btn primary', onclick: showStart }, t('app.home'))));
      return;
    }
    const tier = s.percent === 100 ? 'perfect' : s.percent >= 70 ? 'high' : s.percent >= 40 ? 'mid' : 'low';
    const timed = isTimed();

    root.replaceChildren(
      h('section', { class: 'result' },
        h('h2', { tabindex: '-1', id: 'result-title' }, timed ? t('result.time.title') : t('result.title')),
        timed ? h('p', { class: 'mode-badge' }, t(`mode.${game.mode}.name`)) : null,
        h('div', { class: 'score-ring', style: `--p:${s.percent}`, role: 'img', 'aria-label': `${t('result.scoreLabel')}: ${t('result.score', { correct: s.correct, total: s.answered })}` },
          h('div', {},
            h('span', { class: 'score-num' }, t('result.score', { correct: s.correct, total: s.answered })),
            h('span', { class: 'score-sub' }, t('result.scoreLabel')),
          )),
        h('p', { class: 'accuracy' }, t('result.accuracy', { percent: s.percent })),
        h('p', { class: 'message' }, t(`result.msg.${tier}`)),
        timed ? timedBlock(s) : null,
        resultActions(),
        h('p', { class: 'review-head' }, t('result.review')),
        h('ul', { class: 'review' }, reviewList()),
      ),
    );
    document.getElementById('result-title').focus({ preventScroll: true });
  }

  async function share() {
    const s = summary(game);
    let text = t('result.shareText', { correct: s.correct, total: s.answered });
    if (isTimed()) text = t('result.shareTime', { mode: t(`mode.${game.mode}.name`), correct: s.correct, total: s.answered, time: formatTime(finalTimeMs) });
    if (game.mode === 'survival') text = survivalOutcome(game).cleared ? t('result.shareSurvivalClear') : t('result.shareSurvival', { n: s.correct });
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
  function startRound(modeId = 'normal') {
    stopTicker();
    clock = createClock();
    outcome = null;
    finalTimeMs = 0;
    game = onRoundStart(typeof modeId === 'string' ? modeId : 'normal');
    screen = 'quiz';
    if (game.phase === 'finished') { screen = 'result'; renderResult(); return; }
    renderQuiz();
    window.scrollTo(0, 0);
  }

  function finishRound() {
    stopTicker();
    stopClock();
    finalTimeMs = Math.round(clockElapsed(clock, now()));
    const s = summary(game);
    outcome = onRoundEnd(game, {
      timeMs: finalTimeMs,
      cleared: game.mode === 'survival' && survivalOutcome(game).cleared,
      total: s.total, correct: s.correct, answered: s.answered,
    }) ?? null;
    screen = 'result';
    renderResult();
    window.scrollTo(0, 0);
  }

  /** Header logo: asks before throwing away a time-attack or survival play that is under way. */
  function leaveToStart() {
    const underWay = screen === 'quiz' && game && game.mode !== 'normal' && !game.single;
    if (underWay && game.results.length && !window.confirm(t('mode.leaveConfirm'))) return;
    showStart();
  }

  function showStart() {
    stopTicker();
    clock = createClock();
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
