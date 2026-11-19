// Draai met: node test/match.test.js
const fs = require('fs');
const vm = require('vm');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/../data/straten.js', 'utf8'), ctx);
const { createMatcher } = require('../js/match.js');
const m = createMatcher(ctx.window.STRATEN_RAW);

const cases = [
  ['Jan Peeters\nLaakstraat 12\n3580 Beringen', 'sure', 'Res-028'],
  ['Familie Janssens\nLaakstrat 12\n3583 PAAL', 'sure', 'Res-028'],          // OCR-foutje
  ['Mevr. X\nHeerbaan 145\n3580 Beringen', 'sure', 'Res-038'],
  ['Heerbaan 320\n3580 Beringen', 'sure', 'Res-025'],
  ['Mathias Geysenstraat 53\n3580 Beringen', 'sure', 'Res-026'],
  ['Mathias Geysenstraat 92', 'sure', 'Res-026'],
  ['Korspelheidestraat 10\n3580 Beringen', 'sure', 'Res-025'],
  ['Korspelheidestraat 150', 'sure', 'Res-023'],
  ['Valentijnstraat 17', 'sure', 'Res-026'],
  ['Ward Schoutedenstraat 7\n3580 Beringen', 'sure', 'Rbu-901'],
  ['Ward Schoutedenstraat 9\n3580 Beringen', 'sure', 'Res-036'],
  ['Collegestraat 1', 'sure', 'Rbu-036'],
  ['Collegestraat 9', 'sure', 'Res-016'],
  ['Hemelstraat 4', 'sure', 'Res-031'],
  ['Pater Bellinkxstraat 22', 'sure', 'Res-032'],
  ['Sint-Jorisstraat 50 bus 2', 'sure', 'Res-011'],
  ['St.-Jorisstraat 12', 'sure', 'Res-012'],
  ['Laakstr. 3', 'sure', 'Res-028'],
  ['Heilig Hartstraat 5', 'sure', 'Res-023'],
  ['Vurtense Schansstraat 2', 'sure', 'Res-028'],
  ['Rijsselstraat 100', 'sure', 'Res-015'],
  ['Rijsselstraat 50', 'sure', 'Res-014'],
  ['Heerbaan\n3580 Beringen', 'doubt', null],                 // gesplitst zonder nummer
  ['Laakstraat 12\n3500 Hasselt', 'doubt', null],           // andere gemeente
  ['Kerkstraat 12\n3580 Beringen', 'sure', 'Res-019'],
  ['Kerkplein 2\n3580 Beringen', 'sure', 'Res-026'],
  ['Koolmijnlaan 250\n3582 Koersel', 'sure', 'Res-020'],
  ['Laakstraat 12\n3560 Lummen', 'doubt', null],           // andere gemeente
  ['Buitenhof 65\n3520 Zonhoven', 'sure', 'Res-050'],         // testdata
  ['Factuur nr 123456\nBetalen voor 12/12', 'none', null],
  ['Molenstraat 4', 'none-or-doubt', null],                 // bestaat niet
];
// Spraak: [tekst, status, ronde]
const voice = [
  ['Laakstraat 12', 'sure', 'Res-028'],
  ['laak', 'sure', 'Res-028'],
  ['Pater Bellings', 'sure', 'Res-032'],
  ['hemel', 'sure', 'Res-031'],
  ['Heilig Hart', 'sure', 'Res-023'],
  ['Laan op Heusden', 'sure', 'Res-030'],
  ['Heerbaan honderdvijfenveertig', 'sure', 'Res-038'],
  ['Heerbaan tweehonderd achtendertig', 'sure', 'Res-038'],
  ['Heerbaan 320', 'sure', 'Res-025'],
  ['Mathias Geysen drieënvijftig', 'sure', 'Res-026'],
  ['Korspelheide nummer drie', 'sure', 'Res-025'],
  ['Valentijn vijf', 'sure', 'Res-026'],
  ['Orgelwinning', 'sure', 'Res-038'],
  ['Graaf van Loon', 'sure', 'Res-036'],
  ['Vurtense Schans', 'sure', 'Res-028'],
  ['Molen', 'doubt', null],
  ['Heerbaan', 'doubt', null],
];
let fail = 0;
for (const [text, status, round] of voice) {
  const r = m.analyze(text, { voice: true });
  const got = r.status === 'sure' ? r.entry.round : null;
  const ok = r.status === status && (round === null || got === round);
  if (!ok) fail++;
  console.log((ok ? 'OK  ' : 'FOUT') + ' | spraak "' + text + '" -> ' + r.status + ' ' + (got || '') + (r.street ? ' [' + r.street.display + ' ' + (r.number ?? '') + ' ' + r.score.toFixed(2) + ']' : '') + (r.reason ? ' (' + r.reason + ')' : ''));
}
for (const [text, status, round] of cases) {
  const r = m.analyze(text);
  const got = r.status === 'sure' ? r.entry.round : null;
  const ok = (status === 'none-or-doubt' ? r.status !== 'sure' : r.status === status) && (round === null || got === round);
  if (!ok) fail++;
  console.log((ok ? 'OK  ' : 'FOUT') + ' | ' + text.replace(/\n/g, ' / ') + ' -> ' + r.status + ' ' + (got || '') + (r.street ? ' [' + r.street.display + ' ' + (r.number ?? '') + ' ' + r.score.toFixed(2) + ']' : '') + (r.reason ? ' (' + r.reason + ')' : ''));
}
console.log(m.list.length + ' straten, ' + (cases.length + voice.length - fail) + '/' + (cases.length + voice.length) + ' geslaagd');
process.exit(fail ? 1 : 0);
