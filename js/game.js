// Pure game logic. No DOM, no storage: everything is testable in Node.

export const DEFAULT_ROUND_SIZE = 10;

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

export function createGame(pool, { count = DEFAULT_ROUND_SIZE, seenIds = [], rng = Math.random } = {}) {
  const picked = pickQuestions(pool, count, seenIds, rng);
  return {
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
  return index >= game.questions.length
    ? { ...game, index, phase: 'finished' }
    : { ...game, index, phase: 'asking' };
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
