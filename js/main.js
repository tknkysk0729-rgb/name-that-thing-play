import { createGame, markSeen, playableQuestions, DEFAULT_ROUND_SIZE, MODES, modeAvailability } from './game.js';
import { applyPlay, normalizeRecords } from './records.js';
import { LANGS, createTranslator, detectLanguage } from './i18n.js';
import { load, save } from './storage.js';
import { createApp } from './ui.js';

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function share(payload) {
  try {
    if (navigator.share) {
      await navigator.share(payload);
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard.writeText(`${payload.text} ${payload.url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

async function boot() {
  const root = document.getElementById('app');
  let lang = detectLanguage(load('lang', null), navigator.language);
  let dictionaries = {};
  try {
    const [data, ...dicts] = await Promise.all([
      fetchJson('data/questions.json'),
      ...LANGS.map((l) => fetchJson(`data/i18n/${l}.json`)),
    ]);
    dictionaries = Object.fromEntries(LANGS.map((l, i) => [l, dicts[i]]));
    const pool = playableQuestions(data.questions);

    // ?q=q014 opens a one-question round (groundwork for per-question share URLs, also used by the e2e checks).
    let forced = pool.find((q) => q.id === new URLSearchParams(location.search).get('q')) ?? null;

    const app = createApp(root, {
      data: { ...data, questions: pool },
      t: () => createTranslator(dictionaries, lang),
      getLang: () => lang,
      setLang: (code) => { lang = code; save('lang', code); },
      shareFn: share,
      getRecords: () => normalizeRecords(load('records', null)),
      onRoundStart: (modeId = 'normal') => {
        if (forced) {
          const game = createGame([forced], { count: 1 });
          forced = null;
          game.single = true;
          return game;
        }
        if (modeId !== 'normal') {
          // Time attack / survival: a fresh random draw of distinct questions, never padded with repeats.
          const mode = MODES[modeId];
          if (!mode || !modeAvailability(modeId, pool.length).ok) return createGame([], { count: 0, mode: modeId });
          return createGame(pool, { count: mode.count, mode: modeId });
        }
        return createGame(pool, { count: DEFAULT_ROUND_SIZE, seenIds: load('seen', []) });
      },
      onRoundEnd: (game, stats) => {
        if (game.single) return null;
        if (game.mode !== 'normal') {
          // only a game that really ran to its end is recorded (all questions answered, or a survival game over)
          const full = game.results.length === MODES[game.mode].count;
          const over = MODES[game.mode].suddenDeath && game.results.some((r) => !r.correct);
          if (!full && !over) return null;
          const { records, flags } = applyPlay(load('records', null), {
            mode: game.mode, total: stats.total, correct: stats.correct, timeMs: stats.timeMs, cleared: stats.cleared,
          });
          save('records', records);
          return flags;
        }
        save('seen', markSeen(load('seen', []), game.results.map((r) => r.questionId), pool.length));
        return null;
      },
    });
    app.render();
    if (forced) app.startRound();
  } catch (err) {
    console.error(err);
    const t = createTranslator(dictionaries.ja ? dictionaries : { ja: { 'load.error': 'Could not load the game. / 読み込めませんでした。' } }, 'ja');
    root.replaceChildren(Object.assign(document.createElement('p'), { className: 'error-box', textContent: t('load.error') }));
  }
}

boot();
