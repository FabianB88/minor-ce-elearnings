# E-learnings Minor Circulaire Economie

Statische site die SCORM 1.2-pakketten afspeelt zonder LMS. Bedoeld om de
e-learnings van de minor buiten Brightspace te kunnen aanbieden.

## Hoe het werkt

SCORM-inhoud zoekt bij het opstarten een JavaScript-object dat `API` heet,
omhoog via `window.parent` en `window.opener`. `player.html` zet dat object
klaar voordat het iframe laadt, dus de inhoud vindt het en praat ermee alsof
het een LMS is.

Alles gaat naar `localStorage`, per cursus, onder de sleutel `scorm12:<slug>`.

## Wat je hiermee wel en niet krijgt

Wel: de cursus draait, onthoudt waar je gebleven was, telt bestede tijd op,
bewaart quizantwoorden en laat je hervatten of opnieuw beginnen.

Niet: er is geen server, dus geen centrale registratie. Voortgang leeft in de
browser van die ene student. Andere laptop, incognito of browsergegevens
gewist betekent opnieuw beginnen. Docenten kunnen niet zien wie wat af heeft,
en er gaat geen cijfer terug naar een LMS. Dat is een gevolg van statische
hosting, niet van deze implementatie.

Eén meevaller: `cmi.suspend_data` is in SCORM 1.2 officieel beperkt tot 4096
tekens en Articulate Rise gaat daar routineus overheen, wat in echte LMS'en
regelmatig misgaat. `localStorage` kent die grens niet.

## Twee soorten cursussen

**Eigen modules** (`cursus.html?m=<slug>`) draaien op onze eigen speler. De inhoud
staat als schone JSON in `modules/<slug>/course.json`, het beeldmateriaal in
`modules/<slug>/media/`. Geen Articulate, geen SCORM, geen iframe: gewoon HTML die
we zelf kunnen aanpassen.

**SCORM-pakketten** (`player.html?c=<slug>`) draaien in de SCORM-speler, met het
Articulate-pakket ongewijzigd in een iframe. Handig zolang een cursus nog niet is
omgezet.

In `courses.json` bepaalt het veld `href` welke van de twee een cursus gebruikt.

## Een Rise-cursus omzetten naar een eigen module

```bash
python tools/build-module.py courses/<slug>/scormcontent/index.html <slug> tools/<slug>.patches.json
```

De Rise-export bewaart de hele cursus als base64-JSON in `scormcontent/index.html`.
Het script leest die, vertaalt de blokken en kopieert het beeldmateriaal naar
`modules/<slug>/media/`.

Kon je in Rise wijzigingen niet meer publiceren? Zet ze dan in een patchbestand
(zie `tools/business-ethics.patches.json`): daarin overschrijf je titels en
vervang of verwijder je losse blokken, zonder de export opnieuw te hoeven maken.

Ondersteunde bloktypen: tekst, opsomming, afbeelding, YouTube-video, tabbladen,
meerkeuze, meervoudige keuze en koppelvragen. De doorgaan-blokken van Rise worden
de knoppen waarmee de student stap voor stap door de module klikt.

## De bouwvolgorde van een module

`modules/<slug>/course.json` wordt gegenereerd. Wijzig dat bestand niet met de
hand; draai in plaats daarvan deze drie stappen achter elkaar:

```bash
python tools/build-module.py courses/<slug>/scormcontent/index.html <slug> tools/<slug>.patches.json
python tools/opschonen.py <slug>
python tools/vragen.py <slug>
```

1. **build-module** haalt de cursus uit de Rise-export en vertaalt de blokken.
2. **opschonen** herstelt opmaakschade uit de Word-naar-Rise-conversie: verdwenen
   alineagrenzen, aan elkaar geplakte zinnen, opsommingen die hun structuur
   kwijt zijn, harde kleuren uit Word, en koppen die op drie niveaus door elkaar
   stonden. Ook zet het bijschriften bij het beeldmateriaal.
3. **vragen** zet terugkoppelingen bij de vragen, herschrijft antwoordopties,
   splitst te lange leesstappen en voegt nieuwe vragen en schema's toe. De
   inhoud daarvan staat in `tools/<slug>_vragen.json`.

Alle drie zijn idempotent: nog een keer draaien verandert niets. Wil je iets aan
de inhoud veranderen, pas dan het patch- of vragenbestand aan en draai opnieuw.

## Bloktypen in een module

`text`, `list`, `image`, `video`, `tabs`, `quiz` (meerkeuze en meervoudig),
`match` (koppelvraag), `svg` (schema) en `continue` (de doorgaan-knop die de
inhoud in leesstappen verdeelt).

Een `svg`-blok bevat een inline schema dat de kleurtokens van het thema gebruikt,
plus een `alt` voor schermlezers en een `caption` eronder.

## Een cursus toevoegen

```bash
python tools/add-course.py "pad/naar/pakket.zip"
```

Het script pakt het pakket uit in `courses/<slug>/`, leest titel en
startbestand uit `imsmanifest.xml` en zet de cursus in `courses.json`. Vul
daarna nog een `description` in. Een eigen slug meegeven kan ook:

```bash
python tools/add-course.py "pakket.zip" business-ethics
```

## Lokaal draaien

De pagina's halen `courses.json` op met `fetch`, en dat werkt niet vanaf
`file://`. Start dus een servertje:

```bash
python -m http.server 9612 --directory .
```

Daarna `http://localhost:9612/`.

## Wijzigingen in CSS of JavaScript

GitHub Pages cachet `assets/`. Verhoog daarom het versienummer in de
`?v=` achter `style.css` en `scorm12-api.js` in `index.html` en `player.html`
zodra je die bestanden aanpast, anders blijven bezoekers de oude versie zien.

## Zelftest

`player.html?c=__zelftest__` draait 30 controles op de API: de levenscyclus,
lees- en schrijfrechten, foutcodes, arrays, grote `suspend_data`, opslag en
hervatten. Handig na elke wijziging aan `assets/scorm12-api.js`.

## Bestanden

| | |
|---|---|
| `index.html` | overzicht met status per cursus |
| `player.html` | iframe plus de API, opent met `?c=<slug>` |
| `assets/scorm12-api.js` | de SCORM 1.2-implementatie |
| `courses.json` | welke cursussen er zijn en waar ze starten |
| `courses/` | uitgepakte pakketten, inhoud blijft ongewijzigd |
| `tools/add-course.py` | pakket importeren |
| `test/zelftest.html` | de zelftest |

## Afschermen

GitHub Pages kan dit niet afschermen: er is geen server die kan controleren
wie je bent, dus een inlogscherm in JavaScript is een gordijn en geen slot.
De bestanden blijven rechtstreeks opvraagbaar. Ook een privé-repo helpt niet,
want de gepubliceerde Pages-site is op een gewoon account alsnog openbaar.

Wil je een echte poort, host dan op Cloudflare Pages en zet Cloudflare Access
ervoor. Zelfde bestanden, zelfde git-workflow, gratis tot 50 gebruikers, en de
toegangsregel kan op e-maildomein (`@student.han.nl`) of Google-inlog.

Staat Access ervoor, dan kun je de student later ook echt bij naam noemen in
plaats van "Student": Access biedt `/cdn-cgi/access/get-identity`, dat de
ingelogde identiteit als JSON teruggeeft. Doorgeven aan
`SCORM12.setLearner({ id: ..., name: ... })` en `cmi.core.student_name` klopt.
