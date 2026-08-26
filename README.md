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
