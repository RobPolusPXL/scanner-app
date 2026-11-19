// Matchlogica: straatlijst inlezen, OCR-tekst omzetten naar straat + huisnummer, ronde bepalen.
// Werkt in de browser (window.Sorteer) en in Node (module.exports) zodat het testbaar is.
(function (root) {
  'use strict';

  // Beringen: 3580 Beringen, 3581 Beverlo, 3582 Koersel, 3583 Paal
  const POSTCODES = ['3580', '3581', '3582', '3583', '3520']; // 3520 Zonhoven = testdata
  const MIN_SCORE = 0.72;   // daaronder: geen match
  const SURE_SCORE = 0.86;  // daaronder: tonen als twijfel (kandidaat aantikken)
  const GAP = 0.06;         // verschil met 2e beste straat om zeker te zijn

  function normalize(s) {
    return s
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/([A-Z])(\d)/g, '$1 $2')
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();
  }
  const compact = (s) => normalize(s).replace(/ /g, '');

  function titleCase(name) {
    return name.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }

  function parseRanges(str) {
    if (!str) return [];
    return str.split('/').map((part) => {
      const [a, b] = part.split('-').map((x) => parseInt(x, 10));
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const parity = lo !== hi && lo % 2 === hi % 2 ? lo % 2 : null;
      return { lo, hi, parity };
    });
  }

  function parseList(raw) {
    const streets = new Map();
    raw.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const [r, name, ranges, note] = line.split('|');
      const round = /^\d+$/.test(r) ? 'Res-' + r : r;
      const key = compact(name);
      if (!streets.has(key)) streets.set(key, { key, name, display: titleCase(name), entries: [] });
      streets.get(key).entries.push({ round, ranges: parseRanges(ranges), rangeText: ranges || '', note: note || '' });
    });
    return streets;
  }

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

  // Afkortingen die op enveloppen voorkomen
  const ABBR = { STR: 'STRAAT', STWG: 'STEENWEG', STEENWG: 'STEENWEG', LN: 'LAAN', PL: 'PLEIN', ST: 'SINT' };

  // Haal uit één OCR-regel een straatkandidaat en een huisnummer
  function parseLine(line) {
    const tokens = normalize(line).split(' ').filter(Boolean);
    const alpha = [];
    let number = null;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (/^\d{1,4}$/.test(t)) {
        if (alpha.length) { number = parseInt(t, 10); break; }
        continue; // getal vóór de straat (bv. postcode): overslaan
      }
      if (/^\d/.test(t)) {
        const m = t.match(/^(\d{1,4})/);
        if (alpha.length && m) { number = parseInt(m[1], 10); break; }
        continue;
      }
      let w = t;
      if (ABBR[t] && !(t === 'ST' && i > 0)) w = ABBR[t];
      else if (t.length > 4 && t.endsWith('STR')) w = t + 'AAT';
      else if (t.length > 5 && t.endsWith('STWG')) w = t.slice(0, -4) + 'STEENWEG';
      alpha.push(w);
    }
    // postcode-regel ("3580 BERINGEN"): geen adres
    if (/^\d{4}$/.test(tokens[0] || '') && number === null) return null;
    if (number !== null && number >= 1000) return null;
    const cand = alpha.join('');
    if (cand.length < 4) return null;
    // staarten per woord, voor regels met extra tekst vóór de straat ("T.A.V. ... LAAKSTRAAT 3")
    const tails = [];
    for (let j = 1; j < alpha.length; j++) tails.push(alpha.slice(j).join(''));
    return { cand, tails, number };
  }

  // Straattype achteraan, voor spraak ("Laak" = Laakstraat, "Pater Bellings" = Pater Bellinkxstraat)
  const SUFFIX = /(STEENWEG|STRAAT|LAAN|WEG|PLEIN|DREEF|PAD|STEEG|PARK|DIJK|WIJK|KAAI)$/;
  const stem = (key) => key.replace(SUFFIX, '');

  function scoreCandidate(p, key, voice) {
    let s = sim(p.cand, key);
    // staart-match telt minder, zodat "VURTENSE SCHANSSTRAAT" niet twijfelt met "SCHANSSTRAAT"
    for (const t of p.tails) if (t.length >= 4) s = Math.max(s, sim(t, key) - 0.12);
    if (voice) {
      const st = stem(key), cs = p.cand.replace(SUFFIX, '');
      if (st.length >= 3 && cs === st) s = Math.max(s, 0.95);                 // "LAAK" -> LAAKSTRAAT
      else if (cs.length >= 4 && key.startsWith(cs)) s = Math.max(s, 0.9);    // "MOLEN" -> alle MOLEN...
      if (cs.length >= 4 && st.length >= 4) s = Math.max(s, sim(cs, st) - 0.04);
    }
    return s;
  }

  // Nederlandse getalwoorden -> cijfers ("honderdvijfenveertig" -> 145), voor spraak
  const UNITS = { EEN: 1, EN: 1, TWEE: 2, DRIE: 3, VIER: 4, VIJF: 5, ZES: 6, ZEVEN: 7, ACHT: 8, NEGEN: 9 };
  const TEENS = { TIEN: 10, ELF: 11, TWAALF: 12, DERTIEN: 13, VEERTIEN: 14, VIJFTIEN: 15, ZESTIEN: 16, ZEVENTIEN: 17, ACHTTIEN: 18, NEGENTIEN: 19 };
  const TENS = { TWINTIG: 20, DERTIG: 30, VEERTIG: 40, VIJFTIG: 50, ZESTIG: 60, ZEVENTIG: 70, TACHTIG: 80, NEGENTIG: 90 };
  function parseSmall(w) {
    if (w in TEENS) return TEENS[w];
    if (w in TENS) return TENS[w];
    if (w in UNITS && w !== 'EN') return UNITS[w];
    const m = w.match(/^(EEN|TWEE|DRIE|VIER|VIJF|ZES|ZEVEN|ACHT|NEGEN)EN(TWINTIG|DERTIG|VEERTIG|VIJFTIG|ZESTIG|ZEVENTIG|TACHTIG|NEGENTIG)$/);
    return m ? UNITS[m[1]] + TENS[m[2]] : null;
  }
  function parseNumberWord(w) {
    const i = w.indexOf('HONDERD');
    if (i < 0) return parseSmall(w);
    const pre = w.slice(0, i), post = w.slice(i + 7);
    const h = pre ? parseSmall(pre) : 1;
    if (h == null || h > 9) return null;
    if (!post) return h * 100;
    const r = parseSmall(post.replace(/^EN/, ''));
    return r == null ? null : h * 100 + r;
  }
  const FILLER = new Set(['NUMMER', 'NR', 'HUISNUMMER', 'UH', 'EH', 'EUH', 'DE', 'HET']);
  function wordsToDigits(text) {
    const t = normalize(text).split(' ').filter((x) => x && !FILLER.has(x));
    const out = [];
    for (let i = 0; i < t.length; i++) {
      let done = false;
      for (let j = Math.min(t.length, i + 3); j > i; j--) {   // "honderd vijfenveertig" = 2 woorden
        const n = parseNumberWord(t.slice(i, j).join(''));
        if (n != null && !(j - i === 1 && t[i] === 'EEN' && i === 0)) { out.push(String(n)); i = j - 1; done = true; break; }
      }
      if (!done) out.push(t[i]);
    }
    return out.join(' ');
  }

  function findPostcodes(text) {
    const out = [];
    normalize(text).split(' ').forEach((t, i, arr) => {
      if (/^[1-9]\d{3}$/.test(t) && arr[i + 1] && /^[A-Z]{3,}/.test(arr[i + 1])) out.push(t);
    });
    return out;
  }

  // Bepaal de ronde voor een straat + (optioneel) huisnummer
  function resolve(street, number) {
    const e = street.entries;
    const whole = e.filter((x) => !x.ranges.length);
    const ranged = e.filter((x) => x.ranges.length);
    const uniq = (arr) => [...new Map(arr.map((x) => [x.round, x])).values()];

    if (!ranged.length) return { sure: true, entry: whole[0] };

    if (number != null) {
      const hit = (x, strict) => x.ranges.some((r) => number >= r.lo && number <= r.hi && (!strict || r.parity === null || number % 2 === r.parity));
      // exacte uitzondering (bv. nr 7 = postkantoor) eerst
      const exact = ranged.filter((x) => x.ranges.some((r) => r.lo === r.hi && r.lo === number) && x.note);
      if (exact.length) return { sure: true, entry: exact[0] };
      const strict = uniq(ranged.filter((x) => hit(x, true)));
      if (strict.length === 1) return { sure: true, entry: strict[0] };
      if (strict.length > 1) return { sure: false, options: strict, reason: 'Nummer past in meerdere reeksen' };
      if (whole.length) return { sure: true, entry: whole[0] };
      const loose = uniq(ranged.filter((x) => hit(x, false)));
      if (loose.length === 1) return { sure: false, options: loose, reason: 'Nummer ' + number + ' valt niet exact in een reeks' };
      return { sure: false, options: uniq(ranged), reason: 'Nummer ' + number + ' staat in geen enkele reeks' };
    }
    if (whole.length) return { sure: true, entry: whole[0] };
    const rounds = uniq(ranged);
    if (rounds.length === 1) return { sure: true, entry: rounds[0] };
    return { sure: false, options: rounds, reason: 'Gesplitste straat: huisnummer niet gelezen' };
  }

  function createMatcher(raw) {
    const streets = parseList(raw);
    const list = [...streets.values()];

    function analyze(text, opts) {
      const voice = !!(opts && opts.voice);
      if (voice) text = wordsToDigits(text);
      const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const scored = [];
      for (const line of lines) {
        const p = parseLine(line);
        if (!p) continue;
        for (const st of list) {
          const s = scoreCandidate(p, st.key, voice);
          if (s >= MIN_SCORE - 0.1) scored.push({ street: st, score: s, number: p.number, line });
        }
      }
      // beste score per straat
      const best = new Map();
      for (const s of scored) {
        const cur = best.get(s.street.key);
        if (!cur || s.score > cur.score || (s.score === cur.score && cur.number == null && s.number != null)) best.set(s.street.key, s);
      }
      const ranked = [...best.values()].sort((a, b) => b.score - a.score);
      const postcodes = findPostcodes(text);
      const otherPostcode = postcodes.length && !postcodes.some((p) => POSTCODES.includes(p)) ? postcodes[0] : null;

      if (!ranked.length || ranked[0].score < MIN_SCORE) return { status: 'none', otherPostcode };

      const top = ranked[0];
      const res = resolve(top.street, top.number);
      const rivals = ranked.slice(1).filter((r) => r.score >= MIN_SCORE && top.score - r.score < GAP);
      // rivalen met dezelfde ronde maken geen verschil (bv. Hemelstraat / Hemelboomstraat)
      const roundOf = (m) => { const r = resolve(m.street, m.number); return r.sure ? r.entry.round : null; };
      const topRound = res.sure ? res.entry.round : null;
      const realRivals = rivals.filter((r) => !topRound || roundOf(r) !== topRound);

      const base = { street: top.street, number: top.number, score: top.score, line: top.line, otherPostcode, heard: voice ? text : undefined };

      if (realRivals.length) {
        const options = [top, ...realRivals].slice(0, voice ? 6 : 4).map((m) => ({ street: m.street, number: m.number, res: resolve(m.street, m.number) }));
        return { ...base, status: 'doubt', reason: 'Straatnaam lijkt op meerdere straten', choices: options };
      }
      if (top.score < (voice ? 0.8 : SURE_SCORE)) {
        return { ...base, status: 'doubt', reason: 'Straatnaam niet scherp gelezen', choices: [{ street: top.street, number: top.number, res }] };
      }
      if (!res.sure) {
        return { ...base, status: 'doubt', reason: res.reason, choices: res.options.map((o) => ({ street: top.street, number: top.number, res: { sure: true, entry: o } })) };
      }
      if (otherPostcode) return { ...base, status: 'doubt', reason: 'Postcode ' + otherPostcode + ' is niet Beringen', choices: [{ street: top.street, number: top.number, res }] };
      return { ...base, status: 'sure', entry: res.entry };
    }

    return { streets, list, analyze, resolve };
  }

  const api = { createMatcher, normalize, parseLine, titleCase, lev, wordsToDigits };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sorteer = api;
})(typeof window !== 'undefined' ? window : globalThis);
