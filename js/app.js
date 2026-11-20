(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  const statusEl = $('status'), resultEl = $('result'), streetEl = $('street'), roundEl = $('round'), subEl = $('sub'), choicesEl = $('choices'), debugEl = $('debug');

  const matcher = Sorteer.createMatcher(window.STRATEN_RAW);
  const HOLD_MS = 4000;     // resultaat blijft zo lang staan zonder nieuwe lezing
  const MAX_W = 1400;       // breedte van het uitgesneden beeld voor OCR

  let worker = null, running = false, lastShownKey = '', lastHit = 0, pinned = false, track = null;
  let listening = false;   // tijdens het luisteren overschrijft de camera het resultaat niet

  const setStatus = (t) => { statusEl.textContent = t; };
  // Res-021 -> "21", Rbu-901 -> "901"
  const bigRound = (round) => { const m = round.match(/(\d+)$/); return m ? String(parseInt(m[1], 10)) : round; };

  // ---------- weergave ----------
  function show(state, street, round, sub, choices) {
    resultEl.className = 'result ' + state;
    streetEl.textContent = street || '—';
    roundEl.textContent = round || '';
    subEl.textContent = sub || '';
    choicesEl.innerHTML = '';
    (choices || []).forEach((c) => {
      const b = document.createElement('button');
      b.innerHTML = c.label + (c.small ? '<small>' + c.small + '</small>' : '');
      b.addEventListener('click', c.onClick);
      choicesEl.appendChild(b);
    });
  }
  const idle = () => { pinned = false; lastShownKey = ''; show('idle', 'Houd een adres in het kader', '', ''); };

  function addressText(street, number) { return street.display + (number != null ? ' ' + number : ''); }
  function entrySub(entry) { return entry.round + (entry.note ? ' · ' + entry.note : ''); }

  function render(r) {
    const now = Date.now();
    if (r.status === 'none') {
      if (!pinned && now - lastHit > HOLD_MS) idle();
      return;
    }
    lastHit = now;
    const key = r.status + '|' + r.street.key + '|' + r.number + '|' + (r.entry ? r.entry.round : r.reason);
    if (key === lastShownKey) return;
    if (pinned && r.status !== 'sure') return; // gekozen resultaat niet overschrijven met twijfel
    pinned = false;
    lastShownKey = key;

    if (r.status === 'sure') {
      show('sure', addressText(r.street, r.number), bigRound(r.entry.round), entrySub(r.entry));
      if (navigator.vibrate) navigator.vibrate(60);
      return;
    }
    // twijfel: kandidaten aantikken
    const choices = r.choices.map((c) => {
      const entry = c.res.sure ? c.res.entry : null;
      return {
        label: entry ? bigRound(entry.round) : '?',
        small: c.street.display + (entry && entry.ranges.length ? ' (' + entry.rangeText + ')' : ''),
        onClick: () => {
          if (!entry) return;
          pinned = true; lastHit = Date.now();
          show('sure', addressText(c.street, c.number), bigRound(entry.round), entrySub(entry) + ' · gekozen');
        },
      };
    });
    show('doubt', addressText(r.street, r.number), '', r.reason, choices);
  }

  // ---------- camera + OCR ----------
  async function initWorker() {
    setStatus('Tekstherkenning laden…');
    worker = await Tesseract.createWorker('nld', 1, {
      workerPath: 'vendor/worker.min.js',
      corePath: 'vendor/core',
      langPath: 'lang',
      logger: (m) => { if (!running && m.status && m.progress < 1) setStatus(m.status + ' ' + Math.round(m.progress * 100) + '%'); },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÂÄÉÈÊËÏÎÔÖÛÜÙàâäéèêëïîôöûüùç0123456789 -/.,\'',
    });
  }

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    await video.play();
    track = stream.getVideoTracks()[0];
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) $('btnTorch').hidden = false;
      if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (e) { /* niet elke telefoon ondersteunt dit */ }
  }

  // Snij het kader uit het camerabeeld, maak grijs en verhoog contrast
  function grabFrame() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const box = $('guide').getBoundingClientRect(), vb = video.getBoundingClientRect();
    // video staat op object-fit: cover -> schermcoördinaten omrekenen naar videopixels
    const scale = Math.max(vb.width / vw, vb.height / vh);
    const offX = (vw * scale - vb.width) / 2, offY = (vh * scale - vb.height) / 2;
    const sx = Math.max(0, (box.left - vb.left + offX) / scale), sy = Math.max(0, (box.top - vb.top + offY) / scale);
    const sw = Math.min(vw - sx, box.width / scale), sh = Math.min(vh - sy, box.height / scale);
    const f = Math.min(1.6, MAX_W / sw);
    canvas.width = Math.round(sw * f); canvas.height = Math.round(sh * f);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = g; if (g < min) min = g; if (g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < d.length; i += 4) { const g = ((d[i] - min) * 255 / range) | 0; d[i] = d[i + 1] = d[i + 2] = g; }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  async function loop() {
    if (!running) return;
    const frame = grabFrame();
    if (frame) {
      const t0 = performance.now();
      try {
        const { data } = await worker.recognize(frame);
        const ms = Math.round(performance.now() - t0);
        const r = matcher.analyze(data.text || '');
        if (!listening) render(r);
        setStatus('Scannen… ' + ms + ' ms per beeld');
        if (!debugEl.hidden) debugEl.textContent = (data.text || '').trim() + '\n— ' + ms + ' ms · ' + r.status + (r.street ? ' · ' + r.street.display + ' ' + (r.number ?? '') + ' (' + r.score.toFixed(2) + ')' : '');
      } catch (e) {
        setStatus('Fout bij lezen: ' + e.message);
      }
    }
    setTimeout(loop, 30);
  }

  $('btnStart').addEventListener('click', async () => {
    const btn = $('btnStart');
    btn.disabled = true; btn.textContent = 'Bezig…';
    try {
      await Promise.all([startCamera(), worker ? null : initWorker()]);
      btn.hidden = true;
      running = true; idle();
      setStatus('Scannen…');
      loop();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Start camera';
      setStatus('Kan niet starten: ' + e.message);
    }
  });

  $('btnTorch').addEventListener('click', async () => {
    if (!track) return;
    const on = $('btnTorch').classList.toggle('on');
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch (e) { /* genegeerd */ }
  });

  $('btnDebug').addEventListener('click', () => { debugEl.hidden = !debugEl.hidden; });

  // ---------- spraak ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = $('btnMic');
  if (!SR) {
    micBtn.addEventListener('click', () => setStatus('Spraak werkt niet in deze browser: open de pagina in Chrome'));
  } else {
    let rec = null;
    micBtn.addEventListener('click', () => {
      if (listening && rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'nl-BE';
      rec.interimResults = false;
      rec.maxAlternatives = 5;
      listening = true;
      micBtn.classList.add('listening');
      micBtn.querySelector('span').textContent = 'Luisteren…';
      rec.onresult = (ev) => {
        const alts = [...ev.results[0]].map((a) => a.transcript);
        // beste alternatief: eerst zeker, dan hoogste score
        let best = null;
        for (const t of alts) {
          const r = matcher.analyze(t, { voice: true });
          r.heardText = t;
          const rank = (x) => (x.status === 'sure' ? 2 : x.status === 'doubt' ? 1 : 0) + (x.score || 0) / 10;
          if (!best || rank(r) > rank(best)) best = r;
        }
        lastHit = Date.now();   // blijft even lang staan als een scanresultaat
        lastShownKey = '';
        if (best.status === 'none') {
          show('doubt', '"' + alts[0] + '"', '', 'Niet herkend, probeer opnieuw');
        } else {
          render(best);
          if (best.status === 'doubt' && best.choices.length > 1 && best.choices[0].street !== best.choices[1].street) {
            streetEl.textContent = '"' + best.heardText + '"';   // meerdere straten: toon wat gehoord is
          } else {
            subEl.textContent = (subEl.textContent ? subEl.textContent + ' · ' : '') + 'gehoord: "' + best.heardText + '"';
          }
        }
        if (!debugEl.hidden) debugEl.textContent = 'Spraak: ' + alts.join(' | ');
      };
      rec.onerror = (ev) => {
        const msg = { 'not-allowed': 'Microfoon niet toegestaan', 'network': 'Geen internet voor spraak', 'no-speech': 'Niets gehoord' }[ev.error] || ('Spraakfout: ' + ev.error);
        setStatus(msg);
      };
      rec.onend = () => {
        listening = false;
        micBtn.classList.remove('listening');
        micBtn.querySelector('span').textContent = 'Spreek';
      };
      try { rec.start(); } catch (e) { rec.onend(); setStatus('Spraak start niet: ' + e.message); }
    });
  }

  // ---------- controlelijst ----------
  const dlg = $('listDlg'), tbody = document.querySelector('#listTable tbody');
  function renderList(filter) {
    const q = Sorteer.normalize(filter || '');
    const rows = [];
    let letter = '';
    for (const st of matcher.list) {
      for (const e of st.entries) {
        const hay = Sorteer.normalize(st.name + ' ' + e.round);
        if (q && !hay.includes(q)) continue;
        const l = st.name[0];
        if (l !== letter && !q) { letter = l; rows.push('<tr class="letter"><td colspan="3">' + l + '</td></tr>'); }
        rows.push('<tr class="' + (e.ranges.length ? 'split' : '') + '"><td>' + e.round + '</td><td>' + st.display + '</td><td>' + (e.note ? 'nr ' + e.ranges[0].lo + ' · ' + e.note : e.rangeText.replace(/\//g, ' / ')) + '</td></tr>');
      }
    }
    tbody.innerHTML = rows.join('') || '<tr><td colspan="3">Niets gevonden</td></tr>';
  }
  $('btnList').addEventListener('click', () => { renderList($('filter').value); dlg.showModal(); });
  $('btnClose').addEventListener('click', () => dlg.close());
  $('filter').addEventListener('input', (e) => renderList(e.target.value));

  setStatus(matcher.list.length + ' straten geladen');
})();
