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

  function scoreCandidate(p, key) {
    let s = sim(p.cand, key);
    // staart-match telt minder, zodat "VURTENSE SCHANSSTRAAT" niet twijfelt met "SCHANSSTRAAT"
    for (const t of p.tails) if (t.length >= 4) s = Math.max(s, sim(t, key) - 0.12);
    return s;
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

    function analyze(text) {
      const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const scored = [];
      for (const line of lines) {
        const p = parseLine(line);
        if (!p) continue;
        for (const st of list) {
          const s = scoreCandidate(p, st.key);
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

      const base = { street: top.street, number: top.number, score: top.score, line: top.line, otherPostcode };

      if (realRivals.length) {
        const options = [top, ...realRivals].slice(0, 4).map((m) => ({ street: m.street, number: m.number, res: resolve(m.street, m.number) }));
        return { ...base, status: 'doubt', reason: 'Straatnaam lijkt op meerdere straten', choices: options };
      }
      if (top.score < SURE_SCORE) {
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

  const api = { createMatcher, normalize, parseLine, titleCase, lev };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sorteer = api;
})(typeof window !== 'undefined' ? window : globalThis);
