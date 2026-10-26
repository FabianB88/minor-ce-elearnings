/*
 * Eigen e-learningspeler.
 *
 * Twee schermen: een startpagina met de modulelijst, en een leesscherm per
 * module. Binnen een module krijg je de inhoud stuk voor stuk: je leest een
 * segment, klikt op doorgaan, en het volgende verschijnt. Zit er een
 * kennisvraag in het segment, dan gaat de knop pas open als je hem beantwoord
 * hebt.
 *
 * Voortgang staat in localStorage, per cursus. Geen server, geen inlog.
 */
(function () {
  'use strict';

  var cursus = null;
  var staat = null;
  var sleutel = '';

  /* ------------------------------------------------------------ opslag */

  function leesStaat() {
    try {
      return JSON.parse(localStorage.getItem(sleutel) || 'null') || { modules: {} };
    } catch (e) {
      return { modules: {} };
    }
  }

  function bewaar() {
    try { localStorage.setItem(sleutel, JSON.stringify(staat)); } catch (e) { /* privacymodus */ }
  }

  function moduleStaat(id) {
    if (!staat.modules[id]) staat.modules[id] = { segment: 0, af: false, antwoorden: {} };
    return staat.modules[id];
  }

  /* ------------------------------------------------------------ hulp */

  function el(tag, klasse, tekst) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (tekst !== undefined && tekst !== null) e.textContent = tekst;
    return e;
  }

  function html(tag, klasse, inhoud) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (inhoud) e.innerHTML = inhoud;
    return e;
  }

  /* Blokken opdelen in segmenten: elk stuk tot aan een doorgaan-knop. */
  function segmenteer(blokken) {
    var segmenten = [];
    var huidig = [];
    blokken.forEach(function (b) {
      if (b.t === 'continue') {
        segmenten.push(huidig);
        huidig = [];
      } else {
        huidig.push(b);
      }
    });
    if (huidig.length) segmenten.push(huidig);
    return segmenten.filter(function (s) { return s.length; });
  }

  function vraagId(moduleId, segIndex, blokIndex) {
    return moduleId + ':' + segIndex + ':' + blokIndex;
  }

  /* ------------------------------------------------------------ startpagina */

  function toonStart() {
    location.hash = '';
    document.body.innerHTML = '';
    document.title = cursus.title + ' | Circulaire Economie';

    var totaalSeg = 0, gedaanSeg = 0;
    cursus.lessons.forEach(function (les) {
      var segs = segmenteer(les.blocks).length;
      var ms = moduleStaat(les.id);
      totaalSeg += segs;
      gedaanSeg += Math.min(ms.af ? segs : ms.segment, segs);
    });
    var percentage = totaalSeg ? Math.round((gedaanSeg / totaalSeg) * 100) : 0;
    var begonnen = gedaanSeg > 0;

    var hero = el('header', 'hero');
    var binnen = el('div', 'hero-inner');

    binnen.appendChild(el('p', 'kicker', 'Circulaire Economie'));
    binnen.appendChild(el('h1', null, cursus.title));
    if (cursus.subtitle) binnen.appendChild(el('p', 'sub', cursus.subtitle));

    if (cursus.author) {
      var au = el('div', 'auteur');
      var initialen = cursus.author.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
      au.appendChild(el('span', 'bol', initialen));
      au.appendChild(el('span', null, 'Door ' + cursus.author));
      binnen.appendChild(au);
    }

    var allesAf = cursus.lessons.every(function (l) { return moduleStaat(l.id).af; });
    var start = el('button', 'btn-groot',
      allesAf ? 'Cursus opnieuw bekijken'
              : (begonnen ? 'Verder waar je gebleven was' : 'Start de cursus'));
    start.type = 'button';
    start.addEventListener('click', function () {
      var doel = cursus.lessons.find(function (l) { return !moduleStaat(l.id).af; }) || cursus.lessons[0];
      openModule(doel.id);
    });
    binnen.appendChild(start);

    if (begonnen) {
      var vb = el('div', 'voortgangsbalk');
      var spoor = el('div', 'spoor');
      var vulling = el('div', 'vulling');
      vulling.style.width = percentage + '%';
      spoor.appendChild(vulling);
      vb.appendChild(spoor);
      vb.appendChild(el('div', 'tekst', percentage + '% van de cursus doorlopen'));
      binnen.appendChild(vb);
    }

    hero.appendChild(binnen);
    document.body.appendChild(hero);

    var lijst = el('div', 'modules');
    if (cursus.intro) {
      var intro = el('p', null, cursus.intro);
      intro.style.cssText = 'margin:0 0 1.75rem;padding-top:3rem;color:var(--text-muted);font-size:0.9rem;line-height:1.65';
      lijst.appendChild(intro);
    }

    cursus.lessons.forEach(function (les, i) {
      var segs = segmenteer(les.blocks).length;
      var ms = moduleStaat(les.id);
      var gedaan = ms.af ? segs : Math.min(ms.segment, segs);
      var pct = segs ? Math.round((gedaan / segs) * 100) : 0;

      var kaart = el('button', 'module-kaart' + (ms.af ? ' af' : (gedaan > 0 ? ' bezig' : '')));
      kaart.type = 'button';

      kaart.appendChild(el('span', 'nummer', ms.af ? '✓' : String(i + 1)));

      var midden = el('span');
      midden.appendChild(el('span', null, '')).outerHTML = '';
      var kop = el('h2', null, les.title);
      midden.appendChild(kop);

      var regel = el('span', 'regel');
      if (les.deadline) regel.appendChild(el('span', 'deadline', 'Afronden vóór ' + les.deadline));
      regel.appendChild(el('span', null, ms.af ? 'Afgerond' : (gedaan > 0 ? pct + '% gelezen' : segs + ' onderdelen')));
      if (gedaan > 0 && !ms.af) {
        var mini = el('span', 'mini-spoor');
        var i2 = el('i');
        i2.style.width = pct + '%';
        mini.appendChild(i2);
        regel.appendChild(mini);
      }
      midden.appendChild(regel);
      kaart.appendChild(midden);
      kaart.appendChild(el('span', 'pijl', '→'));

      kaart.addEventListener('click', function () { openModule(les.id); });
      lijst.appendChild(kaart);
    });

    document.body.appendChild(lijst);
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ blokweergave */

  function tekenBlok(blok, moduleId, segIndex, blokIndex, opWijziging) {
    switch (blok.t) {

      case 'text': {
        var wrap = el('div', 'blok');
        if (blok.heading) wrap.appendChild(el('h2', null, blok.heading));
        if (blok.body) wrap.appendChild(html('div', null, blok.body));
        return wrap;
      }

      case 'list': {
        var lijst = html(blok.ordered ? 'ol' : 'ul', null, '');
        blok.items.forEach(function (i) { lijst.appendChild(html('li', null, i)); });
        var w = el('div', 'blok');
        w.appendChild(lijst);
        return w;
      }

      case 'image': {
        var fig = el('figure', 'beeld');
        var img = document.createElement('img');
        /* Bewust geen loading="lazy": een segment komt pas in beeld op het
           moment dat de student doorklikt, dus de afbeelding is dan ook meteen
           nodig. Lazy laden zou hier alleen een extra afhankelijkheid van de
           zichtbaarheid van het tabblad opleveren. De afmetingen staan erbij,
           zodat de tekst niet verspringt terwijl hij laadt. */
        img.decoding = 'async';
        img.alt = blok.caption || '';
        if (blok.w) { img.width = blok.w; img.height = blok.h; }
        img.src = blok.src;
        fig.appendChild(img);
        if (blok.caption) fig.appendChild(el('figcaption', null, blok.caption));
        return fig;
      }

      case 'video': {
        var houder = el('div');
        if (blok.url) {
          /* Video op een site die niet in een iframe wil, zoals NOS of NASA. */
          var ext = el('a', 'video-extern');
          ext.href = blok.url;
          ext.target = '_blank';
          ext.rel = 'noopener';
          ext.appendChild(el('span', 'speel', '▶'));
          var tekstje = el('span');
          tekstje.appendChild(el('strong', null, blok.title || 'Video'));
          tekstje.appendChild(el('span', 'bron', 'Bekijk de video op ' + new URL(blok.url).hostname.replace(/^www\./, '') + ' ↗'));
          ext.appendChild(tekstje);
          houder.appendChild(ext);
          return houder;
        }
        var kader = el('div', 'video');
        var fr = document.createElement('iframe');
        if (blok.vimeo) {
          fr.src = 'https://player.vimeo.com/video/' + blok.vimeo + '?dnt=1';
        } else {
          var params = 'rel=0&modestbranding=1';
          if (blok.start) params += '&start=' + blok.start;
          fr.src = 'https://www.youtube-nocookie.com/embed/' + blok.youtube + '?' + params;
        }
        fr.title = blok.title || 'Video';
        fr.loading = 'lazy';
        fr.allow = 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen';
        fr.allowFullscreen = true;
        kader.appendChild(fr);
        houder.appendChild(kader);
        if (blok.title) houder.appendChild(el('div', 'video-titel', blok.title));
        return houder;
      }

      case 'tabs': {
        var t = el('div', 'tabs');
        var knoppen = el('div', 'tab-knoppen');
        knoppen.setAttribute('role', 'tablist');
        var inhoud = el('div', 'tab-inhoud');
        blok.items.forEach(function (tab, i) {
          var k = el('button', null, tab.title);
          k.type = 'button';
          k.setAttribute('role', 'tab');
          k.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
          k.addEventListener('click', function () {
            knoppen.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', 'false'); });
            k.setAttribute('aria-selected', 'true');
            inhoud.innerHTML = tab.body;
          });
          knoppen.appendChild(k);
        });
        inhoud.innerHTML = blok.items[0] ? blok.items[0].body : '';
        t.appendChild(knoppen);
        t.appendChild(inhoud);
        return t;
      }

      case 'svg': {
        /* Een schema in plaats van nog een alinea. De SVG gebruikt currentColor
           en de kleurtokens, zodat hij meebeweegt met het thema. */
        var fig = el('figure', 'schema');
        var doos = el('div', 'schema-vlak');
        doos.innerHTML = blok.svg;
        var s = doos.querySelector('svg');
        if (s) {
          s.setAttribute('role', 'img');
          if (blok.alt) {
            var t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = blok.alt;
            s.insertBefore(t, s.firstChild);
            s.setAttribute('aria-label', blok.alt);
          }
        }
        fig.appendChild(doos);
        if (blok.caption) fig.appendChild(el('figcaption', null, blok.caption));
        return fig;
      }

      case 'accordion': {
        var acc = el('div', 'accordeon');
        blok.items.forEach(function (item) {
          var d = document.createElement('details');
          d.appendChild(el('summary', null, item.title));
          d.appendChild(html('div', 'accordeon-inhoud', item.body));
          acc.appendChild(d);
        });
        return acc;
      }

      case 'cards': {
        /* Begrippenkaartjes: voorkant het begrip, achterkant de uitleg. Beide
           kanten liggen in dezelfde rastercel, zodat het kaartje even hoog blijft
           als het omdraait. */
        var houder2 = el('div', 'kaartjes-blok');
        houder2.appendChild(el('div', 'kaartjes-hint', 'Klik op een kaartje om het om te draaien.'));
        var rooster = el('div', 'kaartjes');
        blok.items.forEach(function (k) {
          var kaartje = el('div', 'kaartje');
          kaartje.setAttribute('role', 'button');
          kaartje.tabIndex = 0;
          kaartje.setAttribute('aria-pressed', 'false');
          kaartje.appendChild(html('div', 'voorkant', k.front));
          kaartje.appendChild(html('div', 'achterkant', k.back));
          var draai = function () {
            kaartje.setAttribute('aria-pressed', kaartje.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
          };
          kaartje.addEventListener('click', draai);
          kaartje.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); draai(); }
          });
          rooster.appendChild(kaartje);
        });
        houder2.appendChild(rooster);
        return houder2;
      }

      case 'quote':
        return html('blockquote', 'statement', blok.body);

      case 'links': {
        var lw = el('div', 'linkjes');
        blok.items.forEach(function (l) {
          if (l.body) lw.appendChild(html('div', 'blok', l.body));
          var a = el('a', 'linkknop', l.label);
          a.href = l.href;
          a.target = '_blank';
          a.rel = 'noopener';
          a.appendChild(el('span', 'pijltje', '↗'));
          lw.appendChild(a);
        });
        return lw;
      }

      case 'timeline': {
        var tl = el('ol', 'tijdlijn');
        blok.items.forEach(function (p) {
          var li = el('li');
          if (p.date) li.appendChild(el('div', 'tijdlijn-label', p.date));
          if (p.title) li.appendChild(el('h3', null, p.title));
          if (p.body) li.appendChild(html('div', null, p.body));
          tl.appendChild(li);
        });
        return tl;
      }

      case 'steps': {
        var st = el('div', 'stappenplan');
        st.appendChild(el('div', 'label', 'Stappenplan'));
        if (blok.intro) {
          st.appendChild(el('h3', null, blok.intro.title));
          st.appendChild(el('p', null, blok.intro.body));
        }
        var ol = el('ol', 'stappen');
        blok.steps.forEach(function (s) {
          var li = el('li');
          li.appendChild(el('strong', null, s.title));
          if (s.body) li.appendChild(el('p', null, s.body));
          ol.appendChild(li);
        });
        st.appendChild(ol);
        if (blok.summary) {
          var sam = el('div', 'stappen-slot');
          sam.appendChild(el('strong', null, blok.summary.title));
          sam.appendChild(el('p', null, blok.summary.body));
          st.appendChild(sam);
        }
        return st;
      }

      case 'quiz':
        return tekenQuiz(blok, moduleId, segIndex, blokIndex, opWijziging);

      case 'match':
        return tekenKoppel(blok, moduleId, segIndex, blokIndex, opWijziging);

      case 'sort':
        return tekenSorteer(blok, moduleId, segIndex, blokIndex, opWijziging);
    }
    return null;
  }

  /* Blokken die beantwoord moeten zijn voordat de doorgaan-knop opengaat. */
  var VRAAGTYPEN = ['quiz', 'match', 'sort'];

  /* Vaste, maar per vraag verschillende volgorde: Fisher-Yates met een
     generator die op het vraag-id is geseed. */
  function husselVolgorde(id, aantal) {
    var zaad = 1;
    for (var c = 0; c < id.length; c++) zaad = (zaad * 31 + id.charCodeAt(c)) % 2147483647;
    function volgende() {
      zaad = (zaad * 16807) % 2147483647;
      return zaad / 2147483647;
    }
    var volgorde = [];
    for (var i = 0; i < aantal; i++) volgorde.push(i);
    for (var j = aantal - 1; j > 0; j--) {
      var k = Math.floor(volgende() * (j + 1));
      var tmp = volgorde[j]; volgorde[j] = volgorde[k]; volgorde[k] = tmp;
    }
    return volgorde;
  }

  /* -------------------------------------------- meerkeuze en meervoudig */

  function tekenQuiz(blok, moduleId, segIndex, blokIndex, opWijziging) {
    var id = vraagId(moduleId, segIndex, blokIndex);
    var ms = moduleStaat(moduleId);
    var bewaard = ms.antwoorden[id];

    var kaart = el('div', 'vraag');
    kaart.appendChild(el('div', 'label', blok.multi ? 'Meerdere antwoorden' : 'Kennisvraag'));
    kaart.appendChild(html('div', 'stelling', blok.question));

    var gekozen = bewaard ? bewaard.keuze.slice() : [];
    var nagekeken = !!bewaard;

    var opties = el('div', 'opties');
    var knoppen = [];

    blok.options.forEach(function (optie, i) {
      var k = el('button', 'optie');
      k.type = 'button';
      if (blok.multi) k.setAttribute('data-multi', '1');
      k.setAttribute('aria-pressed', 'false');
      k.appendChild(el('span', 'vink', blok.multi ? '✓' : '●'));
      k.appendChild(el('span', null, optie.text));
      k.addEventListener('click', function () {
        if (nagekeken) return;
        if (blok.multi) {
          var p = gekozen.indexOf(i);
          if (p >= 0) gekozen.splice(p, 1); else gekozen.push(i);
        } else {
          gekozen = [i];
        }
        knoppen.forEach(function (b, j) { b.setAttribute('aria-pressed', gekozen.indexOf(j) >= 0 ? 'true' : 'false'); });
        nakijkKnop.disabled = gekozen.length === 0;
      });
      knoppen.push(k);
      opties.appendChild(k);
    });
    kaart.appendChild(opties);

    var acties = el('div', 'vraag-acties');
    var nakijkKnop = el('button', 'knop-klein', 'Nakijken');
    nakijkKnop.type = 'button';
    nakijkKnop.disabled = true;
    var opnieuwKnop = el('button', 'knop-klein stil', 'Opnieuw proberen');
    opnieuwKnop.type = 'button';
    opnieuwKnop.style.display = 'none';
    acties.appendChild(nakijkKnop);
    acties.appendChild(opnieuwKnop);
    kaart.appendChild(acties);

    var uitslagVak = el('div');
    kaart.appendChild(uitslagVak);

    function toonUitslag(keuze) {
      var juist = blok.options.map(function (o, i) { return o.correct ? i : -1; }).filter(function (i) { return i >= 0; });
      var goed = juist.length === keuze.length && juist.every(function (i) { return keuze.indexOf(i) >= 0; });

      knoppen.forEach(function (b, i) {
        b.disabled = true;
        b.setAttribute('aria-pressed', keuze.indexOf(i) >= 0 ? 'true' : 'false');
        if (blok.options[i].correct) b.classList.add('goed');
        else if (keuze.indexOf(i) >= 0) b.classList.add('fout');
      });

      uitslagVak.innerHTML = '';
      var u = el('div', 'uitslag ' + (goed ? 'goed' : 'fout'));
      var uitleg = (!goed && blok.feedbackWrong) ? blok.feedbackWrong : blok.feedback;
      u.textContent = goed
        ? 'Klopt.' + (uitleg ? ' ' + uitleg : '')
        : 'Niet helemaal. De juiste antwoorden staan hierboven groen.' + (uitleg ? ' ' + uitleg : '');
      uitslagVak.appendChild(u);

      /* Uitleg per antwoord, als de vraag die heeft: bij wat je koos, en bij
         het juiste antwoord als je dat niet koos. */
      knoppen.forEach(function (b, i) {
        var o = blok.options[i];
        if (!o.feedback) return;
        if (keuze.indexOf(i) < 0 && !(o.correct && !goed)) return;
        b.children[1].appendChild(el('span', 'optie-uitleg', o.feedback));
      });

      nakijkKnop.style.display = 'none';
      opnieuwKnop.style.display = goed ? 'none' : '';
      return goed;
    }

    nakijkKnop.addEventListener('click', function () {
      nagekeken = true;
      var goed = toonUitslag(gekozen);
      ms.antwoorden[id] = { keuze: gekozen.slice(), goed: goed };
      bewaar();
      opWijziging();
    });

    opnieuwKnop.addEventListener('click', function () {
      nagekeken = false;
      gekozen = [];
      delete ms.antwoorden[id];
      bewaar();
      knoppen.forEach(function (b) {
        b.disabled = false;
        b.classList.remove('goed', 'fout');
        b.setAttribute('aria-pressed', 'false');
        var weg = b.querySelector('.optie-uitleg');
        if (weg) weg.remove();
      });
      uitslagVak.innerHTML = '';
      nakijkKnop.style.display = '';
      nakijkKnop.disabled = true;
      opnieuwKnop.style.display = 'none';
      opWijziging();
    });

    if (bewaard) toonUitslag(bewaard.keuze);

    kaart.dataset.vraag = id;
    return kaart;
  }

  /* -------------------------------------------- koppelvraag */

  function tekenKoppel(blok, moduleId, segIndex, blokIndex, opWijziging) {
    var id = vraagId(moduleId, segIndex, blokIndex);
    var ms = moduleStaat(moduleId);
    var bewaard = ms.antwoorden[id];

    var kaart = el('div', 'vraag');
    kaart.appendChild(el('div', 'label', 'Koppelvraag'));
    kaart.appendChild(html('div', 'stelling', blok.question));

    /* Vaste, maar per vraag verschillende volgorde van de omschrijvingen. */
    var rechts = blok.pairs.map(function (p, i) { return { tekst: p.right, bij: i }; });
    var zaad = 0;
    for (var c = 0; c < id.length; c++) zaad = (zaad * 31 + id.charCodeAt(c)) % 100000;
    rechts.sort(function (a, b) {
      return ((a.bij * 7919 + zaad) % 1000) - ((b.bij * 7919 + zaad) % 1000);
    });

    var houder = el('div', 'koppels');
    var kiezers = [];

    blok.pairs.forEach(function (paar, i) {
      var rij = el('div', 'koppel');
      rij.appendChild(el('div', 'links', paar.left));
      var sel = document.createElement('select');
      sel.appendChild(new Option('Kies een omschrijving…', ''));
      rechts.forEach(function (r) { sel.appendChild(new Option(r.tekst, String(r.bij))); });
      sel.addEventListener('change', function () {
        nakijkKnop.disabled = kiezers.some(function (s) { return !s.value; });
      });
      rij.appendChild(sel);
      kiezers.push(sel);
      houder.appendChild(rij);
    });
    kaart.appendChild(houder);

    var acties = el('div', 'vraag-acties');
    var nakijkKnop = el('button', 'knop-klein', 'Nakijken');
    nakijkKnop.type = 'button';
    nakijkKnop.disabled = true;
    var opnieuwKnop = el('button', 'knop-klein stil', 'Opnieuw proberen');
    opnieuwKnop.type = 'button';
    opnieuwKnop.style.display = 'none';
    acties.appendChild(nakijkKnop);
    acties.appendChild(opnieuwKnop);
    kaart.appendChild(acties);

    var uitslagVak = el('div');
    kaart.appendChild(uitslagVak);

    function toonUitslag(keuze) {
      var goedAantal = 0;
      kiezers.forEach(function (sel, i) {
        sel.value = keuze[i];
        sel.disabled = true;
        var rij = sel.parentElement;
        if (String(keuze[i]) === String(i)) { rij.classList.add('goed'); goedAantal++; }
        else rij.classList.add('fout');
      });
      var alles = goedAantal === blok.pairs.length;
      uitslagVak.innerHTML = '';
      var u = el('div', 'uitslag ' + (alles ? 'goed' : 'fout'));
      var uitleg = (!alles && blok.feedbackWrong) ? blok.feedbackWrong : blok.feedback;
      u.textContent = (alles
        ? 'Allemaal goed gekoppeld.'
        : goedAantal + ' van de ' + blok.pairs.length + ' goed. De juiste koppelingen staan groen.')
        + (uitleg ? ' ' + uitleg : '');
      uitslagVak.appendChild(u);
      nakijkKnop.style.display = 'none';
      opnieuwKnop.style.display = alles ? 'none' : '';
      return alles;
    }

    nakijkKnop.addEventListener('click', function () {
      var keuze = kiezers.map(function (s) { return s.value; });
      var goed = toonUitslag(keuze);
      ms.antwoorden[id] = { keuze: keuze, goed: goed };
      bewaar();
      opWijziging();
    });

    opnieuwKnop.addEventListener('click', function () {
      delete ms.antwoorden[id];
      bewaar();
      kiezers.forEach(function (s) {
        s.disabled = false;
        s.value = '';
        s.parentElement.classList.remove('goed', 'fout');
      });
      uitslagVak.innerHTML = '';
      nakijkKnop.style.display = '';
      nakijkKnop.disabled = true;
      opnieuwKnop.style.display = 'none';
      opWijziging();
    });

    if (bewaard) toonUitslag(bewaard.keuze);

    kaart.dataset.vraag = id;
    return kaart;
  }

  /* -------------------------------------------- sorteeropdracht */

  function tekenSorteer(blok, moduleId, segIndex, blokIndex, opWijziging) {
    var id = vraagId(moduleId, segIndex, blokIndex);
    var ms = moduleStaat(moduleId);
    var bewaard = ms.antwoorden[id];

    var kaart = el('div', 'vraag');
    kaart.appendChild(el('div', 'label', 'Sorteeropdracht'));
    var stelling = el('div', 'stelling');
    stelling.appendChild(el('p', null, blok.question || 'Bij welke categorie hoort elk onderdeel?'));
    kaart.appendChild(stelling);

    /* In de bron staan de kaartjes per categorie gegroepeerd; dat verraadt het
       antwoord, dus husselen we ze. */
    var volgorde = husselVolgorde(id, blok.items.length);

    var houder = el('div', 'koppels');
    var kiezers = [];
    volgorde.forEach(function (n) {
      var item = blok.items[n];
      var rij = el('div', 'koppel');
      rij.appendChild(el('div', 'links', item.text));
      var sel = document.createElement('select');
      sel.appendChild(new Option('Kies een categorie…', ''));
      blok.piles.forEach(function (p, j) { sel.appendChild(new Option(p, String(j))); });
      sel.addEventListener('change', function () {
        nakijkKnop.disabled = kiezers.some(function (k) { return !k.sel.value; });
      });
      rij.appendChild(sel);
      kiezers.push({ sel: sel, item: item, rij: rij });
      houder.appendChild(rij);
    });
    kaart.appendChild(houder);

    var acties = el('div', 'vraag-acties');
    var nakijkKnop = el('button', 'knop-klein', 'Nakijken');
    nakijkKnop.type = 'button';
    nakijkKnop.disabled = true;
    var opnieuwKnop = el('button', 'knop-klein stil', 'Opnieuw proberen');
    opnieuwKnop.type = 'button';
    opnieuwKnop.style.display = 'none';
    acties.appendChild(nakijkKnop);
    acties.appendChild(opnieuwKnop);
    kaart.appendChild(acties);

    var uitslagVak = el('div');
    kaart.appendChild(uitslagVak);

    /* keuze is per kaartje in bronvolgorde, zodat een bewaard antwoord niet
       afhangt van de hussel. */
    function toonUitslag(keuze) {
      var goedAantal = 0;
      kiezers.forEach(function (k) {
        var n = blok.items.indexOf(k.item);
        k.sel.value = keuze[n];
        k.sel.disabled = true;
        if (String(keuze[n]) === String(k.item.pile)) { k.rij.classList.add('goed'); goedAantal++; }
        else {
          k.rij.classList.add('fout');
          k.rij.appendChild(el('div', 'hoort-bij', 'Hoort bij: ' + blok.piles[k.item.pile]));
        }
      });
      var alles = goedAantal === blok.items.length;
      uitslagVak.innerHTML = '';
      var u = el('div', 'uitslag ' + (alles ? 'goed' : 'fout'));
      u.textContent = alles
        ? 'Alles in de juiste categorie.'
        : goedAantal + ' van de ' + blok.items.length + ' goed. Bij de rode staat waar ze wel horen.';
      uitslagVak.appendChild(u);
      nakijkKnop.style.display = 'none';
      opnieuwKnop.style.display = alles ? 'none' : '';
      return alles;
    }

    nakijkKnop.addEventListener('click', function () {
      var keuze = blok.items.map(function (item) {
        return kiezers.find(function (k) { return k.item === item; }).sel.value;
      });
      var goed = toonUitslag(keuze);
      ms.antwoorden[id] = { keuze: keuze, goed: goed };
      bewaar();
      opWijziging();
    });

    opnieuwKnop.addEventListener('click', function () {
      delete ms.antwoorden[id];
      bewaar();
      kiezers.forEach(function (k) {
        k.sel.disabled = false;
        k.sel.value = '';
        k.rij.classList.remove('goed', 'fout');
        var weg = k.rij.querySelector('.hoort-bij');
        if (weg) weg.remove();
      });
      uitslagVak.innerHTML = '';
      nakijkKnop.style.display = '';
      nakijkKnop.disabled = true;
      opnieuwKnop.style.display = 'none';
      opWijziging();
    });

    if (bewaard) toonUitslag(bewaard.keuze);

    kaart.dataset.vraag = id;
    return kaart;
  }

  /* ------------------------------------------------------------ modulepagina */

  function openModule(moduleId) {
    var les = cursus.lessons.find(function (l) { return l.id === moduleId; });
    if (!les) return toonStart();

    location.hash = '#' + moduleId;
    document.title = les.title + ' | ' + cursus.title;
    document.body.innerHTML = '';

    var segmenten = segmenteer(les.blocks);
    var ms = moduleStaat(moduleId);
    if (ms.af) ms.segment = segmenten.length - 1;
    if (ms.segment >= segmenten.length) ms.segment = segmenten.length - 1;

    /* balk bovenaan */
    var balk = el('header', 'leesbalk');
    var binnen = el('div', 'leesbalk-inner');
    var terug = el('button', 'terug', '← Alle modules');
    terug.type = 'button';
    terug.addEventListener('click', toonStart);
    binnen.appendChild(terug);
    binnen.appendChild(el('span', 'naam', les.title));
    var teller = el('span', 'teller');
    binnen.appendChild(teller);
    balk.appendChild(binnen);
    var spoor = el('div', 'spoor');
    var vulling = el('i');
    spoor.appendChild(vulling);
    balk.appendChild(spoor);
    document.body.appendChild(balk);

    var lezer = el('main', 'lezer');
    var kop = el('div', 'moduletitel');
    var nr = cursus.lessons.indexOf(les) + 1;
    kop.appendChild(el('p', 'kicker', 'Module ' + nr + ' van ' + cursus.lessons.length));
    kop.appendChild(el('h1', null, les.title));
    if (les.deadline) {
      var dl = el('p', null, '');
      dl.style.cssText = 'margin:0.9rem 0 0';
      dl.appendChild(el('span', 'deadline', 'Afronden vóór ' + les.deadline));
      kop.appendChild(dl);
    }
    lezer.appendChild(kop);
    document.body.appendChild(lezer);

    function werkBalkBij() {
      var zichtbaar = Math.min(ms.segment + 1, segmenten.length);
      teller.textContent = zichtbaar + ' / ' + segmenten.length;
      vulling.style.width = Math.round((zichtbaar / segmenten.length) * 100) + '%';
    }

    /* Openstaande vragen in een segment blokkeren de doorgaan-knop. */
    function openVragen(segIndex) {
      var blokken = segmenten[segIndex];
      var open = 0;
      blokken.forEach(function (b, i) {
        if (VRAAGTYPEN.indexOf(b.t) < 0) return;
        if (!ms.antwoorden[vraagId(moduleId, segIndex, i)]) open++;
      });
      return open;
    }

    function tekenSegment(index) {
      var seg = el('section', 'segment');
      var herbeoordeel = function () { /* wordt hieronder vervangen */ };

      segmenten[index].forEach(function (blok, i) {
        var node = tekenBlok(blok, moduleId, index, i, function () { herbeoordeel(); });
        if (node) seg.appendChild(node);
      });

      lezer.appendChild(seg);

      var laatste = index === segmenten.length - 1;
      /* Alleen het voorste segment krijgt een doorgaan-knop. Bij hervatten
         tekenen we alle al onthulde segmenten opnieuw; kregen die ook een knop,
         dan stonden er dode knoppen midden in de tekst die naar al zichtbare
         inhoud wezen. */
      var isVoorste = index >= ms.segment;

      if (!laatste && isVoorste) {
        var voet = el('div', 'doorgaan');
        var knop = el('button', null, 'Doorgaan');
        knop.type = 'button';
        var hint = el('div', 'hint', '');
        voet.appendChild(knop);
        voet.appendChild(hint);
        seg.appendChild(voet);

        herbeoordeel = function () {
          var open = openVragen(index);
          knop.disabled = open > 0;
          hint.textContent = open > 0
            ? (open === 1 ? 'Beantwoord eerst de vraag hierboven.' : 'Beantwoord eerst de ' + open + ' vragen hierboven.')
            : '';
        };
        herbeoordeel();

        knop.addEventListener('click', function () {
          voet.remove();
          ms.segment = Math.max(ms.segment, index + 1);
          bewaar();
          werkBalkBij();
          var nieuw = tekenSegment(index + 1);
          nieuw.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } else if (laatste) {
        var slot = el('div', 'afronding');
        slot.appendChild(el('div', 'vinkje', '✓'));
        slot.appendChild(el('h2', null, 'Module doorlopen'));

        var volgende = cursus.lessons[cursus.lessons.indexOf(les) + 1];
        slot.appendChild(el('p', null, volgende
          ? 'Je hebt ' + les.title + ' afgerond. Ga verder met module ' + (nr + 1) + '.'
          : 'Je hebt de laatste module van deze cursus afgerond.'));

        var knoppen = el('div', 'knoppen');
        if (volgende) {
          var v = el('button', 'knop-klein', 'Volgende module');
          v.type = 'button';
          v.addEventListener('click', function () { openModule(volgende.id); });
          knoppen.appendChild(v);
        }
        var o = el('button', 'knop-klein stil', 'Terug naar het overzicht');
        o.type = 'button';
        o.addEventListener('click', toonStart);
        knoppen.appendChild(o);
        slot.appendChild(knoppen);
        seg.appendChild(slot);

        herbeoordeel = function () {
          if (openVragen(index) === 0 && !ms.af) {
            ms.af = true;
            bewaar();
          }
        };
        herbeoordeel();
      }

      return seg;
    }

    for (var i = 0; i <= ms.segment && i < segmenten.length; i++) tekenSegment(i);
    werkBalkBij();
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ opstarten */

  function fout(bericht) {
    document.body.innerHTML = '';
    var d = el('div', 'lezer');
    d.appendChild(el('h1', null, 'Er ging iets mis'));
    d.appendChild(el('p', null, bericht));
    var a = el('a', null, 'Terug naar het overzicht');
    a.href = 'index.html';
    d.appendChild(a);
    document.body.appendChild(d);
  }

  var params = new URLSearchParams(location.search);
  var slug = params.get('m') || '';
  if (!slug) return fout('Geen module opgegeven.');

  sleutel = 'elearning:' + slug;

  fetch('modules/' + slug + '/course.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('Module niet gevonden (' + r.status + ').');
      return r.json();
    })
    .then(function (data) {
      cursus = data;
      /* paden van beeldmateriaal zijn relatief aan de modulemap */
      cursus.lessons.forEach(function (l) {
        l.blocks.forEach(function (b) {
          if (b.t === 'image' && b.src.indexOf('modules/') !== 0) {
            b.src = 'modules/' + slug + '/' + b.src;
          }
        });
      });
      staat = leesStaat();

      var hash = (location.hash || '').replace('#', '');
      if (hash && cursus.lessons.some(function (l) { return l.id === hash; })) openModule(hash);
      else toonStart();

      window.addEventListener('hashchange', function () {
        var h = (location.hash || '').replace('#', '');
        if (h && cursus.lessons.some(function (l) { return l.id === h; })) openModule(h);
        else if (!h) toonStart();
      });
    })
    .catch(function (e) { fout(e.message); });
})();
