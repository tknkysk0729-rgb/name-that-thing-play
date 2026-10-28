// Personal records, kept per mode in localStorage under one key ("records"). Pure functions: storage is done by the caller.
// Older saves have no "records" key at all; anything malformed is ignored rather than trusted.
import { qualifyingCorrect } from './game.js';

export const RECORDS_VERSION = 1;
const TIMED = ['time10', 'time30'];

const num = (v, min = 0) => (Number.isFinite(v) && v >= min ? v : null);

export function emptyRecords() {
  return { v: RECORDS_VERSION, time10: null, time30: null, survival: null };
}

function cleanTimed(r) {
  if (!r || typeof r !== 'object') return null;
  const plays = Math.floor(num(r.plays) ?? 0);
  const bestTimeMs = num(r.bestTimeMs, 1);
  const bestTimeCorrect = num(r.bestTimeCorrect);
  const bestCorrect = num(r.bestCorrect);
  const bestCorrectMs = num(r.bestCorrectMs, 1);
  return { plays, bestTimeMs, bestTimeCorrect, bestCorrect, bestCorrectMs };
}

function cleanSurvival(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    plays: Math.floor(num(r.plays) ?? 0),
    bestCorrect: Math.floor(num(r.bestCorrect) ?? 0),
    clears: Math.floor(num(r.clears) ?? 0),
  };
}

export function normalizeRecords(raw) {
  const out = emptyRecords();
  if (!raw || typeof raw !== 'object') return out;
  for (const id of TIMED) out[id] = cleanTimed(raw[id]);
  out.survival = cleanSurvival(raw.survival);
  return out;
}

/**
 * Applies one finished play. `play` = { mode, total, correct, timeMs, cleared }.
 * Time modes: the best time only counts plays with at least 70% correct (so rushing through with wrong answers is not a record);
 * "most correct" is kept separately, ties broken by the shorter time.
 * Survival: best = most consecutive correct answers; clears counts full 100/100 runs.
 * Returns { records, flags }.
 */
export function applyPlay(records, play) {
  const rec = normalizeRecords(records);
  const flags = { newBestTime: false, newBestCorrect: false, qualified: false, firstPlay: false, previous: null };
  if (TIMED.includes(play.mode)) {
    const prev = rec[play.mode] ?? { plays: 0, bestTimeMs: null, bestTimeCorrect: null, bestCorrect: null, bestCorrectMs: null };
    flags.firstPlay = prev.plays === 0;
    flags.previous = { ...prev };
    const next = { ...prev, plays: prev.plays + 1 };
    flags.qualified = play.correct >= qualifyingCorrect(play.total);
    if (flags.qualified && (prev.bestTimeMs == null || play.timeMs < prev.bestTimeMs)) {
      next.bestTimeMs = play.timeMs; next.bestTimeCorrect = play.correct; flags.newBestTime = true;
    }
    if (prev.bestCorrect == null || play.correct > prev.bestCorrect
      || (play.correct === prev.bestCorrect && play.timeMs < (prev.bestCorrectMs ?? Infinity))) {
      next.bestCorrect = play.correct; next.bestCorrectMs = play.timeMs;
      flags.newBestCorrect = prev.bestCorrect == null || play.correct > prev.bestCorrect;
    }
    rec[play.mode] = next;
  } else if (play.mode === 'survival') {
    const prev = rec.survival ?? { plays: 0, bestCorrect: 0, clears: 0 };
    flags.firstPlay = prev.plays === 0;
    flags.previous = { ...prev };
    rec.survival = {
      plays: prev.plays + 1,
      bestCorrect: Math.max(prev.bestCorrect, play.correct),
      clears: prev.clears + (play.cleared ? 1 : 0),
    };
    flags.newBestCorrect = play.correct > prev.bestCorrect;
  }
  return { records: rec, flags };
}

/** 83400 -> "1:23.4"; 23400 -> "0:23.4" (minutes:seconds.tenths). */
export function formatTime(ms) {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const s = Math.floor(tenths / 10), d = tenths % 10;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${d}`;
}
