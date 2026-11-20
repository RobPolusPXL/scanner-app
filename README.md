# Ronde Scanner

Testversie van een sorteerhulp voor BPost (Beringen: 3580–3583): houd een brief voor de camera en de app toont de straat en het rondenummer in het groot.

- **Groen** = zeker, ronde staat groot op het scherm.
- **Oranje** = twijfel (straat lijkt op een andere, gesplitste straat zonder leesbaar huisnummer, of een andere postcode). Tik de juiste ronde aan.
- **Tekst** toont wat de camera leest (om te testen), **Lijst** is de controlelijst om naast de papieren lijst te leggen.

Alles draait in de browser van de telefoon (Tesseract.js, Nederlands taalmodel), er gaat niets naar een server.

## Data
`data/straten.js` — één regel per straat: `RONDE|STRAAT|BEREIKEN|OPMERKING`.

## Testen
`node test/match.test.js` test de matchlogica op voorbeeldadressen.
