// Pure game logic. No DOM, no storage: everything is testable in Node.

export const DEFAULT_ROUND_SIZE = 10;

/**
 * Game modes. `normal` is the original round; the others reuse the same pick/answer code and differ in size and rules.
 * `timed`: the clock runs while a question waits for an answer. `suddenDeath`: the first wrong answer ends the game.
 */
export const MODES = {
  normal: { id: 'normal', count: DEFAULT_ROUND_SIZE },
  time10: { id: 'time10', count: 10, timed: true },
  time30: { id: 'time30', count: 30, timed: true },
  survival: { id: 'survival', count: 100, suddenDeath: true },
};
export const MODE_IDS = Object.keys(MODES);
/** A time record only counts when at least this share of the questions was answered correctly. */
export const TIME_QUALIFY_RATIO = 0.7;

/** Whether a mode can be started with this pool. Never pads a game with repeated questions. */
export function modeAvailability(modeId, poolSize) {
  const mode = MODES[modeId];
  if (!mode) return { ok: false, need: 0, have: poolSize };
  if (modeId === 'normal') return { ok: poolSize > 0, need: 1, have: poolSize };
  return { ok: poolSize >= mode.count, need: mode.count, have: poolSize };
}

export function qualifyingCorrect(total) {
  return Math.ceil(total * TIME_QUALIFY_RATIO);
}

/** Stopwatch that only counts the time between start() and stop(). Times are passed in, so it is testable. */
export function createClock() {
  return { elapsed: 0, since: null };
}
export function clockStart(clock, now) {
  return clock.since == null ? { ...clock, since: now } : clock;
}
export function clockStop(clock, now) {
  return clock.since == null ? clock : { elapsed: clock.elapsed + Math.max(0, now - clock.since), since: null };
}
export function clockElapsed(clock, now) {
  return clock.elapsed + (clock.since == null ? 0 : Math.max(0, now - clock.since));
}

/**
 * A question can be put on hold (release.status "hold") while its image is being prepared;
 * held questions are kept in the data but never offered to players.
 */
export function isPlayable(q) {
  return q?.release?.status !== 'hold';
}

export function playableQuestions(questions) {
  return questions.filter(isPlayable);
}

export function shuffle(items, rng = Math.random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Picks `count` distinct questions. Questions the player has not seen yet
 * come first, so a replay shows new material before repeating old material.
 */
export function pickQuestions(pool, count = DEFAULT_ROUND_SIZE, seenIds = [], rng = Math.random) {
  const seen = new Set(seenIds);
  const unseen = shuffle(pool.filter((q) => !seen.has(q.id)), rng);
  const old = shuffle(pool.filter((q) => seen.has(q.id)), rng);
  return unseen.concat(old).slice(0, Math.min(count, pool.length));
}

export function createGame(pool, { count = DEFAULT_ROUND_SIZE, seenIds = [], rng = Math.random, mode = 'normal' } = {}) {
  const picked = pickQuestions(pool, count, seenIds, rng);
  return {
    mode,
    questions: picked.map((q) => ({ ...q, choices: shuffle(q.choices, rng) })),
    index: 0,
    results: [],
    phase: picked.length ? 'asking' : 'finished',
  };
}

export function currentQuestion(game) {
  return game.questions[game.index] ?? null;
}

/** Locks in an answer. Returns the same object when the call must be ignored. */
export function answer(game, choiceId) {
  if (game.phase !== 'asking') return game;
  const q = currentQuestion(game);
  if (!q || !q.choices.some((c) => c.id === choiceId)) return game;
  return {
    ...game,
    phase: 'answered',
    results: [
      ...game.results,
      { questionId: q.id, choiceId, correct: choiceId === q.correctChoiceId },
    ],
  };
}

export function next(game) {
  if (game.phase !== 'answered') return game;
  const index = game.index + 1;
  return isFinalStep(game)
    ? { ...game, index, phase: 'finished' }
    : { ...game, index, phase: 'asking' };
}

/** True when pressing Next ends the game: the last question, or a wrong answer in a sudden-death mode. */
export function isFinalStep(game) {
  if (game.phase !== 'answered') return false;
  if (game.index + 1 >= game.questions.length) return true;
  return Boolean(MODES[game.mode]?.suddenDeath) && !lastResult(game)?.correct;
}

/** Sudden-death result: cleared only if every question of the full set was answered correctly. */
export function survivalOutcome(game) {
  const s = summary(game);
  const wrong = game.results.find((r) => !r.correct) ?? null;
  const target = MODES.survival.count;
  return {
    cleared: !wrong && s.correct === target && game.questions.length === target,
    reached: Math.min(game.results.length, game.questions.length),
    correct: s.correct,
    wrongQuestionId: wrong?.questionId ?? null,
  };
}

/** Drops the current, unanswered question (e.g. its image cannot be loaded). */
export function skipQuestion(game) {
  if (game.phase !== 'asking') return game;
  const questions = game.questions.filter((_, i) => i !== game.index);
  return game.index >= questions.length
    ? { ...game, questions, phase: 'finished' }
    : { ...game, questions };
}

export function lastResult(game) {
  return game.results[game.results.length - 1] ?? null;
}

export function summary(game) {
  const answered = game.results.length;
  const correct = game.results.filter((r) => r.correct).length;
  return {
    total: game.questions.length,
    answered,
    correct,
    accuracy: answered ? correct / answered : 0,
    percent: answered ? Math.round((correct / answered) * 100) : 0,
  };
}

/** Remembers a played question; resets once every question has been seen. */
export function markSeen(seenIds, questionIds, poolSize) {
  const merged = Array.from(new Set([...seenIds, ...questionIds]));
  return merged.length >= poolSize ? [] : merged;
}
