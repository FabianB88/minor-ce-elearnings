/*
 * Verdieping bij de e-learningspeler.
 *
 * Werkt alleen als er naast course.json een verdieping.json staat. Dan krijgt
 * elke module een laatste deel met een luistersamenvatting, de begrippen van
 * die module en een paar verbandvragen; vanaf de tweede module staan bovenaan
 * drie korte vragen over eerdere modules. Op de startpagina komen een
 * begrippenlijst, een kaart van verbanden die meegroeit met je voortgang, en
 * oefencasussen (als modules/casussen.json er is).
 *
 * cursus.js roept Verdieping.start(data, api) aan en gebruikt wat dat teruggeeft.
 */
(function () {
  'use strict';

  var DISCLAIMER = 'De samenvatting is om je beeld te versterken. Alleen de samenvatting volgen is níét voldoende voor het tentamen.';
  var KORT = { 'duurzaamheid-systeemdenken': 'Duurzaamheid', 'business-ethics': 'Business Ethics' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Vaste toevalsreeks per sleutel, zodat vragen bij herladen hetzelfde blijven. */
  function reeks(sleutel) {
    var zaad = 7;
    for (var c = 0; c < sleutel.length; c++) zaad = (zaad * 31 + sleutel.charCodeAt(c)) % 2147483647;
    return function () {
      zaad = (zaad * 16807) % 2147483647;
      return zaad / 2147483647;
    };
  }
  function hussel(lijst, rnd) {
    var a = lijst.slice();
    for (var j = a.length - 1; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1));
      var t = a[j]; a[j] = a[k]; a[k] = t;
    }
    return a;
  }

  /* Spraak loopt door als je wegklikt; daarom één gedeelde stopknop. */
  var spraakStop = null;
  function stopSpraak() {
    if (spraakStop) spraakStop();
    spraakStop = null;
    try { window.speechSynthesis.cancel(); } catch (e) { /* geen spraak */ }
  }
  window.addEventListener('hashchange', stopSpraak);
  window.addEventListener('pagehide', stopSpraak);

  function start(data, api) {
    var el = api.el;
    var cursus = api.cursus;
    var lessen = cursus.lessons;
    var lesNr = {};
    lessen.forEach(function (l, i) { lesNr[l.id] = i; });

    var begrippen = (data.begrippen || []).filter(function (b) { return lesNr[b.les] !== undefined; });
    var perId = {};
    begrippen.forEach(function (b) { perId[b.id] = b; });
    var verbanden = (data.verbanden || []).filter(function (v) { return perId[v.a] && perId[v.b]; });
    var buren = {};
    begrippen.forEach(function (b) { buren[b.id] = []; });
    verbanden.forEach(function (v, i) { buren[v.a].push(i); buren[v.b].push(i); });
    var extern = data.extern || [];
    var types = data.types || {};
    var samenvattingen = data.samenvattingen || {};

    function begrippenVan(lesId) { return begrippen.filter(function (b) { return b.les === lesId; }); }
    function af(lesId) { return !!api.moduleStaat(lesId).af; }
    function ander(v, id) { return v.a === id ? v.b : v.a; }
    function staat() {
      var s = api.staat();
      if (!s.verdieping) s.verdieping = { casussen: {}, kaartAlles: false };
      return s.verdieping;
    }

    /* ------------------------------------------------ vragen maken */

    /* "Maak de zin af"-vraag bij een verband. Afleiders zijn begrippen die niet
       met het gegeven begrip verbonden zijn, zodat er maar één antwoord klopt. */
    function verbandVraag(v, sleutel, maxLes) {
      var rnd = reeks(sleutel);
      var omgekeerd = v.type !== 'T' && rnd() < 0.5;
      var gegeven = omgekeerd ? perId[v.b] : perId[v.a];
      var antwoord = omgekeerd ? perId[v.a] : perId[v.b];
      var verboden = {};
      verboden[gegeven.id] = 1;
      verboden[antwoord.id] = 1;
      /* ook de buren van het antwoord, anders klinkt een fout antwoord al gauw ook goed */
      [gegeven, antwoord].forEach(function (x) {
        buren[x.id].forEach(function (i) { verboden[ander(verbanden[i], x.id)] = 1; });
      });
      var kandidaten = begrippen.filter(function (b) { return !verboden[b.id] && !b.bijzaak && lesNr[b.les] <= maxLes; });
      var zelfdeLes = kandidaten.filter(function (b) { return b.les === antwoord.les; });
      var afleiders = hussel(zelfdeLes, rnd).concat(hussel(kandidaten, rnd))
        .filter(function (b, i, a) { return a.indexOf(b) === i; }).slice(0, 3);
      if (afleiders.length < 2) return null;
      var opties = hussel([antwoord].concat(afleiders), rnd).map(function (b) {
        return { text: b.naam, correct: b === antwoord };
      });
      var zin = omgekeerd
        ? '… ' + esc(v.rel) + ' <strong>' + esc(gegeven.naam) + '</strong>.'
        : '<strong>' + esc(gegeven.naam) + '</strong> ' + esc(v.rel) + ' …';
      return {
        t: 'quiz',
        label: 'Verbandvraag',
        question: '<p>Maak de zin af:</p><p class="verband-zin">' + zin + '</p>',
        options: opties,
        feedback: v.uitleg,
        feedbackWrong: v.uitleg
      };
    }

    /* Welk begrip hoort bij deze omschrijving? Het begrip zelf wordt uit de
       omschrijving weggelaten. */
    function definitieVraag(b, sleutel) {
      var rnd = reeks(sleutel);
      var pool = begrippen.filter(function (x) { return x !== b && !x.bijzaak && lesNr[x.les] <= lesNr[b.les] + 1; });
      var zelfde = pool.filter(function (x) { return x.les === b.les; });
      var afleiders = hussel(zelfde, rnd).concat(hussel(pool, rnd))
        .filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 3);
      if (afleiders.length < 2) return null;
      var omschrijving = zonderBron(b.def);
      [b.naam].concat(b.sub ? [b.sub] : []).forEach(function (n) {
        var kern = n.replace(/\s*\(.*\)\s*/g, '').trim();
        if (kern.length > 3) omschrijving = omschrijving.split(kern).join('…');
      });
      return {
        t: 'quiz',
        label: 'Weet je nog?',
        question: '<p>Welk begrip hoort bij deze omschrijving?</p><p class="verband-zin">' + esc(omschrijving) + '</p>',
        options: hussel([b].concat(afleiders), rnd).map(function (x) { return { text: x.naam, correct: x === b }; }),
        feedback: b.naam + ': ' + b.def
      };
    }

    function vragenVoorLes(les) {
      var k = lesNr[les.id];
      var voorkeur = { D: 0, O: 0, H: 0, T: 0, S: 1 };
      var kandidaten = verbanden.filter(function (v) {
        if (v.vraag === false || perId[v.a].bijzaak || perId[v.b].bijzaak) return false;
        var la = lesNr[perId[v.a].les], lb = lesNr[perId[v.b].les];
        return (la === k || lb === k) && la <= k && lb <= k;
      });
      var rnd = reeks(les.id + ':verbanden');
      kandidaten = hussel(kandidaten, rnd).sort(function (x, y) { return voorkeur[x.type] - voorkeur[y.type]; });
      var gekozen = [], gebruikt = {};
      kandidaten.forEach(function (v) {
        if (gekozen.length >= 3 || gebruikt[v.a] || gebruikt[v.b]) return;
        var q = verbandVraag(v, les.id + ':' + v.a + ':' + v.b, k);
        if (!q) return;
        gebruikt[v.a] = gebruikt[v.b] = 1;
        gekozen.push(q);
      });
      return gekozen;
    }

    /* ------------------------------------------------ module: laatste deel */

    function segment(les) {
      var blokken = [];
      var sam = samenvattingen[les.id];
      var eigen = begrippenVan(les.id);
      var vragen = vragenVoorLes(les);
      if (!sam && !eigen.length && !vragen.length) return null;
      blokken.push({ t: 'text', heading: 'Verdieping', body: '<p>Zet de module voor jezelf op een rij: zie hoe je kaart van begrippen groeit, luister de samenvatting terug en leg daarna een paar verbanden. Let op: de samenvatting is om je beeld te versterken. Alleen de samenvatting volgen is <strong>niet</strong> voldoende voor het tentamen.</p>' });
      if (eigen.length) blokken.push({ t: 'groei', les: les.id });
      if (sam) blokken.push({ t: 'luister', les: les.id });
      if (eigen.length) blokken.push({ t: 'begrippen', les: les.id });
      if (nieuweLijnen(les).length) blokken.push({ t: 'lijnen', les: les.id });
      if (vragen.length) {
        blokken.push({ t: 'text', heading: 'Verbanden leggen', body: '<p>Hoe hangen de begrippen samen? Kies het begrip dat de zin juist maakt.</p>' });
        blokken = blokken.concat(vragen);
      }
      return blokken;
    }

    function tekenBlok(blok) {
      if (blok.t === 'luister') return luisterKaart(blok.les);
      if (blok.t === 'begrippen') return begrippenBlok(blok.les);
      if (blok.t === 'groei') return groeiKaart(blok.les);
      if (blok.t === 'lijnen') return lijnenBlok(blok.les);
      return null;
    }

    /* ------------------------------------------------ verhaallijnen */

    /* Een verhaallijn loopt langs een paar verbanden, zoals Jibbe ze maakte:
       "Klimaat dat zichzelf versnelt". Hij gaat open als de modules van al
       zijn begrippen af zijn. */
    var lijnen = (data.verhaallijnen || []).map(function (l, nr) {
      var stappen = l.stappen.map(function (p) {
        for (var n = 0; n < verbanden.length; n++) {
          var v = verbanden[n];
          if ((v.a === p[0] && v.b === p[1]) || (v.a === p[1] && v.b === p[0])) return n;
        }
        return -1;
      }).filter(function (n) { return n >= 0; });
      var ids = {};
      stappen.forEach(function (n) { ids[verbanden[n].a] = 1; ids[verbanden[n].b] = 1; });
      /* de lijn hoort bij zijn eigen module, nooit eerder dan het laatste begrip erin */
      var laatste = Math.max.apply(null, Object.keys(ids).map(function (id) { return lesNr[perId[id].les]; }).concat(lesNr[l.les] !== undefined ? [lesNr[l.les]] : []));
      return { nr: nr, titel: l.titel, intro: l.intro, stappen: stappen, ids: Object.keys(ids), laatste: laatste };
    }).filter(function (l) { return l.stappen.length; });

    function lijnOpen(l) {
      return l.ids.every(function (id) { return af(perId[id].les); });
    }
    function nieuweLijnen(les) {
      return lijnen.filter(function (l) { return l.laatste === lesNr[les.id]; });
    }

    function lijnenBlok(lesId) {
      var blok = el('div', 'lijnen-blok');
      blok.appendChild(el('strong', null, 'De verhaallijn van deze module'));
      blok.appendChild(el('p', null, 'Volg stap voor stap op de kaart hoe de begrippen uit deze module, en wat je al kende, in elkaar grijpen.'));
      nieuweLijnen({ id: lesId }).forEach(function (l) {
        var k = el('button', 'lijn-knop');
        k.type = 'button';
        k.appendChild(el('strong', null, l.titel));
        k.appendChild(el('span', null, l.intro));
        k.addEventListener('click', function () { toon('kaart', 'lijn-' + l.nr); });
        blok.appendChild(k);
      });
      return blok;
    }

    /* Eén zin uitspreken; opEind volgt ook als er geen stem is. */
    function zeg(tekst, snelheid, opEind) {
      var klaar = false;
      function eind() { if (!klaar) { klaar = true; opEind(); } }
      var gestart = false;
      try {
        var u = new window.SpeechSynthesisUtterance(tekst);
        var stem = nlStem();
        u.lang = stem ? stem.lang : 'nl-NL';
        if (stem) u.voice = stem;
        u.rate = snelheid || 1;
        u.onstart = function () { gestart = true; };
        u.onend = eind;
        u.onerror = eind;
        window.speechSynthesis.speak(u);
      } catch (e) { setTimeout(eind, 3000); return function () { klaar = true; }; }
      setTimeout(function () { if (!gestart) { try { window.speechSynthesis.cancel(); } catch (e) { /* niets */ } setTimeout(eind, 2500); } }, 2500);
      return function () { klaar = true; try { window.speechSynthesis.cancel(); } catch (e) { /* niets */ } };
    }

    /* Stapspeler voor de groeiende kaart en de verhaallijnen: vorige, afspelen,
       volgende, met desgewenst een stem die de uitleg voorleest. */
    function stapSpeler(opties) {
      var n = opties.stappen.length;
      var i = -1, speelt = false, wacht = null, stopZeg = null;
      var balk = el('div', 'stap-balk');
      var vorige = el('button', 'knop-klein stil', '← Vorige');
      var speel = el('button', 'knop-klein', opties.speelLabel || 'Afspelen');
      var volgende = el('button', 'knop-klein stil', 'Volgende →');
      var alles = el('button', 'tekstknop', 'Alles tonen');
      [vorige, speel, volgende, alles].forEach(function (b) { b.type = 'button'; });
      var teller = el('span', 'stap-teller');
      var stemLabel = el('label', 'schakel stap-stem');
      var stem = el('input');
      stem.type = 'checkbox';
      stemLabel.appendChild(stem);
      stemLabel.appendChild(document.createTextNode(' Lees voor'));
      balk.appendChild(vorige);
      balk.appendChild(speel);
      balk.appendChild(volgende);
      balk.appendChild(teller);
      balk.appendChild(alles);
      if (typeof window.speechSynthesis !== 'undefined') balk.appendChild(stemLabel);

      function stopTimers() {
        clearTimeout(wacht);
        if (stopZeg) stopZeg();
        stopZeg = null;
      }
      function zet(j) {
        i = Math.max(-1, Math.min(n - 1, j));
        opties.toon(i);
        teller.textContent = i < 0 ? n + ' stappen' : (i + 1) + ' / ' + n;
        vorige.disabled = i < 0;
        volgende.disabled = i >= n - 1;
        if (i >= n - 1 && speelt) pauze();
      }
      function pauze() {
        speelt = false;
        stopTimers();
        speel.textContent = i >= n - 1 ? 'Opnieuw' : 'Verder';
      }
      function verder() {
        if (!speelt) return;
        if (i >= n - 1) { pauze(); return; }
        zet(i + 1);
        if (!speelt) return;
        var tekst = opties.tekst(i);
        if (stem.checked) {
          stopZeg = zeg(tekst, 1.1, function () { stopZeg = null; wacht = setTimeout(verder, 300); });
        } else {
          wacht = setTimeout(verder, Math.min(6500, 1500 + tekst.length * 19));
        }
      }
      speel.addEventListener('click', function () {
        if (speelt) { pauze(); return; }
        stopSpraak();
        spraakStop = pauze;
        if (i >= n - 1) zet(-1);
        speelt = true;
        speel.textContent = 'Pauzeren';
        verder();
      });
      vorige.addEventListener('click', function () { pauze(); zet(i - 1); });
      volgende.addEventListener('click', function () { pauze(); zet(i + 1); });
      alles.addEventListener('click', function () { pauze(); zet(n - 1); });
      stem.addEventListener('change', function () { if (!stem.checked && stopZeg) { stopZeg(); stopZeg = null; } });
      zet(opties.begin === undefined ? -1 : opties.begin);
      return { balk: balk, zet: zet, stop: pauze };
    }

    function verbandZin(v) { return perId[v.a].naam + ' ' + v.rel + ' ' + perId[v.b].naam + '.'; }

    /* ------------------------------------------------ jouw kaart groeit */

    /* Aan het eind van een module verschijnen de nieuwe begrippen één voor één
       op de kaart van wat je al kende, en tekenen hun verbanden zich. */
    function groeiKaart(lesId) {
      var k = lesNr[lesId];
      var ind = maakIndeling();
      var nieuw = begrippenVan(lesId);
      var eerder = begrippen.filter(function (b) { return lesNr[b.les] < k; });
      var zichtbaar = {};
      eerder.forEach(function (b) { zichtbaar[b.id] = 1; });
      var stappen = [], gedaan = {};
      /* Bijzaken, zoals de vier sferen, komen samen in één stap op de kaart. */
      var bij = nieuw.filter(function (b) { return b.bijzaak; });
      nieuw.forEach(function (b) {
        if (b.bijzaak) {
          if (b !== bij[0]) return;
          var ns = [];
          bij.forEach(function (x) { zichtbaar[x.id] = 1; });
          bij.forEach(function (x) {
            buren[x.id].forEach(function (n) {
              if (gedaan[n] || !zichtbaar[ander(verbanden[n], x.id)]) return;
              gedaan[n] = 1;
              ns.push(n);
            });
          });
          stappen.push({ t: 'groep', bs: bij, ns: ns });
          return;
        }
        stappen.push({ t: 'begrip', b: b });
        zichtbaar[b.id] = 1;
        buren[b.id].forEach(function (n) {
          if (gedaan[n] || !zichtbaar[ander(verbanden[n], b.id)]) return;
          gedaan[n] = 1;
          stappen.push({ t: 'verband', n: n });
        });
      });

      var blok = el('div', 'groei');
      var kop = el('div', 'groei-kop');
      kop.appendChild(el('strong', null, 'Jouw kaart groeit'));
      var verbindingen = stappen.reduce(function (som, s) { return som + (s.t === 'verband' ? 1 : s.t === 'groep' ? s.ns.length : 0); }, 0);
      kop.appendChild(el('span', null, nieuw.length + ' nieuwe begrippen · ' + verbindingen + ' verbanden' + (eerder.length ? ', ook met wat je al kende' : '')));
      blok.appendChild(kop);

      /* De kaart bevat alles wat je kent en beweegt mee: bij elke stap zoomt ze
         in op het nieuwe begrip en de begrippen waarmee het verbonden is, zodat
         niets buiten beeld valt. Je kunt ook zelf zoomen en slepen, en de kaart
         op volledig scherm zetten. */
      var svg = kaartSvg(eerder.concat(nieuw), { klein: true, focus: nieuw, marge: 90 });
      var vlak = el('div', 'groei-vlak');
      vlak.appendChild(svg.el);
      blok.appendChild(vlak);

      var vb = svg.vak.slice(), anim = null, eind = null, focus = [];
      var rustig = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function zetVb(v) { vb = v; svg.el.setAttribute('viewBox', v.join(' ')); }
      function naar(doel) {
        if (anim) cancelAnimationFrame(anim);
        anim = null;
        clearTimeout(eind);
        if (rustig || document.hidden) { zetVb(doel); return; }
        /* Pauzeert de browser de animatie, bijvoorbeeld in een tabblad op de
           achtergrond, dan staat de kaart daarna toch op de goede plek. */
        eind = setTimeout(function () { if (anim) cancelAnimationFrame(anim); anim = null; zetVb(doel); }, 650);
        var van = vb.slice(), t0 = null;
        function stap(t) {
          if (t0 === null) t0 = t;
          var f = Math.min(1, (t - t0) / 500);
          f = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
          zetVb(van.map(function (x, i) { return x + (doel[i] - x) * f; }));
          anim = f < 1 ? requestAnimationFrame(stap) : null;
        }
        anim = requestAnimationFrame(stap);
      }
      /* Het kader rond een groep begrippen, met ruimte voor de labels en in de
         verhouding van de kaart op het scherm. */
      function kader(ids) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        ids.forEach(function (id) {
          var p = ind.pos[ind.index[id]];
          if (!p) return;
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        if (minX === Infinity) return vb.slice();
        minX -= 110; maxX += 110; minY -= 55; maxY += 40;
        var w = Math.max(380, maxX - minX), h = Math.max(240, maxY - minY);
        var bw = svg.el.clientWidth, bh = svg.el.clientHeight;
        var r = bw && bh ? bw / bh : 1.9;
        if (w / h < r) w = h * r; else h = w / r;
        var mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
        return [mx - w / 2, my - h / 2, w, h];
      }
      function kijk(ids) { focus = ids; naar(kader(ids)); }
      var verbondenEerder = [];
      nieuw.forEach(function (b) {
        buren[b.id].forEach(function (n) {
          var o = ander(verbanden[n], b.id);
          if (lesNr[perId[o].les] < k && verbondenEerder.indexOf(o) < 0) verbondenEerder.push(o);
        });
      });
      function overzicht() { return nieuw.map(function (b) { return b.id; }).concat(verbondenEerder); }
      /* buren van een begrip die op dit moment op de kaart staan */
      function zichtbareBuren(id) {
        return buren[id].map(function (n) { return ander(verbanden[n], id); })
          .filter(function (o) { return svg.knoop[o] && !svg.knoop[o].classList.contains('weg'); });
      }

      var bediening = el('div', 'kaart-zoom groei-zoom');
      function knop(tekst, label, actie) {
        var b = el('button', null, tekst);
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', actie);
        bediening.appendChild(b);
        return b;
      }
      function schaal(f) {
        var mx = vb[0] + vb[2] / 2, my = vb[1] + vb[3] / 2;
        naar([mx - vb[2] * f / 2, my - vb[3] * f / 2, vb[2] * f, vb[3] * f]);
      }
      knop('+', 'Inzoomen', function () { schaal(0.7); });
      knop('−', 'Uitzoomen', function () { schaal(1 / 0.7); });
      knop('⤢', 'Alle nieuwe begrippen in beeld', function () { kijk(overzicht()); });
      var volKnop = knop('⛶', 'Volledig scherm', wisselVol);
      vlak.appendChild(bediening);

      /* Slepen met de muis, en op volledig scherm ook met een vinger. */
      var sleep = null;
      svg.el.addEventListener('pointerdown', function (e) {
        if (e.target.closest && e.target.closest('.knoop')) return;
        if (e.pointerType !== 'mouse' && !isVol()) return;
        if (anim) { cancelAnimationFrame(anim); anim = null; }
        clearTimeout(eind);
        sleep = { x: e.clientX, y: e.clientY, vb: vb.slice() };
      });
      svg.el.addEventListener('pointermove', function (e) {
        if (!sleep) return;
        var f = vb[2] / (svg.el.clientWidth || 1);
        zetVb([sleep.vb[0] - (e.clientX - sleep.x) * f, sleep.vb[1] - (e.clientY - sleep.y) * f, vb[2], vb[3]]);
      });
      svg.el.addEventListener('pointerup', function () { sleep = null; });
      svg.el.addEventListener('pointerleave', function () { sleep = null; });
      svg.el.addEventListener('wheel', function (e) {
        if (!isVol()) return;
        e.preventDefault();
        schaal(e.deltaY > 0 ? 1.15 : 1 / 1.15);
      }, { passive: false });

      function isVol() { return document.fullscreenElement === blok || blok.classList.contains('vol'); }
      function naVol() {
        volKnop.textContent = isVol() ? '✕' : '⛶';
        volKnop.title = isVol() ? 'Volledig scherm sluiten' : 'Volledig scherm';
        volKnop.setAttribute('aria-label', volKnop.title);
        setTimeout(function () { naar(kader(focus.length ? focus : overzicht())); }, 60);
      }
      /* Over de hele pagina, als echt volledig scherm niet mag. De kaart gaat dan
         tijdelijk naar het hoogste niveau van de pagina, omdat een animatie van
         een ouder anders bepaalt waar "vast op het scherm" begint. */
      var plek = null;
      function overPagina(aan) {
        if (aan) {
          plek = document.createComment('jouw kaart groeit');
          blok.parentNode.insertBefore(plek, blok);
          document.body.appendChild(blok);
          blok.classList.add('vol');
        } else {
          blok.classList.remove('vol');
          if (plek && plek.parentNode) { plek.parentNode.insertBefore(blok, plek); plek.parentNode.removeChild(plek); }
          plek = null;
        }
        naVol();
      }
      /* Echt volledig scherm waar de browser dat toestaat, anders over de hele pagina. */
      function wisselVol() {
        if (document.fullscreenElement === blok) { document.exitFullscreen(); return; }
        if (blok.classList.contains('vol')) { overPagina(false); return; }
        if (blok.requestFullscreen && document.fullscreenEnabled) {
          blok.requestFullscreen().catch(function () { overPagina(true); });
        } else overPagina(true);
      }
      document.addEventListener('fullscreenchange', naVol);
      blok.addEventListener('keydown', function (e) { if (e.key === 'Escape' && blok.classList.contains('vol')) overPagina(false); });
      window.addEventListener('resize', function () { if (blok.isConnected) zetVb(kader(focus.length ? focus : overzicht())); });
      eerder.forEach(function (b) { svg.knoop[b.id].classList.add('oud'); });
      nieuw.forEach(function (b) { svg.knoop[b.id].classList.add('weg'); });
      verbanden.forEach(function (v, n) {
        if (!svg.lijn[n]) return;
        if (lesNr[perId[v.a].les] < k && lesNr[perId[v.b].les] < k) svg.lijn[n].classList.add('oud');
        else svg.lijn[n].classList.add('weg');
      });

      var tekst = el('div', 'groei-tekst');
      blok.appendChild(tekst);
      function groepNaam(st) {
        var namen = st.bs.map(function (x) { return x.naam; });
        return namen.length > 1 ? namen.slice(0, -1).join(', ') + ' en ' + namen[namen.length - 1] : namen[0];
      }
      function zinVan(j) {
        var s = stappen[j];
        if (s.t === 'groep') return groepNaam(s) + '. ' + ((data.bijzaken || {})[lesId] || '');
        return s.t === 'begrip' ? s.b.naam + '. ' + s.b.def : verbandZin(verbanden[s.n]) + ' ' + verbanden[s.n].uitleg;
      }
      function toonStap(j) {
        Object.keys(svg.knoop).forEach(function (id) { svg.knoop[id].classList.remove('nu'); });
        Object.keys(svg.lijn).forEach(function (n) { svg.lijn[n].classList.remove('nu'); });
        nieuw.forEach(function (b) { svg.knoop[b.id].classList.add('weg'); svg.knoop[b.id].classList.remove('nu'); });
        Object.keys(svg.lijn).forEach(function (n) { if (svg.lijn[n].classList.contains('weg') || svg.lijn[n].classList.contains('getekend')) { svg.lijn[n].classList.add('weg'); svg.lijn[n].classList.remove('getekend', 'nu'); } });
        Object.keys(svg.knoop).forEach(function (id) { svg.knoop[id].classList.remove('raak'); });
        for (var s = 0; s <= j; s++) {
          var st = stappen[s];
          if (st.t === 'begrip') svg.knoop[st.b.id].classList.remove('weg');
          else if (st.t === 'groep') {
            st.bs.forEach(function (x) { svg.knoop[x.id].classList.remove('weg'); });
            st.ns.forEach(function (n) { if (svg.lijn[n]) { svg.lijn[n].classList.remove('weg'); svg.lijn[n].classList.add('getekend'); } });
          } else { svg.lijn[st.n].classList.remove('weg'); svg.lijn[st.n].classList.add('getekend'); }
        }
        tekst.innerHTML = '';
        if (j < 0) {
          tekst.appendChild(el('p', null, eerder.length
            ? 'In grijs zie je de begrippen die je al kent. Speel af om de ' + nieuw.length + ' begrippen van deze module erbij te zien komen.'
            : 'Dit wordt het begin van je kaart. Speel af om de ' + nieuw.length + ' begrippen van deze module te zien verschijnen.'));
          kijk(overzicht());
          return;
        }
        var st2 = stappen[j];
        if (st2.t === 'groep') {
          st2.bs.forEach(function (x) { svg.knoop[x.id].classList.add('nu'); });
          tekst.appendChild(el('p', 'groei-naam', groepNaam(st2)));
          if ((data.bijzaken || {})[lesId]) tekst.appendChild(el('p', null, data.bijzaken[lesId]));
        } else if (st2.t === 'begrip') {
          svg.knoop[st2.b.id].classList.add('nu');
          tekst.appendChild(el('p', 'groei-naam', st2.b.naam));
          tekst.appendChild(el('p', null, st2.b.def));
        } else {
          var v = verbanden[st2.n];
          svg.lijn[st2.n].classList.add('nu');
          svg.knoop[v.a].classList.add('raak');
          svg.knoop[v.b].classList.add('raak');
          tekst.appendChild(el('p', 'groei-naam', verbandZin(v)));
          tekst.appendChild(el('p', null, v.uitleg));
        }
        /* de camera volgt de stap; aan het eind het overzicht van de module */
        if (j === stappen.length - 1) kijk(overzicht());
        else if (st2.t === 'groep') {
          var ids = st2.bs.map(function (x) { return x.id; });
          st2.ns.forEach(function (n) { ids.push(verbanden[n].a, verbanden[n].b); });
          kijk(ids);
        } else if (st2.t === 'begrip') kijk([st2.b.id].concat(zichtbareBuren(st2.b.id)));
        else kijk([verbanden[st2.n].a, verbanden[st2.n].b]);
        if (j === stappen.length - 1) {
          var heleKaart = el('button', 'tekstknop', 'Bekijk je hele kaart');
          heleKaart.type = 'button';
          heleKaart.addEventListener('click', function () { toon('kaart'); });
          tekst.appendChild(heleKaart);
        }
      }
      var speler = stapSpeler({ stappen: stappen, toon: toonStap, tekst: zinVan });
      blok.appendChild(speler.balk);

      /* Klik op een begrip op de kaart voor de uitleg en zijn verbanden. */
      function toonBegrip(b) {
        Object.keys(svg.knoop).forEach(function (id) { svg.knoop[id].classList.remove('nu', 'raak'); });
        Object.keys(svg.lijn).forEach(function (n) { svg.lijn[n].classList.remove('nu'); });
        svg.knoop[b.id].classList.add('nu');
        var zinnen = [];
        buren[b.id].forEach(function (n) {
          var l = svg.lijn[n];
          if (!l || l.classList.contains('weg')) return;
          l.classList.add('nu');
          svg.knoop[ander(verbanden[n], b.id)].classList.add('raak');
          zinnen.push(verbandZin(verbanden[n]));
        });
        tekst.innerHTML = '';
        tekst.appendChild(el('p', 'groei-naam', b.naam));
        tekst.appendChild(el('p', null, b.def));
        if (zinnen.length) {
          var ul = el('ul', 'groei-verbanden');
          zinnen.forEach(function (z) { ul.appendChild(el('li', null, z)); });
          tekst.appendChild(ul);
        }
        var naarKaart = el('button', 'tekstknop', 'Bekijk dit begrip op je hele kaart');
        naarKaart.type = 'button';
        naarKaart.addEventListener('click', function () { toon('kaart', b.id); });
        tekst.appendChild(naarKaart);
        kijk([b.id].concat(zichtbareBuren(b.id)));
      }
      svg.el.setAttribute('role', 'group');
      Object.keys(svg.knoop).forEach(function (id) {
        var g = svg.knoop[id];
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'button');
        g.setAttribute('aria-label', perId[id].naam);
        function open() {
          if (g.classList.contains('weg')) return;
          speler.stop();
          toonBegrip(perId[id]);
        }
        g.addEventListener('click', open);
        g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
      return blok;
    }

    /* Een SVG met de begrippen op hun vaste plek. Zonder klein: hele kaart. */
    function kaartSvg(lijst, opt) {
      var ind = maakIndeling();
      var svgNS = 'http://www.w3.org/2000/svg';
      function s(tag, attrs) {
        var e = document.createElementNS(svgNS, tag);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
        return e;
      }
      var ids = {};
      lijst.forEach(function (b) { ids[b.id] = 1; });
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      ((opt && opt.focus) || lijst).forEach(function (b) {
        var p = ind.pos[ind.index[b.id]];
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      });
      var m = (opt && opt.marge) || 70;
      var vak = [minX - m, minY - m, Math.max(300, maxX - minX + 2 * m), Math.max(220, maxY - minY + 2 * m)];
      var svg = s('svg', { viewBox: vak.join(' '), role: 'img', 'aria-label': 'Kaart van begrippen', 'class': opt && opt.klein ? 'kaart-klein' : '' });
      var lijnen = s('g', { 'class': 'lijnen' }), knopen = s('g', { 'class': 'knopen' });
      svg.appendChild(lijnen);
      svg.appendChild(knopen);
      var lijn = {}, knoop = {};
      verbanden.forEach(function (v, n) {
        if (!ids[v.a] || !ids[v.b]) return;
        var a = ind.pos[ind.index[v.a]], b = ind.pos[ind.index[v.b]];
        var l = s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, pathLength: 1, stroke: (types[v.type] || {}).kleur || '#999' });
        lijnen.appendChild(l);
        lijn[n] = l;
      });
      lijst.forEach(function (b) {
        var p = ind.pos[ind.index[b.id]];
        var g = s('g', { 'class': 'knoop', transform: 'translate(' + p.x + ' ' + p.y + ')' });
        g.appendChild(s('circle', { r: 7 + Math.min(5, buren[b.id].length) }));
        var t = s('text', { y: -14, 'text-anchor': 'middle' });
        t.textContent = b.naam.length > 26 ? b.naam.slice(0, 24) + '…' : b.naam;
        g.appendChild(t);
        knopen.appendChild(g);
        knoop[b.id] = g;
      });
      return { el: svg, lijn: lijn, knoop: knoop, vak: vak };
    }

    /* ------------------------------------------------ luistersamenvatting */

    function nlStem() {
      var stemmen = [];
      try { stemmen = window.speechSynthesis.getVoices() || []; } catch (e) { return null; }
      var nl = stemmen.filter(function (s) { return /^nl/i.test(s.lang); });
      nl.sort(function (a, b) {
        function score(s) { return (/nl[-_]NL/i.test(s.lang) ? 0 : 1) + (/natural|online|google/i.test(s.name) ? -2 : 0); }
        return score(a) - score(b);
      });
      return nl[0] || null;
    }

    function luisterKaart(lesId) {
      var alineas = samenvattingen[lesId] || [];
      var kaart = el('div', 'luister');
      var woorden = alineas.join(' ').split(/\s+/).length;

      var kop = el('div', 'luister-kop');
      kop.appendChild(el('span', 'luister-icoon', '▶'));
      var titel = el('div');
      titel.appendChild(el('strong', null, 'Luister de samenvatting'));
      titel.appendChild(el('span', 'luister-duur', 'ongeveer ' + Math.max(1, Math.round(woorden / 140)) + ' minuten'));
      kop.appendChild(titel);
      kaart.appendChild(kop);

      /* De disclaimer staat bovenaan en is ook het eerste wat de stem zegt. */
      var letop = el('p', 'luister-let');
      letop.appendChild(el('span', 'luister-let-icoon', '!'));
      var letopTekst = el('span');
      letopTekst.appendChild(el('strong', null, 'Let op: '));
      letopTekst.appendChild(document.createTextNode(DISCLAIMER));
      letop.appendChild(letopTekst);
      kaart.appendChild(letop);

      var balk = el('div', 'luister-balk');
      var speel = el('button', 'knop-klein', 'Afspelen');
      speel.type = 'button';
      balk.appendChild(speel);
      var snelheden = el('span', 'luister-snelheid');
      snelheden.setAttribute('role', 'group');
      snelheden.setAttribute('aria-label', 'Snelheid');
      var snelheid = 1;
      [0.85, 1, 1.25, 1.5].forEach(function (s) {
        var b = el('button', null, String(s).replace('.', ',') + '×');
        b.type = 'button';
        b.setAttribute('aria-pressed', s === 1 ? 'true' : 'false');
        b.addEventListener('click', function () {
          snelheid = s;
          Array.prototype.forEach.call(snelheden.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          if (speelt) speelVanaf(i);
        });
        snelheden.appendChild(b);
      });
      balk.appendChild(snelheden);
      var melding = el('span', 'luister-melding');
      balk.appendChild(melding);
      kaart.appendChild(balk);

      /* De tekst staat ingeklapt, zodat de begrippen en vragen niet ver naar
         beneden schuiven; bij afspelen gaat hij open om mee te lezen. */
      var meelees = el('details', 'luister-meelees');
      meelees.appendChild(el('summary', null, 'Lees de tekst mee'));
      var tekst = el('div', 'luister-tekst');
      meelees.appendChild(tekst);
      var zinnen = [{ tekst: 'Let op. ' + DISCLAIMER, span: letop }];
      alineas.forEach(function (a) {
        var p = el('p');
        (a.match(/[^.!?]+[.!?]+[”’")]*\s*|[^.!?]+$/g) || [a]).forEach(function (z) {
          var span = el('span', 'zin', z);
          var nr = zinnen.length;
          span.addEventListener('click', function () { if (kan) speelVanaf(nr); });
          zinnen.push({ tekst: z.trim(), span: span });
          p.appendChild(span);
        });
        tekst.appendChild(p);
      });
      kaart.appendChild(meelees);

      var kan = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
      var i = 0, speelt = false, beurt = 0, ooitGestart = false;

      function markeer(n) {
        zinnen.forEach(function (z, j) { z.span.classList.toggle('nu', j === n); });
        if (n >= 0 && zinnen[n]) {
          var r = zinnen[n].span.getBoundingClientRect();
          if (r.top < 70 || r.bottom > window.innerHeight - 20) zinnen[n].span.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
      function stopIntern() {
        speelt = false;
        beurt++;
        try { window.speechSynthesis.cancel(); } catch (e) { /* niets */ }
      }
      function klaar() {
        stopIntern();
        markeer(-1);
        speel.textContent = 'Afspelen';
      }
      function spreek() {
        if (!document.body.contains(kaart)) return klaar();
        if (i >= zinnen.length) { i = 0; return klaar(); }
        var mijn = ++beurt;
        var u = new window.SpeechSynthesisUtterance(zinnen[i].tekst);
        var stem = nlStem();
        u.lang = stem ? stem.lang : 'nl-NL';
        if (stem) u.voice = stem;
        u.rate = snelheid;
        u.onend = function () {
          if (mijn !== beurt || !speelt) return;
          i++;
          spreek();
        };
        u.onerror = function () { if (mijn === beurt && speelt) { i++; spreek(); } };
        u.onstart = function () { ooitGestart = true; };
        meelees.open = true;
        markeer(i);
        speel.textContent = 'Pauzeren';
        window.speechSynthesis.speak(u);
        /* Sommige browsers hebben geen stem en zeggen dat niet: dan start er niets. */
        if (!ooitGestart) setTimeout(function () {
          if (ooitGestart || mijn !== beurt || !speelt) return;
          klaar();
          melding.textContent = 'Voorlezen lukt niet in deze browser. Je kunt de tekst hieronder lezen.';
        }, 2500);
      }

      function controleerStem() {
        if (!kan) {
          speel.disabled = true;
          melding.textContent = 'Deze browser kan niet voorlezen. Je kunt de tekst hieronder lezen.';
          return;
        }
        var stemmen = window.speechSynthesis.getVoices() || [];
        if (stemmen.length && !nlStem()) melding.textContent = 'Geen Nederlandse voorleesstem gevonden; de standaardstem leest voor.';
        else melding.textContent = '';
      }
      controleerStem();
      if (kan && window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', controleerStem);

      /* Pauzeren is stoppen en onthouden bij welke zin je was: pause() en
         resume() werken in niet elke browser betrouwbaar. */
      function speelVanaf(n) {
        stopSpraak();
        spraakStop = klaar;
        i = n;
        speelt = true;
        spreek();
      }
      speel.addEventListener('click', function () {
        if (!kan) return;
        if (speelt) {
          stopIntern();
          speel.textContent = 'Verder luisteren';
          return;
        }
        speelVanaf(i);
      });
      return kaart;
    }

    /* ------------------------------------------------ begrippen in de module */

    function begripDetails(b, metKaartLink) {
      var d = el('details', 'begrip');
      var s = el('summary');
      s.appendChild(el('span', 'begrip-naam', b.naam));
      if (b.sub) s.appendChild(el('span', 'begrip-sub', b.sub));
      d.appendChild(s);
      var binnen = el('div', 'begrip-binnen');
      binnen.appendChild(el('p', null, b.def));
      if (b.vb) {
        var vb = el('p', 'begrip-vb');
        vb.appendChild(el('span', null, 'Voorbeeld: '));
        vb.appendChild(document.createTextNode(b.vb));
        binnen.appendChild(vb);
      }
      if (metKaartLink && buren[b.id].length) {
        var a = el('button', 'tekstknop', 'Bekijk ' + buren[b.id].length + (buren[b.id].length === 1 ? ' verband' : ' verbanden') + ' in de kaart');
        a.type = 'button';
        a.addEventListener('click', function () { toon('kaart', b.id); });
        binnen.appendChild(a);
      }
      d.appendChild(binnen);
      return d;
    }

    function begrippenBlok(lesId) {
      var eigen = begrippenVan(lesId);
      var blok = el('div', 'begrippen-blok');
      var kop = el('div', 'begrippen-kop');
      kop.appendChild(el('strong', null, 'Begrippen uit deze module'));
      kop.appendChild(el('span', null, eigen.length + (eigen.length === 1 ? ' begrip' : ' begrippen')));
      blok.appendChild(kop);
      eigen.forEach(function (b) { blok.appendChild(begripDetails(b, true)); });
      return blok;
    }

    /* ------------------------------------------------ weet je nog? */

    /* Ouder en kind bij een 'onderdeel of soort van'-verband; de richting
       verschilt per formulering. */
    function ouderKind(v) {
      if (v.type !== 'D') return null;
      if (/^(bestaat uit|omvat|werkt via|draait vooral om)/.test(v.rel)) return { ouder: v.a, kind: v.b };
      if (/^is een/.test(v.rel)) return { ouder: v.b, kind: v.a };
      return null;
    }
    function kinderen(id) {
      var uit = [];
      buren[id].forEach(function (n) { var ok = ouderKind(verbanden[n]); if (ok && ok.ouder === id) uit.push(ok.kind); });
      return uit;
    }
    function broers(id) {
      var uit = [];
      buren[id].forEach(function (n) {
        var ok = ouderKind(verbanden[n]);
        if (ok && ok.kind === id) kinderen(ok.ouder).forEach(function (k) { if (k !== id && uit.indexOf(k) < 0) uit.push(k); });
      });
      return uit;
    }
    /* Bronvermeldingen als (Bandura, 1999) laten we weg in vragen: anders kies
       je het antwoord op de auteur in plaats van op de inhoud. */
    function zonderBron(tekst) {
      return String(tekst || '')
        .replace(/\s*\([^()]*\b(19|20)\d\d[a-z]?\)/g, '')
        .replace(/\s*\((?:[A-Z][^\s(),]*(?:\s(?:en|&)\s|,\s)?)+\)/g, '')
        .replace(/\s+([.,;:])/g, '$1');
    }
    function maskeer(tekst, b) {
      [b.naam].concat(b.sub ? [b.sub] : []).forEach(function (n) {
        var kern = n.replace(/\s*\(.*\)\s*/g, '').trim();
        if (kern.length > 3) tekst = tekst.split(kern).join('…').split(kern.toLowerCase()).join('…');
      });
      return tekst;
    }
    /* Afleiders die er bewust op lijken: broers, buren en begrippen uit dezelfde
       module. Bij een voorbeeld geen ouder of kind, want het voorbeeld van een
       soort past ook bij het geheel. */
    function lijktOp(b, maxLes, zonderFamilie, rnd) {
      var familie = {};
      if (zonderFamilie) buren[b.id].forEach(function (n) { var ok = ouderKind(verbanden[n]); if (ok) familie[ander(verbanden[n], b.id)] = 1; });
      var ok = function (x) { return x && x !== b && !x.bijzaak && lesNr[x.les] <= maxLes && !familie[x.id]; };
      var lijst = [];
      function voeg(x) { if (ok(x) && lijst.indexOf(x) < 0) lijst.push(x); }
      hussel(broers(b.id), rnd).forEach(function (id) { voeg(perId[id]); });
      hussel(buren[b.id].map(function (n) { return perId[ander(verbanden[n], b.id)]; }), rnd).forEach(voeg);
      hussel(begrippenVan(b.les), rnd).forEach(voeg);
      hussel(begrippen, rnd).forEach(voeg);
      return lijst.slice(0, 3);
    }

    function voorbeeldVraag(b, sleutel, maxLes) {
      if (!b.vb) return null;
      var rnd = reeks(sleutel);
      var af3 = lijktOp(b, maxLes, true, rnd);
      if (af3.length < 3) return null;
      return {
        t: 'quiz', label: 'Weet je nog?',
        question: '<p>Welk begrip herken je in dit voorbeeld?</p><p class="verband-zin">' + esc(maskeer(zonderBron(b.vb), b)) + '</p>',
        options: hussel([b].concat(af3), rnd).map(function (x) { return { text: x.naam, correct: x === b }; }),
        feedback: b.naam + ': ' + b.def
      };
    }
    function omschrijvingVraag(b, sleutel, maxLes) {
      var rnd = reeks(sleutel);
      var af3 = lijktOp(b, maxLes, false, rnd);
      if (af3.length < 3) return null;
      return {
        t: 'quiz', label: 'Weet je nog?',
        question: '<p>Welke omschrijving hoort bij <strong>' + esc(b.naam) + '</strong>?</p>',
        options: hussel([b].concat(af3), rnd).map(function (x) { return { text: maskeer(zonderBron(x.def), x), correct: x === b, feedback: x === b ? '' : 'Dit is ' + x.naam + '.' }; }),
        feedback: b.naam + ': ' + b.def
      };
    }
    /* Meer antwoorden goed: welke begrippen vallen onder een geheel? */
    function onderdelenVraag(b, sleutel, maxLes) {
      var rnd = reeks(sleutel);
      var ouder = kinderen(b.id).length >= 3 ? b : null;
      if (!ouder) buren[b.id].forEach(function (n) { var ok = ouderKind(verbanden[n]); if (!ouder && ok && ok.kind === b.id && kinderen(ok.ouder).length >= 3) ouder = perId[ok.ouder]; });
      if (!ouder) return null;
      var kids = kinderen(ouder.id).map(function (id) { return perId[id]; });
      var goed = hussel(kids, rnd).slice(0, 2);
      if (goed.indexOf(b) < 0 && kids.indexOf(b) >= 0) goed[0] = b;
      var verboden = {};
      verboden[ouder.id] = 1;
      kids.forEach(function (x) { verboden[x.id] = 1; });
      buren[ouder.id].forEach(function (n) { verboden[ander(verbanden[n], ouder.id)] = 1; });
      var fout = hussel(begrippen.filter(function (x) { return !verboden[x.id] && !x.bijzaak && lesNr[x.les] <= maxLes && Math.abs(lesNr[x.les] - lesNr[ouder.les]) <= 1; }), rnd).slice(0, 2);
      if (fout.length < 2) return null;
      return {
        t: 'quiz', multi: true, label: 'Weet je nog? · meer antwoorden goed',
        question: '<p>Wat hoort bij <strong>' + esc(ouder.naam) + '</strong>? Kies alle juiste antwoorden.</p>',
        options: hussel(goed.concat(fout), rnd).map(function (x) { return { text: x.naam, correct: goed.indexOf(x) >= 0 }; }),
        feedback: ouder.naam + ' omvat onder meer ' + kids.map(function (x) { return x.naam; }).join(', ') + '.'
      };
    }

    /* Begrippen die je fout had komen vaker terug, oude modules ook. */
    function kiesHerhaling(pool, k, rnd) {
      var hst = staat().herhaal || {};
      return pool.map(function (b) {
        var h = hst[b.id] || { g: 0, f: 0 };
        var w = 1 + h.f * 3 - h.g * 0.6 + (h.g + h.f === 0 ? 1.2 : 0) + (k - lesNr[b.les]) * 0.05;
        return { b: b, w: Math.max(0.15, w) * (0.4 + rnd()) };
      }).sort(function (x, y) { return y.w - x.w; }).map(function (x) { return x.b; });
    }
    function onthoud(id, goed) {
      var st = staat();
      if (!st.herhaal) st.herhaal = {};
      var h = st.herhaal[id] || (st.herhaal[id] = { g: 0, f: 0 });
      if (goed) h.g++; else h.f++;
      api.bewaar();
    }

    function herhaling(les) {
      var k = lesNr[les.id];
      var eerder = begrippen.filter(function (b) { return lesNr[b.les] < k && af(b.les) && !b.bijzaak; });
      if (eerder.length < 3) return null;
      var ms = api.moduleStaat(les.id);
      var ronde = ms.herhaalRonde || 0;
      var vak = el('details', 'herhaal');
      vak.open = !ms.af && !ms.segment;
      var sum = el('summary');
      sum.appendChild(el('strong', null, 'Weet je nog?'));
      sum.appendChild(el('span', null, ' Drie vragen over eerdere modules'));
      vak.appendChild(sum);
      var binnen = el('div', 'herhaal-binnen');
      vak.appendChild(binnen);

      function vul() {
        binnen.innerHTML = '';
        binnen.appendChild(el('p', 'herhaal-uitleg', 'Even ophalen wat je eerder leerde helpt je het te onthouden. Wat je fout hebt, komt later vaker terug. Deze vragen tellen niet mee voor je voortgang.'));
        var rnd = reeks(les.id + ':herhaal:' + ronde);
        var vormen = hussel([voorbeeldVraag, omschrijvingVraag, onderdelenVraag], rnd);
        /* Per vraagvorm het hoogst gerangschikte begrip dat zich ervoor leent. */
        var gekozen = [], volgorde = kiesHerhaling(eerder, k, rnd), gebruikt = {};
        vormen.forEach(function (vorm) {
          var q = null;
          volgorde.some(function (b) {
            if (gebruikt[b.id]) return false;
            q = vorm(b, les.id + ':' + ronde + ':' + b.id, k);
            if (q) { gebruikt[b.id] = 1; gekozen.push({ b: b, q: q }); }
            return !!q;
          });
          if (!q) volgorde.some(function (b) {
            if (gebruikt[b.id]) return false;
            var r = omschrijvingVraag(b, les.id + ':' + ronde + ':' + b.id, k) || definitieVraag(b, les.id + ':' + ronde + ':' + b.id);
            if (r) { gebruikt[b.id] = 1; gekozen.push({ b: b, q: r }); }
            return !!r;
          });
        });
        var score = el('p', 'herhaal-score');
        gekozen.forEach(function (x, n) {
          var id = les.id + ':h' + ronde + ':' + n;
          var node = api.tekenBlok(x.q, les.id, 'h' + ronde, n, function () {
            var a = ms.antwoorden[id];
            if (a) onthoud(x.b.id, a.goed);
            werkScoreBij();
          });
          if (node) binnen.appendChild(node);
        });
        function werkScoreBij() {
          var klaar = gekozen.map(function (x, n) { return ms.antwoorden[les.id + ':h' + ronde + ':' + n]; }).filter(Boolean);
          score.textContent = klaar.length === gekozen.length
            ? klaar.filter(function (a) { return a.goed; }).length + ' van de ' + gekozen.length + ' goed.'
            : '';
        }
        binnen.appendChild(score);
        werkScoreBij();
        var nieuw = el('button', 'knop-klein stil', 'Andere vragen');
        nieuw.type = 'button';
        nieuw.addEventListener('click', function () {
          Object.keys(ms.antwoorden).forEach(function (id) { if (id.indexOf(les.id + ':h' + ronde + ':') === 0) delete ms.antwoorden[id]; });
          ronde++;
          ms.herhaalRonde = ronde;
          api.bewaar();
          vul();
        });
        /* Een duidelijke grens: hier stopt de terugblik en begint de module. */
        var door = el('button', 'knop-klein', 'Ga door naar module ' + (k + 1) + ': ' + (les.title || '') + ' ↓');
        door.type = 'button';
        door.addEventListener('click', function () {
          vak.open = false;
          var eerste = vak.parentNode && vak.parentNode.querySelector('.segment');
          if (eerste) eerste.scrollIntoView({ block: 'start' });
        });
        var acties = el('div', 'herhaal-acties');
        acties.appendChild(door);
        acties.appendChild(nieuw);
        binnen.appendChild(acties);
      }
      vul();
      return vak;
    }

    /* ------------------------------------------------ startpagina */

    var casusData = null;
    var casusBelofte = null;
    function laadCasussen() {
      if (!casusBelofte) {
        casusBelofte = fetch('modules/casussen.json', { cache: 'no-cache' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (c) {
            if (!c || (c.cursussen || []).indexOf(api.slug) < 0) return null;
            var anderen = c.cursussen.filter(function (s) { return s !== api.slug; });
            return Promise.all(anderen.map(function (s) {
              return fetch('modules/' + s + '/verdieping.json', { cache: 'no-cache' })
                .then(function (r) { return r.ok ? r.json() : { begrippen: [] }; })
                .catch(function () { return { begrippen: [] }; })
                .then(function (v) { return { slug: s, begrippen: v.begrippen || [] }; });
            })).then(function (lijsten) {
              c.pool = {};
              begrippen.forEach(function (b) { c.pool[api.slug + '/' + b.id] = { cursus: api.slug, b: b }; });
              lijsten.forEach(function (l) { l.begrippen.forEach(function (b) { c.pool[l.slug + '/' + b.id] = { cursus: l.slug, b: b }; }); });
              casusData = c;
              return c;
            });
          })
          .catch(function () { return null; });
      }
      return casusBelofte;
    }

    function hulpmiddelen() {
      var rij = el('div', 'hulpmiddelen');
      var ontdekt = begrippen.filter(function (b) { return af(b.les); }).length;
      function tegel(titel, regel, doel) {
        var t = el('button', 'hulpmiddel');
        t.type = 'button';
        t.appendChild(el('strong', null, titel));
        t.appendChild(el('span', null, regel));
        t.addEventListener('click', function () { toon(doel); });
        rij.appendChild(t);
        return t;
      }
      tegel('Begrippen', begrippen.length + ' begrippen met uitleg en luistersamenvattingen', 'begrippen');
      tegel('Kaart van verbanden', ontdekt + ' van ' + begrippen.length + ' begrippen ontdekt' + (lijnen.length ? ' · ' + lijnen.filter(lijnOpen).length + ' van ' + lijnen.length + ' verhaallijnen' : ''), 'kaart');
      laadCasussen().then(function (c) {
        if (c && c.casussen && c.casussen.length) tegel('Oefencasussen', c.casussen.length + ' casussen om begrippen in te herkennen', 'casussen');
      });
      return rij;
    }

    /* ------------------------------------------------ losse schermen */

    var SCHERMEN = { begrippen: 'Begrippen', kaart: 'Kaart van verbanden', casussen: 'Oefencasussen' };

    function kan(hash) { return SCHERMEN[String(hash).split(':')[0]] !== undefined; }

    function toon(naam, arg) {
      var doel = naam + (arg !== undefined && arg !== null && arg !== '' ? ':' + arg : '');
      if ((location.hash || '').replace('#', '') !== doel) {
        location.hash = doel;
        return;
      }
      stopSpraak();
      var delen = doel.split(':');
      var scherm = delen[0];
      arg = delen.slice(1).join(':');
      document.body.innerHTML = '';
      document.title = SCHERMEN[scherm] + ' | ' + cursus.title;

      var balk = el('header', 'leesbalk');
      var binnen = el('div', 'leesbalk-inner');
      var terug = el('button', 'terug', '← Alle modules');
      terug.type = 'button';
      terug.addEventListener('click', api.toonStart);
      binnen.appendChild(terug);
      binnen.appendChild(el('span', 'naam', SCHERMEN[scherm]));
      balk.appendChild(binnen);
      document.body.appendChild(balk);

      var lezer = el('main', 'lezer' + (scherm === 'kaart' ? ' breed' : ''));
      var kop = el('div', 'moduletitel');
      kop.appendChild(el('p', 'kicker', cursus.title));
      kop.appendChild(el('h1', null, SCHERMEN[scherm]));
      lezer.appendChild(kop);
      document.body.appendChild(lezer);

      if (scherm === 'begrippen') toonBegrippen(lezer);
      else if (scherm === 'kaart') toonKaart(lezer, arg);
      else if (scherm === 'casussen') toonCasussen(lezer, arg);
      window.scrollTo(0, 0);
    }

    /* ------------------------------------------------ begrippenlijst */

    function toonBegrippen(lezer) {
      lezer.appendChild(el('p', 'scherm-intro', 'Alle begrippen van deze e-learning, per module. Zoek op een woord of klik een begrip open voor uitleg en een voorbeeld.'));
      var zoek = el('input', 'zoekveld');
      zoek.type = 'search';
      zoek.placeholder = 'Zoek een begrip';
      zoek.setAttribute('aria-label', 'Zoek een begrip');
      lezer.appendChild(zoek);
      var lijst = el('div', 'begrippenlijst');
      lezer.appendChild(lijst);
      var leeg = el('p', 'scherm-intro', 'Geen begrip gevonden.');

      function norm(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
      function teken() {
        lijst.innerHTML = '';
        var q = norm(zoek.value.trim());
        var gevonden = 0;
        lessen.forEach(function (les, n) {
          var eigen = begrippenVan(les.id).filter(function (b) {
            return !q || norm(b.naam + ' ' + (b.sub || '') + ' ' + b.def).indexOf(q) >= 0;
          });
          if (!eigen.length) return;
          gevonden += eigen.length;
          var sectie = el('section', 'begrippen-module');
          sectie.appendChild(el('h2', null, 'Module ' + (n + 1) + ' · ' + les.title));
          if (samenvattingen[les.id] && !q) {
            var luister = el('details', 'luister-uitklap');
            var s = el('summary', null, 'Luistersamenvatting (alleen de samenvatting volgen is niet voldoende voor het tentamen)');
            luister.appendChild(s);
            luister.addEventListener('toggle', function () {
              if (luister.open && luister.children.length === 1) luister.appendChild(luisterKaart(les.id));
              if (!luister.open) stopSpraak();
            });
            sectie.appendChild(luister);
          }
          eigen.forEach(function (b) {
            var d = begripDetails(b, true);
            if (q) d.open = true;
            sectie.appendChild(d);
          });
          lijst.appendChild(sectie);
        });
        if (!gevonden) lijst.appendChild(leeg);
      }
      zoek.addEventListener('input', teken);
      teken();
    }

    /* ------------------------------------------------ kaart van verbanden */

    /* Eén vaste indeling voor alle begrippen, zodat de kaart op dezelfde plek
       blijft als hij groeit: modules als clusters op een cirkel, daarna een
       eenvoudige krachtsimulatie. */
    var indeling = null;
    function maakIndeling() {
      if (indeling) return indeling;
      var rnd = reeks('kaart:' + api.slug);
      var n = lessen.length;
      var R = 300 + n * 18;
      var mid = {};
      lessen.forEach(function (l, i) {
        var hoek = -Math.PI / 2 + (i / n) * Math.PI * 2;
        mid[l.id] = { x: Math.cos(hoek) * R, y: Math.sin(hoek) * R * 0.78 };
      });
      var pos = begrippen.map(function (b) {
        var m = mid[b.les];
        return { x: m.x + (rnd() - 0.5) * 120, y: m.y + (rnd() - 0.5) * 120, vx: 0, vy: 0 };
      });
      var index = {};
      begrippen.forEach(function (b, i) { index[b.id] = i; });
      var veren = verbanden.map(function (v) { return [index[v.a], index[v.b]]; });
      for (var stap = 0; stap < 320; stap++) {
        var koel = 1 - stap / 320;
        for (var i = 0; i < pos.length; i++) {
          for (var j = i + 1; j < pos.length; j++) {
            var dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
            var d2 = dx * dx + dy * dy + 0.01;
            if (d2 > 90000) continue;
            var kracht = 3000 / d2;
            var d = Math.sqrt(d2);
            pos[i].vx += dx / d * kracht; pos[i].vy += dy / d * kracht;
            pos[j].vx -= dx / d * kracht; pos[j].vy -= dy / d * kracht;
          }
        }
        veren.forEach(function (p) {
          var a = pos[p[0]], b = pos[p[1]];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d = Math.sqrt(dx * dx + dy * dy) + 0.01;
          var k = (d - 85) * 0.012;
          a.vx += dx / d * k * d * 0.02; a.vy += dy / d * k * d * 0.02;
          b.vx -= dx / d * k * d * 0.02; b.vy -= dy / d * k * d * 0.02;
        });
        begrippen.forEach(function (bg, i) {
          var m = mid[bg.les];
          pos[i].vx += (m.x - pos[i].x) * 0.022;
          pos[i].vy += (m.y - pos[i].y) * 0.022;
          pos[i].x += Math.max(-12, Math.min(12, pos[i].vx)) * koel;
          pos[i].y += Math.max(-12, Math.min(12, pos[i].vy)) * koel;
          pos[i].vx *= 0.6; pos[i].vy *= 0.6;
        });
      }
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      pos.forEach(function (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
      var marge = 70;
      indeling = { pos: pos, index: index, mid: mid, vak: [minX - marge, minY - marge, maxX - minX + 2 * marge, maxY - minY + 2 * marge] };
      return indeling;
    }

    function toonKaart(lezer, gekozenId) {
      var st = staat();
      var ind = maakIndeling();
      var svgNS = 'http://www.w3.org/2000/svg';
      function s(tag, attrs) {
        var e = document.createElementNS(svgNS, tag);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
        return e;
      }

      /* Een verhaallijn openen vanaf het eind van een module kan voordat die
         module af is: zijn begrippen tonen we dan alvast. */
      var lijnNr = /^lijn-\d+$/.test(gekozenId || '') ? Number(gekozenId.slice(5)) : -1;
      var startLijn = lijnen.filter(function (l) { return l.nr === lijnNr; })[0] || null;
      var extra = {};
      if (startLijn) startLijn.ids.forEach(function (id) { extra[id] = 1; });
      var zichtbaar = function (b) { return st.kaartAlles || af(b.les) || !!extra[b.id]; };
      var aantal = begrippen.filter(zichtbaar).length;

      var intro = el('div', 'kaart-intro');
      var tekst = el('p', 'scherm-intro');
      var afgerond = begrippen.filter(function (b) { return af(b.les); }).length;
      tekst.textContent = afgerond
        ? 'Je hebt ' + afgerond + ' van de ' + begrippen.length + ' begrippen ontdekt. Rond een module af, dan komen de begrippen daarvan erbij. Klik op een begrip om te zien hoe het samenhangt met andere.'
        : 'De kaart groeit mee: rond een module af, dan verschijnen de begrippen daarvan hier, met hun verbanden. Je kunt ook alvast alles bekijken.';
      intro.appendChild(tekst);
      var schakel = el('label', 'schakel');
      var vink = el('input');
      vink.type = 'checkbox';
      vink.checked = !!st.kaartAlles;
      vink.addEventListener('change', function () { st.kaartAlles = vink.checked; api.bewaar(); toonOpnieuw(); });
      schakel.appendChild(vink);
      schakel.appendChild(document.createTextNode(' Toon ook begrippen van modules die je nog niet hebt afgerond'));
      intro.appendChild(schakel);
      lezer.appendChild(intro);

      var legenda = el('div', 'kaart-legenda');
      Object.keys(types).forEach(function (t) {
        var item = el('span');
        var streep = el('i');
        streep.style.background = types[t].kleur;
        item.appendChild(streep);
        item.appendChild(document.createTextNode(types[t].naam));
        legenda.appendChild(item);
      });
      lezer.appendChild(legenda);

      if (lijnen.length) {
        var lijnVak = el('div', 'kaart-lijnen');
        lijnVak.appendChild(el('strong', null, 'Verhaallijnen'));
        var lijnRij = el('div', 'kaart-lijnen-rij');
        lijnen.forEach(function (l) {
          var open = lijnOpen(l) || st.kaartAlles || l === startLijn;
          var k = el('button', 'lijn-chip' + (open ? '' : ' dicht'), (open ? '' : '🔒 ') + l.titel);
          k.type = 'button';
          if (!open) {
            k.disabled = true;
            k.title = 'Rond module ' + (l.laatste + 1) + ' en de modules ervoor af om deze verhaallijn te openen.';
          } else k.addEventListener('click', function () { if (l.ids.every(function (id) { return knoopPer[id]; })) speelLijn(l); else toonOpnieuw('lijn-' + l.nr); });
          lijnRij.appendChild(k);
        });
        lijnVak.appendChild(lijnRij);
        lezer.appendChild(lijnVak);
      }

      var werk = el('div', 'kaart-werk');
      var vlak = el('div', 'kaart-vlak');
      var detail = el('aside', 'kaart-detail');
      werk.appendChild(vlak);
      werk.appendChild(detail);
      lezer.appendChild(werk);

      if (!aantal) {
        vlak.appendChild(el('p', 'kaart-leeg', 'Nog geen begrippen op de kaart. Rond je eerste module af.'));
        detail.remove();
        return;
      }

      var vb = ind.vak.slice();
      var svg = s('svg', { viewBox: vb.join(' '), role: 'img', 'aria-label': 'Kaart van verbanden tussen begrippen' });
      vlak.appendChild(svg);
      var lijnGroep = s('g', { 'class': 'lijnen' });
      var knopen = s('g', { 'class': 'knopen' });
      svg.appendChild(lijnGroep);
      svg.appendChild(knopen);

      /* module-namen als lichte achtergrondlabels */
      lessen.forEach(function (l, i) {
        var eigen = begrippenVan(l.id).filter(zichtbaar);
        if (!eigen.length) return;
        /* boven het hoogste begrip van het cluster, zodat het label niets bedekt */
        var xs = 0, boven = Infinity;
        eigen.forEach(function (b) { var p = ind.pos[ind.index[b.id]]; xs += p.x; boven = Math.min(boven, p.y); });
        var t = s('text', { x: xs / eigen.length, y: boven - 34, 'class': 'kaart-module', 'text-anchor': 'middle' });
        t.textContent = 'Module ' + (i + 1);
        lijnGroep.appendChild(t);
      });

      var lijnPer = [];
      verbanden.forEach(function (v, n) {
        if (!zichtbaar(perId[v.a]) || !zichtbaar(perId[v.b])) return;
        var a = ind.pos[ind.index[v.a]], b = ind.pos[ind.index[v.b]];
        var lijn = s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: (types[v.type] || {}).kleur || '#999' });
        lijn.dataset.n = n;
        lijnGroep.appendChild(lijn);
        lijnPer[n] = lijn;
      });
      var knoopPer = {};
      begrippen.forEach(function (b) {
        if (!zichtbaar(b)) return;
        var p = ind.pos[ind.index[b.id]];
        var g = s('g', { 'class': 'knoop', transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: '0', role: 'button', 'aria-label': b.naam });
        g.appendChild(s('circle', { r: 7 + Math.min(5, buren[b.id].length) }));
        var t = s('text', { y: -14, 'text-anchor': 'middle' });
        t.textContent = b.naam.length > 26 ? b.naam.slice(0, 24) + '…' : b.naam;
        g.appendChild(t);
        g.addEventListener('click', function (e) { e.stopPropagation(); kies(b.id); });
        g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kies(b.id); } });
        knopen.appendChild(g);
        knoopPer[b.id] = g;
      });

      function kies(id) {
        var b = perId[id];
        if (!b || !knoopPer[id]) { leegDetail(); return; }
        svg.classList.add('gekozen');
        Object.keys(knoopPer).forEach(function (k) { knoopPer[k].classList.remove('actief', 'buur'); });
        lijnPer.forEach(function (l) { if (l) l.classList.remove('actief'); });
        knoopPer[id].classList.add('actief');
        buren[id].forEach(function (n) {
          var o = ander(verbanden[n], id);
          if (knoopPer[o]) knoopPer[o].classList.add('buur');
          if (lijnPer[n]) lijnPer[n].classList.add('actief');
        });
        try { history.replaceState(null, '', '#kaart:' + id); } catch (e) { /* bestand */ }
        toonDetail(b);
      }

      function leegDetail() {
        svg.classList.remove('gekozen');
        Object.keys(knoopPer).forEach(function (k) { knoopPer[k].classList.remove('actief', 'buur'); });
        lijnPer.forEach(function (l) { if (l) l.classList.remove('actief'); });
        detail.innerHTML = '';
        detail.appendChild(el('p', 'kaart-hint', 'Klik op een begrip in de kaart om de uitleg en de verbanden te zien.'));
      }

      function toonDetail(b) {
        detail.innerHTML = '';
        detail.appendChild(el('p', 'kicker', 'Module ' + (lesNr[b.les] + 1)));
        detail.appendChild(el('h2', null, b.naam));
        if (b.sub) detail.appendChild(el('p', 'begrip-sub', b.sub));
        detail.appendChild(el('p', null, b.def));
        if (b.vb) {
          var vbp = el('p', 'begrip-vb');
          vbp.appendChild(el('span', null, 'Voorbeeld: '));
          vbp.appendChild(document.createTextNode(b.vb));
          detail.appendChild(vbp);
        }
        var eigen = buren[b.id];
        if (eigen.length) {
          detail.appendChild(el('h3', null, 'Verbanden'));
          var ul = el('ul', 'verbandlijst');
          eigen.forEach(function (n) {
            var v = verbanden[n];
            var o = perId[ander(v, b.id)];
            var li = el('li');
            var stip = el('i');
            stip.style.background = (types[v.type] || {}).kleur || '#999';
            li.appendChild(stip);
            var regel = el('div');
            var zin = el('p', 'verband-regel');
            function naamKnop(x) {
              if (x === b) return el('strong', null, x.naam);
              var k = el('button', 'tekstknop', x.naam);
              k.type = 'button';
              if (!knoopPer[x.id]) k.title = 'Nog niet ontdekt';
              k.addEventListener('click', function () { if (knoopPer[x.id]) kies(x.id); else { st.kaartAlles = true; api.bewaar(); toonOpnieuw(x.id); } });
              return k;
            }
            zin.appendChild(naamKnop(perId[v.a]));
            zin.appendChild(document.createTextNode(' ' + v.rel + ' '));
            zin.appendChild(naamKnop(perId[v.b]));
            regel.appendChild(zin);
            regel.appendChild(el('p', 'verband-uitleg', v.uitleg));
            li.appendChild(regel);
            ul.appendChild(li);
            if (!knoopPer[o.id]) li.classList.add('verborgen');
          });
          detail.appendChild(ul);
        }
        var buiten = extern.filter(function (x) { return x.begrip === b.id; });
        if (buiten.length) {
          detail.appendChild(el('h3', null, 'In ' + (KORT[buiten[0].cursus] || 'de andere e-learning')));
          var ul2 = el('ul', 'verbandlijst');
          buiten.forEach(function (x) {
            var li = el('li');
            var stip = el('i');
            stip.style.background = (types[x.type] || {}).kleur || '#999';
            li.appendChild(stip);
            var regel = el('div');
            regel.appendChild(el('p', 'verband-regel', x.richting === 'uit' ? b.naam + ' ' + x.rel + ' ' + x.naam : x.naam + ' ' + x.rel + ' ' + b.naam));
            regel.appendChild(el('p', 'verband-uitleg', x.uitleg));
            li.appendChild(regel);
            ul2.appendChild(li);
          });
          detail.appendChild(ul2);
        }
        if (window.matchMedia('(max-width: 899px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      var netGesleept = false;
      svg.addEventListener('click', function () {
        if (netGesleept) { netGesleept = false; return; }
        leegDetail();
      });

      /* zoomen en schuiven */
      var zoom = el('div', 'kaart-zoom');
      function knop(tekst, label, actie) {
        var k = el('button', null, tekst);
        k.type = 'button';
        k.setAttribute('aria-label', label);
        k.addEventListener('click', actie);
        zoom.appendChild(k);
      }
      function zet() { svg.setAttribute('viewBox', vb.join(' ')); }
      function schaal(f) {
        var cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2;
        vb[2] *= f; vb[3] *= f;
        vb[0] = cx - vb[2] / 2; vb[1] = cy - vb[3] / 2;
        zet();
      }
      knop('+', 'Inzoomen', function () { schaal(0.75); });
      knop('−', 'Uitzoomen', function () { schaal(1 / 0.75); });
      knop('⤢', 'Hele kaart', function () { vb = ind.vak.slice(); zet(); });
      vlak.appendChild(zoom);

      var sleep = null;
      svg.addEventListener('pointerdown', function (e) {
        if (e.target.closest && e.target.closest('.knoop')) return;
        sleep = { x: e.clientX, y: e.clientY, vb: vb.slice(), bewogen: false };
      });
      svg.addEventListener('pointermove', function (e) {
        if (!sleep) return;
        var f = vb[2] / svg.clientWidth;
        var dx = (e.clientX - sleep.x) * f, dy = (e.clientY - sleep.y) * f;
        if (Math.abs(dx) + Math.abs(dy) > 3) sleep.bewogen = true;
        vb[0] = sleep.vb[0] - dx; vb[1] = sleep.vb[1] - dy;
        zet();
      });
      function los() {
        if (sleep && sleep.bewogen) netGesleept = true;
        sleep = null;
      }
      svg.addEventListener('pointerup', los);
      svg.addEventListener('pointerleave', function () { sleep = null; });

      function toonOpnieuw(id) {
        lezer.innerHTML = '';
        var kop = el('div', 'moduletitel');
        kop.appendChild(el('p', 'kicker', cursus.title));
        kop.appendChild(el('h1', null, SCHERMEN.kaart));
        lezer.appendChild(kop);
        toonKaart(lezer, id);
      }

      /* Een verhaallijn afspelen: stap voor stap de verbanden, ingezoomd op
         zijn begrippen. */
      var lijnSpeler = null;
      function speelLijn(l) {
        if (lijnSpeler) lijnSpeler.stop();
        try { history.replaceState(null, '', '#kaart:lijn-' + l.nr); } catch (e) { /* bestand */ }
        Array.prototype.forEach.call(document.querySelectorAll('.lijn-chip'), function (c) { c.classList.toggle('actief', c.textContent === l.titel); });
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        l.ids.forEach(function (id) { var p = ind.pos[ind.index[id]]; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        var w = Math.max(380, maxX - minX + 200), h = Math.max(280, maxY - minY + 160);
        vb = [(minX + maxX) / 2 - w / 2, (minY + maxY) / 2 - h / 2, w, h];
        zet();
        detail.innerHTML = '';
        detail.appendChild(el('p', 'kicker', 'Verhaallijn'));
        detail.appendChild(el('h2', null, l.titel));
        detail.appendChild(el('p', 'kaart-hint', l.intro));
        var bijschrift = el('div', 'lijn-tekst');
        detail.appendChild(bijschrift);
        function toonStap(i) {
          svg.classList.add('gekozen');
          Object.keys(knoopPer).forEach(function (k) { knoopPer[k].classList.remove('actief', 'buur'); });
          lijnPer.forEach(function (x) { if (x) x.classList.remove('actief', 'nu'); });
          l.ids.forEach(function (id) { if (knoopPer[id]) knoopPer[id].classList.add('buur'); });
          bijschrift.innerHTML = '';
          for (var j = 0; j <= i; j++) {
            var v = verbanden[l.stappen[j]];
            if (lijnPer[l.stappen[j]]) lijnPer[l.stappen[j]].classList.add('actief');
            [v.a, v.b].forEach(function (id) { if (knoopPer[id]) knoopPer[id].classList.add('actief'); });
          }
          if (i < 0) { bijschrift.appendChild(el('p', 'herhaal-uitleg', 'Speel af of klik op Volgende.')); return; }
          var nu = verbanden[l.stappen[i]];
          if (lijnPer[l.stappen[i]]) lijnPer[l.stappen[i]].classList.add('nu');
          bijschrift.appendChild(el('p', 'verband-regel', verbandZin(nu)));
          bijschrift.appendChild(el('p', 'verband-uitleg', nu.uitleg));
        }
        lijnSpeler = stapSpeler({
          stappen: l.stappen, toon: toonStap,
          tekst: function (i) { var v = verbanden[l.stappen[i]]; return verbandZin(v) + ' ' + v.uitleg; }
        });
        detail.appendChild(lijnSpeler.balk);
        var sluit = el('button', 'tekstknop', 'Verhaallijn sluiten');
        sluit.type = 'button';
        sluit.addEventListener('click', function () { lijnSpeler.stop(); vb = ind.vak.slice(); zet(); Array.prototype.forEach.call(document.querySelectorAll('.lijn-chip'), function (c) { c.classList.remove('actief'); }); leegDetail(); });
        detail.appendChild(sluit);
        if (window.matchMedia('(max-width: 899px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      if (startLijn) speelLijn(startLijn);
      else if (gekozenId && knoopPer[gekozenId]) kies(gekozenId);
      else leegDetail();
    }

    /* ------------------------------------------------ oefencasussen */

    function toonCasussen(lezer, arg) {
      var wacht = el('p', 'scherm-intro', 'Casussen laden…');
      lezer.appendChild(wacht);
      laadCasussen().then(function (c) {
        wacht.remove();
        if (!c) { lezer.appendChild(el('p', 'scherm-intro', 'Er zijn geen oefencasussen beschikbaar.')); return; }
        var nr = parseInt(arg, 10);
        if (!isNaN(nr) && c.casussen[nr]) toonCasus(lezer, c, nr);
        else toonCasuslijst(lezer, c);
      });
    }

    function toonCasuslijst(lezer, c) {
      lezer.appendChild(el('p', 'scherm-intro', 'Lees een casus en markeer waar je begrippen uit de e-learnings herkent. Daarna vergelijk je met de begrippen die je had kunnen gebruiken, en kun je oefenvragen bekijken. De casussen gebruiken begrippen uit beide e-learnings.'));
      var lijst = el('div', 'modules casus-lijst');
      c.casussen.forEach(function (cs, i) {
        var st = staat().casussen[i] || {};
        var gemarkeerd = Object.keys(st.tags || {}).reduce(function (n, k) { return n + st.tags[k].length; }, 0);
        var kaart = el('button', 'module-kaart' + (st.vergeleken ? ' af' : (gemarkeerd ? ' bezig' : '')));
        kaart.type = 'button';
        kaart.appendChild(el('span', 'nummer', st.vergeleken ? '✓' : String(i + 1)));
        var midden = el('span');
        midden.appendChild(el('h2', null, cs.titel));
        midden.appendChild(el('span', 'regel', st.vergeleken ? 'Vergeleken' : (gemarkeerd ? gemarkeerd + ' begrippen gemarkeerd' : cs.fragmenten.length + ' stukken tekst om te herkennen')));
        kaart.appendChild(midden);
        kaart.appendChild(el('span', 'pijl', '→'));
        kaart.addEventListener('click', function () { toon('casussen', i); });
        lijst.appendChild(kaart);
      });
      lezer.appendChild(lijst);
    }

    function toonCasus(lezer, c, nr) {
      var cs = c.casussen[nr];
      var alle = staat().casussen;
      if (!alle[nr]) alle[nr] = { tags: {}, vergeleken: false };
      var st = alle[nr];
      var sleutel = function (t) { return t.cursus + '/' + t.id; };
      document.title = cs.titel + ' | ' + SCHERMEN.casussen;
      lezer.querySelector('h1').textContent = cs.titel;

      var uitleg = el('p', 'scherm-intro', st.vergeleken
        ? 'Hieronder zie je per stuk tekst welke begrippen verwacht werden. Groen: gevonden. Omlijnd: gemist. Grijs: jouw extra keuze, die kan ook kloppen als je hem kunt onderbouwen.'
        : 'Klik op een onderstreept stuk tekst en kies welk begrip je daarin herkent. Meer begrippen per stuk mag. Klaar? Klik dan op Vergelijken.');
      lezer.appendChild(uitleg);

      var tekstvak = el('div', 'casus-tekst');
      lezer.appendChild(tekstvak);
      var p = el('p');
      tekstvak.appendChild(p);
      var fragmentEl = {};
      cs.tekst.forEach(function (d) {
        if (d.alinea) { p = el('p'); tekstvak.appendChild(p); return; }
        if (d.f === undefined) { p.appendChild(document.createTextNode(d.t)); return; }
        var span = el('span', 'fragment');
        var knop = el('button', 'fragment-tekst', d.t);
        knop.type = 'button';
        if (st.vergeleken) knop.disabled = true;
        knop.addEventListener('click', function () { kiesVoor(d.f, span); });
        span.appendChild(knop);
        var labels = el('span', 'fragment-labels');
        span.appendChild(labels);
        p.appendChild(span);
        fragmentEl[d.f] = { span: span, labels: labels };
      });

      function tagNaam(k) { var x = c.pool[k]; return x ? x.b.naam : k; }
      function tekenLabels(f) {
        var vak = fragmentEl[f];
        if (!vak) return;
        vak.labels.innerHTML = '';
        var eigen = st.tags[f] || [];
        if (!st.vergeleken) {
          eigen.forEach(function (k) {
            var chip = el('span', 'chip eigen');
            chip.appendChild(document.createTextNode(tagNaam(k)));
            var weg = el('button', null, '×');
            weg.type = 'button';
            weg.setAttribute('aria-label', tagNaam(k) + ' weghalen');
            weg.addEventListener('click', function () {
              st.tags[f] = (st.tags[f] || []).filter(function (x) { return x !== k; });
              api.bewaar();
              tekenLabels(f);
            });
            chip.appendChild(weg);
            vak.labels.appendChild(chip);
          });
          vak.span.classList.toggle('heeft', eigen.length > 0);
          return;
        }
        var verwacht = cs.fragmenten[f].begrippen;
        var uitlegVak = el('span', 'fragment-uitleg');
        verwacht.forEach(function (t) {
          var k = sleutel(t);
          var gevonden = eigen.indexOf(k) >= 0;
          var chip = el('button', 'chip ' + (gevonden ? 'gevonden' : (t.sterk ? 'gemist' : 'mogelijk')), tagNaam(k));
          chip.type = 'button';
          var soort = gevonden ? 'Gevonden. ' : (t.sterk ? 'Verwacht. ' : 'Ook mogelijk. ');
          var x = c.pool[k];
          var waarom = t.waarom || (x ? x.b.def : '');
          chip.title = soort + waarom;
          chip.addEventListener('click', function () {
            var zelfde = uitlegVak.dataset.k === k && uitlegVak.textContent;
            uitlegVak.dataset.k = zelfde ? '' : k;
            uitlegVak.textContent = zelfde ? '' : tagNaam(k) + ' — ' + soort + waarom;
          });
          vak.labels.appendChild(chip);
        });
        eigen.forEach(function (k) {
          if (verwacht.some(function (t) { return sleutel(t) === k; })) return;
          vak.labels.appendChild(el('span', 'chip extra', tagNaam(k)));
        });
        vak.labels.appendChild(uitlegVak);
      }
      Object.keys(fragmentEl).forEach(function (f) { tekenLabels(Number(f)); });

      /* keuzevenster voor een begrip */
      var paneel = null;
      function sluitPaneel() { if (paneel) { paneel.remove(); paneel = null; } }
      function kiesVoor(f, anker) {
        sluitPaneel();
        paneel = el('div', 'kies-paneel');
        paneel.setAttribute('role', 'dialog');
        paneel.setAttribute('aria-label', 'Kies een begrip');
        var kop = el('div', 'kies-kop');
        kop.appendChild(el('strong', null, 'Welk begrip herken je hier?'));
        var dicht = el('button', 'tekstknop', 'Sluiten');
        dicht.type = 'button';
        dicht.addEventListener('click', sluitPaneel);
        kop.appendChild(dicht);
        paneel.appendChild(kop);
        var stuk = anker.querySelector('.fragment-tekst').textContent.trim();
        paneel.appendChild(el('p', 'casus-citaat', '“' + (stuk.length > 90 ? stuk.slice(0, 88) + '…' : stuk) + '”'));
        var zoek = el('input', 'zoekveld');
        zoek.type = 'search';
        zoek.placeholder = 'Typ om te zoeken';
        zoek.setAttribute('aria-label', 'Zoek een begrip');
        paneel.appendChild(zoek);
        var lijst = el('div', 'kies-lijst');
        paneel.appendChild(lijst);
        function norm(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
        function vul() {
          lijst.innerHTML = '';
          var q = norm(zoek.value.trim());
          var gekozen = st.tags[f] || [];
          Object.keys(c.pool).map(function (k) { return { k: k, x: c.pool[k] }; })
            .filter(function (o) { return !q || norm(o.x.b.naam + ' ' + (o.x.b.sub || '')).indexOf(q) >= 0; })
            .sort(function (a, b) { return a.x.b.naam.localeCompare(b.x.b.naam, 'nl'); })
            .forEach(function (o) {
              var k = el('button', 'kies-optie');
              k.type = 'button';
              k.setAttribute('aria-pressed', gekozen.indexOf(o.k) >= 0 ? 'true' : 'false');
              k.appendChild(el('span', null, o.x.b.naam));
              k.appendChild(el('small', null, KORT[o.x.cursus] || o.x.cursus));
              k.addEventListener('click', function () {
                var lijst2 = st.tags[f] || [];
                var plek = lijst2.indexOf(o.k);
                if (plek >= 0) lijst2.splice(plek, 1); else lijst2.push(o.k);
                st.tags[f] = lijst2;
                api.bewaar();
                tekenLabels(f);
                sluitPaneel();
              });
              lijst.appendChild(k);
            });
        }
        zoek.addEventListener('input', vul);
        vul();
        anker.appendChild(paneel);
        zoek.focus();
      }
      document.addEventListener('keydown', function opEsc(e) {
        if (!document.body.contains(tekstvak)) { document.removeEventListener('keydown', opEsc); return; }
        if (e.key === 'Escape') sluitPaneel();
      });

      var acties = el('div', 'vraag-acties casus-acties');
      lezer.appendChild(acties);
      var uitslag = el('div');
      lezer.appendChild(uitslag);

      function tekenUitslag() {
        uitslag.innerHTML = '';
        acties.innerHTML = '';
        if (!st.vergeleken) {
          var vergelijk = el('button', 'knop-klein', 'Vergelijken');
          vergelijk.type = 'button';
          vergelijk.addEventListener('click', function () {
            st.vergeleken = true;
            api.bewaar();
            toonCasusOpnieuw();
          });
          acties.appendChild(vergelijk);
          return;
        }
        var sterk = 0, raak = 0;
        cs.fragmenten.forEach(function (fr, f) {
          /* Vragen over de casus als geheel hebben geen stuk tekst om te markeren. */
          if (!fragmentEl[f]) return;
          var eigen = st.tags[f] || [];
          fr.begrippen.forEach(function (t) {
            if (!t.sterk) return;
            sterk++;
            if (eigen.indexOf(sleutel(t)) >= 0) raak++;
          });
        });
        var u = el('div', 'uitslag ' + (raak / Math.max(1, sterk) >= 0.5 ? 'goed' : 'fout'));
        u.textContent = 'Je vond ' + raak + ' van de ' + sterk + ' verwachte begrippen. Tik op een begrip voor de uitleg; de oefenvragen staan hieronder.';
        uitslag.appendChild(u);

        var vragen = cs.fragmenten.map(function (fr, f) { return { fr: fr, f: f }; }).filter(function (x) { return x.fr.vraag; });
        if (vragen.length) {
          uitslag.appendChild(el('h2', 'casus-vragen-kop', 'Oefenvragen'));
          vragen.forEach(function (x, n) {
            var v = el('div', 'vraag');
            v.appendChild(el('div', 'label', 'Oefenvraag ' + (n + 1)));
            var citaat = cs.tekst.filter(function (d) { return d.f === x.f; })[0];
            if (citaat) v.appendChild(el('p', 'casus-citaat', '“' + citaat.t.trim() + '”'));
            v.appendChild(el('div', 'stelling', x.fr.vraag));
            var toonKnop = el('button', 'knop-klein stil', 'Toon modelantwoord');
            toonKnop.type = 'button';
            var antwoord = el('div', 'uitslag goed', x.fr.antwoord);
            antwoord.hidden = true;
            toonKnop.addEventListener('click', function () { antwoord.hidden = !antwoord.hidden; toonKnop.textContent = antwoord.hidden ? 'Toon modelantwoord' : 'Verberg modelantwoord'; });
            v.appendChild(el('p', 'herhaal-uitleg', 'Denk eerst zelf na, of schrijf je antwoord op, voordat je het modelantwoord bekijkt.'));
            var rij = el('div', 'vraag-acties');
            rij.appendChild(toonKnop);
            v.appendChild(rij);
            v.appendChild(antwoord);
            uitslag.appendChild(v);
          });
        }
        var opnieuw = el('button', 'knop-klein stil', 'Opnieuw beginnen');
        opnieuw.type = 'button';
        opnieuw.addEventListener('click', function () {
          alle[nr] = { tags: {}, vergeleken: false };
          api.bewaar();
          toonCasusOpnieuw();
        });
        acties.appendChild(opnieuw);
        var lijstKnop = el('button', 'knop-klein stil', 'Andere casus');
        lijstKnop.type = 'button';
        lijstKnop.addEventListener('click', function () { toon('casussen'); });
        acties.appendChild(lijstKnop);
      }
      function toonCasusOpnieuw() {
        lezer.innerHTML = '';
        var kop = el('div', 'moduletitel');
        kop.appendChild(el('p', 'kicker', cursus.title));
        kop.appendChild(el('h1', null, cs.titel));
        lezer.appendChild(kop);
        toonCasus(lezer, c, nr);
        window.scrollTo(0, 0);
      }
      tekenUitslag();
    }

    return {
      segment: segment,
      tekenBlok: tekenBlok,
      herhaling: herhaling,
      hulpmiddelen: hulpmiddelen,
      kan: kan,
      toon: toon
    };
  }

  window.Verdieping = { start: start };
})();
