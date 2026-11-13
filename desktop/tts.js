// Kiko's natural voice, made right here on the computer (no internet): anything that wasn't recorded ahead
// of time (his name, his own writing read back, a page from a library book) is spoken by the same neural
// voice as the recordings — Kokoro-82M (Apache-2.0), voice "af_heart" — instead of the robotic Windows voice.
// The text -> phonemes steps match tools/voice/make_voice.py, so it sounds the same as the recorded lines.
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { cpus } = require('os');
const { phonemize } = require('phonemizer');

const SAMPLE_RATE = 24000;
const SPEED = 0.92;
const MAX_TOKENS = 500;

// espeak IPA (without tie marks) -> the phoneme style Kokoro was trained on (misaki), longest first
const E2M = [
  ['ʔˌn̩', 'tᵊn'], ['ʔn̩', 'tᵊn'], ['ʔn', 'tᵊn'], ['ʔ', 't'],
  ['aɪ', 'I'], ['aʊ', 'W'], ['dʒ', 'ʤ'], ['eɪ', 'A'], ['tʃ', 'ʧ'], ['ɔɪ', 'Y'], ['oʊ', 'O'], ['ɚ', 'əɹ'],
  ['e', 'A'], ['r', 'ɹ'], ['x', 'k'], ['ç', 'k'], ['ɐ', 'ə'], ['ɬ', 'l'], ['ʲ', ''],
];
const LEXICON = {
  ow: 'ˈW', kiko: 'kˈikO', ackee: 'ˈæki', callaloo: 'kˈæləlˌu', jamaica: 'ʤəmˈAkə', patois: 'pˈætwɑ', maths: 'mˈæθs',
  zed: 'zˈɛd', 'yo-yo': 'jˈOjˌO', ochi: 'ˈOʧi',
};
const VOWEL = 'aeiouæɑɒɔəɛɜɪʊʌAIOWYᵊ';

function toMisaki(ps) {
  // a syllabic l ("apple", "table"): espeak writes ə^l with a tie; without ties, an əl not followed by a vowel
  ps = ps.replace(/əl(?![ˈˌ]|[aeiouæɑɒɔəɛɜɪʊʌ])/g, 'ᵊl');
  ps = ps.replace(/oː?ɹ/g, 'ɔɹ'); // "four", "your": this espeak says oɹ where the recordings' one says ɔɹ
  for (const [a, b] of E2M) ps = ps.split(a).join(b);
  ps = ps.replace(/(\S)̩/g, 'ᵊ$1').replace(/̩/g, '');
  ps = ps.replace(/ɜːɹ/g, 'ɜɹ').replace(/ɜː/g, 'ɜɹ').replace(/ɪə/g, 'iə').replace(/ː/g, '');
  ps = ps.replace(/ɹɹ+/g, 'ɹ'); // a doubled r inside one word only: "for writing" keeps both r's
  return ps;
}

function speakable(text) {
  return String(text)
    .replace(/[\u{1F000}-\u{1FAFF}☀-➿⬀-⯿️‍⃣]/gu, ' ')
    .replace(/&/g, ' and ').replace(/_/g, ' ').replace(/…/g, '...')
    .replace(/(\d)\s*\+\s*(\d)/g, '$1 plus $2').replace(/(\d)\s*[−–-]\s*(\d)/g, '$1 minus $2')
    .replace(/(\d)\s*[×x]\s*(\d)/g, '$1 times $2').replace(/(\d)\s*÷\s*(\d)/g, '$1 divided by $2')
    .replace(/\s=\s/g, ' equals ').replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d)\.(\d)/g, '$1 point $2').replace(/(\d):(\d\d)/g, '$1 $2') // 0.2 and 12:55 are one phrase, not two
    .replace(/\s+/g, ' ').trim();
}

/** Text -> misaki phonemes, keeping the punctuation (Kokoro pauses on it). */
async function phonemesOf(text) {
  const t = speakable(text);
  if (!t) return '';
  // pieces of words between punctuation marks; words in the lexicon are written out directly
  const out = [];
  const re = /([^.,!?;:—…"()]+)([.,!?;:—…"()]*)/g; let m;
  while ((m = re.exec(t))) {
    const words = m[1].trim().split(/\s+/).filter(Boolean);
    const punct = m[2].replace(/\.{2,}/g, '…').replace(/["()]/g, '').slice(0, 1);
    let buf = []; const parts = [];
    const flush = async () => {
      if (!buf.length) return;
      const ph = (await phonemize(buf.join(' '), 'en-us')).join(' ');
      if (ph.trim()) parts.push(toMisaki(ph.trim()));
      buf = [];
    };
    for (const w of words) {
      const key = w.toLowerCase().replace(/^[^a-z]+|[^a-z-]+$/g, '');
      if (LEXICON[key]) { await flush(); parts.push(LEXICON[key]); } else buf.push(w);
    }
    await flush();
    if (parts.length) out.push(parts.join(' ') + punct);
  }
  return out.join(' ').trim();
}

let ort = null, session = null, voice = null, vocab = null, loading = null;
function available(dir) { return ['kokoro.onnx', 'af_heart.bin', 'vocab.json'].every((f) => existsSync(join(dir, f))); }

function load(dir) {
  if (!loading) {
    loading = (async () => {
      ort = require('onnxruntime-node');
      session = await ort.InferenceSession.create(join(dir, 'kokoro.onnx'), {
        intraOpNumThreads: Math.max(1, Math.min(4, cpus().length - 1)), graphOptimizationLevel: 'all', executionProviders: ['cpu'],
      });
      const b = readFileSync(join(dir, 'af_heart.bin'));
      voice = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      vocab = JSON.parse(readFileSync(join(dir, 'vocab.json'), 'utf8'));
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

function tokensOf(ph) {
  const ids = [];
  for (const ch of ph) { const id = vocab[ch]; if (id !== undefined) ids.push(id); }
  return ids;
}

/** Split long phonemes at sentence (then clause, then word) ends, so each piece fits the model. */
function batches(ph) {
  const out = [];
  let rest = ph;
  while (rest.length > MAX_TOKENS) {
    let cut = -1;
    for (const re of [/[.!?…]\s/g, /[,;:—]\s/g, /\s/g]) {
      let m; re.lastIndex = 0;
      while ((m = re.exec(rest)) && m.index < MAX_TOKENS) cut = m.index + 1;
      if (cut > 0) break;
    }
    if (cut <= 0) cut = MAX_TOKENS;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function infer(ph, speed) {
  const ids = tokensOf(ph);
  if (!ids.length) return new Float32Array(0);
  const n = Math.min(ids.length, 510);
  const tokens = new ort.Tensor('int64', BigInt64Array.from([0, ...ids.slice(0, 510), 0].map((x) => BigInt(x))), [1, n + 2]);
  const style = new ort.Tensor('float32', voice.slice((n - 1) * 256, n * 256), [1, 256]);
  const sp = new ort.Tensor('float32', Float32Array.from([speed]), [1]);
  const names = session.inputNames;
  const feeds = { [names.includes('input_ids') ? 'input_ids' : 'tokens']: tokens, style, speed: sp };
  const res = await session.run(feeds);
  return res[session.outputNames[0]].data;
}

/** Trim the quiet ends and even out the loudness (like the recorded lines). */
function finish(a) {
  const fr = 120; let s = 0; let e = a.length;
  const loud = (i) => { let mx = 0; for (let k = i; k < Math.min(a.length, i + fr); k++) mx = Math.max(mx, Math.abs(a[k])); return mx > 0.012; };
  while (s < a.length && !loud(s)) s += fr;
  while (e > s && !loud(e - fr)) e -= fr;
  s = Math.max(0, s - Math.round(0.04 * SAMPLE_RATE)); e = Math.min(a.length, e + Math.round(0.06 * SAMPLE_RATE));
  const out = a.slice(s, e);
  let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) { const g = 0.89 / peak; for (let i = 0; i < out.length; i++) out[i] *= g; }
  return out;
}

/** After the first clear pause (120 ms or more): used to cut off a throwaway "Okay." said first. */
function afterFirstPause(a) {
  const fr = Math.round(0.01 * SAMPLE_RATE);
  const env = [];
  for (let i = 0; i + fr <= a.length; i += fr) { let e = 0; for (let k = i; k < i + fr; k++) e += a[k] * a[k]; env.push(Math.sqrt(e / fr)); }
  const max = Math.max(...env, 0);
  const thr = Math.max(0.008, max * 0.06);
  let i = 0;
  while (i < env.length && env[i] < thr) i++; // leading quiet
  for (; i < env.length; i++) {
    if (env[i] >= thr) continue;
    let j = i; while (j < env.length && env[j] < thr) j++;
    if (j - i >= 12 && j < env.length) return a.slice(Math.max(0, j * fr - Math.round(0.02 * SAMPLE_RATE)));
    i = j;
  }
  return null;
}

const cache = new Map();
/** Speak text: resolves to 24 kHz mono samples (Float32Array). */
async function synth(dir, text, { speed = SPEED } = {}) {
  const key = speed + '|' + text;
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  await load(dir);
  let ph = await phonemesOf(text);
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  // The voice is unreliable right at the start: a word said on its own gets a stray sound in front ("rain" ->
  // "a rain"), and a first "I" can be swallowed. A short word is said after a throwaway "Okay." that is cut off;
  // a sentence starting with "I" gets a short lead-in pause.
  if (words.length <= 2) {
    const cut = afterFirstPause(await infer('ˈOkˌA. ' + ph, speed));
    if (cut && cut.length > SAMPLE_RATE * 0.12) {
      const out = finish(cut);
      cache.set(key, out);
      return out;
    }
  } else if (/^I\b/.test(String(text).trim())) ph = '… ' + ph;
  const pieces = [];
  for (const b of batches(ph)) pieces.push(finish(await infer(b, speed)));
  const gap = Math.round(0.25 * SAMPLE_RATE);
  const total = pieces.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, pieces.length - 1);
  const out = new Float32Array(total);
  let at = 0;
  pieces.forEach((p, i) => { out.set(p, at); at += p.length + (i < pieces.length - 1 ? gap : 0); });
  cache.set(key, out);
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return out;
}

module.exports = { SAMPLE_RATE, toMisaki, speakable, phonemesOf, available, load, infer, synth };
