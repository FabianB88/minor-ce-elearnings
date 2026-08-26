/*
 * SCORM 1.2 Run-Time API voor statische hosting.
 *
 * SCORM-inhoud zoekt bij het opstarten een object dat "API" heet, omhoog via
 * window.parent en window.opener. Zet dit script op de pagina die de inhoud in
 * een iframe laadt, en de inhoud vindt het vanzelf.
 *
 * Alle gegevens gaan naar localStorage, per cursus. Er is geen server, dus er
 * is ook geen centrale registratie: voortgang leeft in de browser van deze ene
 * student. Dat is een bewuste keuze, geen tekortkoming van deze implementatie.
 *
 * Gebruik:
 *   var api = SCORM12.install({ courseId: 'business-ethics' });
 *   // ... iframe laden ...
 *   api.onChange = function (cmi) { ... };
 */
(function (global) {
  'use strict';

  var FOUTEN = {
    '0': 'No error',
    '101': 'General exception',
    '201': 'Invalid argument error',
    '202': 'Element cannot have children',
    '203': 'Element not an array - cannot have count',
    '301': 'Not initialized',
    '401': 'Not implemented error',
    '402': 'Invalid set value, element is a keyword',
    '403': 'Element is read only',
    '404': 'Element is write only',
    '405': 'Incorrect data type'
  };

  /* Elementen die de inhoud wel mag lezen maar niet mag schrijven. */
  var ALLEEN_LEZEN = [
    'cmi._version',
    'cmi.core.student_id',
    'cmi.core.student_name',
    'cmi.core.credit',
    'cmi.core.entry',
    'cmi.core.lesson_mode',
    'cmi.core.total_time',
    'cmi.launch_data',
    'cmi.comments_from_lms',
    'cmi.student_data.mastery_score',
    'cmi.student_data.max_time_allowed',
    'cmi.student_data.time_limit_action'
  ];

  /* Elementen die de inhoud wel mag schrijven maar niet mag lezen. */
  var ALLEEN_SCHRIJVEN = [
    'cmi.core.exit',
    'cmi.core.session_time'
  ];

  /* Vaste antwoorden op ..._children vragen. */
  var KINDEREN = {
    'cmi.core._children': 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time',
    'cmi.core.score._children': 'raw,min,max',
    'cmi.objectives._children': 'id,score,status',
    'cmi.objectives.n.score._children': 'raw,min,max',
    'cmi.interactions._children': 'id,objectives,time,type,correct_responses,weighting,student_response,result,latency',
    'cmi.student_data._children': 'mastery_score,max_time_allowed,time_limit_action',
    'cmi.student_preference._children': 'audio,language,speed,text'
  };

  var GELDIGE_STATUS = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];

  function standaardModel(leerling) {
    return {
      'cmi._version': '3.4',
      'cmi.core.student_id': leerling.id,
      'cmi.core.student_name': leerling.name,
      'cmi.core.lesson_location': '',
      'cmi.core.credit': 'credit',
      'cmi.core.lesson_status': 'not attempted',
      'cmi.core.entry': 'ab-initio',
      'cmi.core.score.raw': '',
      'cmi.core.score.min': '',
      'cmi.core.score.max': '',
      'cmi.core.total_time': '0000:00:00.00',
      'cmi.core.lesson_mode': 'normal',
      'cmi.suspend_data': '',
      'cmi.launch_data': '',
      'cmi.comments': '',
      'cmi.comments_from_lms': '',
      'cmi.student_data.mastery_score': '',
      'cmi.student_data.max_time_allowed': '',
      'cmi.student_data.time_limit_action': '',
      'cmi.student_preference.audio': '0',
      'cmi.student_preference.language': '',
      'cmi.student_preference.speed': '0',
      'cmi.student_preference.text': '0',
      'cmi.objectives._count': '0',
      'cmi.interactions._count': '0'
    };
  }

  /* ---------- tijd ---------- */

  /* CMITimespan (HHHH:MM:SS.SS) naar seconden. */
  function naarSeconden(t) {
    var m = /^(\d{1,4}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,2}))?$/.exec(String(t || '').trim());
    if (!m) return 0;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? parseFloat('0.' + m[4]) : 0);
  }

  function vul(n, lengte) {
    var s = String(Math.floor(n));
    while (s.length < lengte) s = '0' + s;
    return s;
  }

  /* Seconden naar CMITimespan. */
  function naarTijdreeks(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var u = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var honderdsten = Math.round((s - Math.floor(s)) * 100);
    if (honderdsten === 100) { honderdsten = 0; s += 1; }
    return vul(u, 4) + ':' + vul(m, 2) + ':' + vul(s, 2) + '.' + vul(honderdsten, 2);
  }

  /* ---------- opslag ---------- */

  function sleutel(courseId) {
    return 'scorm12:' + courseId;
  }

  function lees(courseId) {
    try {
      var ruw = global.localStorage.getItem(sleutel(courseId));
      return ruw ? JSON.parse(ruw) : null;
    } catch (e) {
      return null;
    }
  }

  function schrijf(courseId, cmi) {
    try {
      global.localStorage.setItem(sleutel(courseId), JSON.stringify(cmi));
      return true;
    } catch (e) {
      /* Quota vol of privacymodus. De cursus draait door, alleen zonder bewaren. */
      return false;
    }
  }

  function wis(courseId) {
    try {
      global.localStorage.removeItem(sleutel(courseId));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Een stabiele, lokale student-id. Zonder inlog is dit het beste dat kan:
     het onderscheidt browsers, geen personen. */
  function leerlingIdentiteit() {
    var k = 'scorm12:leerling';
    var opgeslagen;
    try { opgeslagen = JSON.parse(global.localStorage.getItem(k) || 'null'); } catch (e) { opgeslagen = null; }
    if (opgeslagen && opgeslagen.id) return opgeslagen;
    var nieuw = {
      id: 'local-' + Math.random().toString(36).slice(2, 10),
      name: 'Student'
    };
    try { global.localStorage.setItem(k, JSON.stringify(nieuw)); } catch (e) { /* niets */ }
    return nieuw;
  }

  /* ---------- de API zelf ---------- */

  function maakAPI(opties) {
    var courseId = opties.courseId;
    var leerling = opties.learner || leerlingIdentiteit();

    var opgeslagen = lees(courseId);
    var cmi = standaardModel(leerling);
    var hervat = false;

    if (opgeslagen) {
      for (var k in opgeslagen) {
        if (Object.prototype.hasOwnProperty.call(opgeslagen, k)) cmi[k] = opgeslagen[k];
      }
      hervat = true;
    }
    /* Identiteit altijd vers, ook bij hervatten. */
    cmi['cmi.core.student_id'] = leerling.id;
    cmi['cmi.core.student_name'] = leerling.name;
    cmi['cmi.core.entry'] = hervat ? 'resume' : 'ab-initio';

    var gestart = false;
    var afgesloten = false;
    var laatsteFout = '0';
    var sessieStart = 0;

    var api = {};

    function fout(code) {
      laatsteFout = String(code);
      return 'false';
    }

    function goed() {
      laatsteFout = '0';
      return 'true';
    }

    function meld() {
      if (typeof api.onChange === 'function') {
        try { api.onChange(kopie()); } catch (e) { /* niets */ }
      }
    }

    function kopie() {
      var uit = {};
      for (var k in cmi) if (Object.prototype.hasOwnProperty.call(cmi, k)) uit[k] = cmi[k];
      return uit;
    }

    function isArrayElement(el) {
      return /^cmi\.(objectives|interactions)\.\d+\./.test(el);
    }

    /* cmi.objectives.3.id -> cmi.objectives.n.id, voor het opzoeken van _children */
    function normaliseer(el) {
      return el.replace(/\.\d+\./g, '.n.');
    }

    function werkTellingBij(el) {
      var m = /^cmi\.(objectives|interactions)\.(\d+)\./.exec(el);
      if (!m) return;
      var telSleutel = 'cmi.' + m[1] + '._count';
      var index = parseInt(m[2], 10);
      var huidig = parseInt(cmi[telSleutel] || '0', 10);
      if (index + 1 > huidig) cmi[telSleutel] = String(index + 1);
    }

    api.LMSInitialize = function (param) {
      if (param !== '' && param !== undefined && param !== null) return fout(201);
      if (gestart) return fout(101);
      if (afgesloten) return fout(101);
      gestart = true;
      sessieStart = Date.now();
      /* Een gestarte poging is minimaal "incomplete", nooit meer "not attempted". */
      if (cmi['cmi.core.lesson_status'] === 'not attempted') {
        cmi['cmi.core.lesson_status'] = 'incomplete';
      }
      meld();
      return goed();
    };

    api.LMSGetValue = function (element) {
      if (!gestart || afgesloten) return (fout(301), '');
      if (typeof element !== 'string' || element === '') return (fout(201), '');

      var genormaliseerd = normaliseer(element);

      if (Object.prototype.hasOwnProperty.call(KINDEREN, genormaliseerd)) {
        laatsteFout = '0';
        return KINDEREN[genormaliseerd];
      }
      if (/_children$/.test(element)) return (fout(202), '');

      if (ALLEEN_SCHRIJVEN.indexOf(element) !== -1) return (fout(404), '');

      if (/_count$/.test(element)) {
        if (!Object.prototype.hasOwnProperty.call(cmi, element)) return (fout(203), '');
        laatsteFout = '0';
        return cmi[element];
      }

      if (Object.prototype.hasOwnProperty.call(cmi, element)) {
        laatsteFout = '0';
        return cmi[element];
      }

      /* Onbekend array-element dat nog niet geschreven is: lege string, geen fout.
         Strikt genomen is dat 401, maar inhoud struikelt daar vaak over. */
      if (isArrayElement(element)) {
        laatsteFout = '0';
        return '';
      }

      return (fout(401), '');
    };

    api.LMSSetValue = function (element, waarde) {
      if (!gestart || afgesloten) return fout(301);
      if (typeof element !== 'string' || element === '') return fout(201);

      waarde = waarde === undefined || waarde === null ? '' : String(waarde);

      if (/_children$/.test(element) || /_count$/.test(element)) return fout(402);
      if (ALLEEN_LEZEN.indexOf(element) !== -1) return fout(403);

      if (element === 'cmi.core.lesson_status' && GELDIGE_STATUS.indexOf(waarde) === -1) {
        return fout(405);
      }
      if (element === 'cmi.core.session_time' && naarSeconden(waarde) === 0 && !/^\d{1,4}:\d{2}:\d{2}/.test(waarde)) {
        return fout(405);
      }

      var bekend = Object.prototype.hasOwnProperty.call(cmi, element);
      if (!bekend && !isArrayElement(element) && ALLEEN_SCHRIJVEN.indexOf(element) === -1) {
        return fout(401);
      }

      cmi[element] = waarde;
      werkTellingBij(element);
      meld();
      return goed();
    };

    api.LMSCommit = function (param) {
      if (param !== '' && param !== undefined && param !== null) return fout(201);
      if (!gestart || afgesloten) return fout(301);
      return schrijf(courseId, kopie()) ? goed() : fout(101);
    };

    api.LMSFinish = function (param) {
      if (param !== '' && param !== undefined && param !== null) return fout(201);
      if (!gestart || afgesloten) return fout(301);

      /* Sessietijd optellen bij de totaaltijd. Heeft de inhoud zelf geen
         session_time gezet, dan meten we hem zelf. */
      var sessie = cmi['cmi.core.session_time']
        ? naarSeconden(cmi['cmi.core.session_time'])
        : (Date.now() - sessieStart) / 1000;
      cmi['cmi.core.total_time'] = naarTijdreeks(naarSeconden(cmi['cmi.core.total_time']) + sessie);
      delete cmi['cmi.core.session_time'];

      /* Bij "suspend" willen we volgende keer hervatten. */
      cmi['cmi.core.entry'] = cmi['cmi.core.exit'] === 'suspend' ? 'resume' : '';

      schrijf(courseId, kopie());
      afgesloten = true;
      gestart = false;
      meld();
      laatsteFout = '0';
      return 'true';
    };

    api.LMSGetLastError = function () {
      return laatsteFout;
    };

    api.LMSGetErrorString = function (code) {
      return FOUTEN[String(code)] || '';
    };

    api.LMSGetDiagnostic = function (code) {
      var c = String(code === undefined || code === '' ? laatsteFout : code);
      return FOUTEN[c] ? c + ': ' + FOUTEN[c] : c;
    };

    /* ---------- buiten de SCORM-standaard, voor de speler zelf ---------- */

    api.getState = kopie;
    api.getCourseId = function () { return courseId; };
    api.isRunning = function () { return gestart; };
    api.onChange = null;

    return api;
  }

  /* ---------- publiek ---------- */

  var SCORM12 = {
    /* Zet window.API klaar zodat de inhoud in het iframe hem vindt. */
    install: function (opties) {
      var api = maakAPI(opties || {});
      global.API = api;
      return api;
    },

    /* Voortgang van een cursus, zonder de API te starten. Voor het overzicht. */
    progress: function (courseId) {
      var cmi = lees(courseId);
      if (!cmi) return { status: 'not attempted', bookmark: '', totalTime: '0000:00:00.00', score: '' };
      return {
        status: cmi['cmi.core.lesson_status'] || 'not attempted',
        bookmark: cmi['cmi.core.lesson_location'] || '',
        totalTime: cmi['cmi.core.total_time'] || '0000:00:00.00',
        score: cmi['cmi.core.score.raw'] || ''
      };
    },

    reset: function (courseId) { return wis(courseId); },
    learner: leerlingIdentiteit,

    setLearner: function (identiteit) {
      try { global.localStorage.setItem('scorm12:leerling', JSON.stringify(identiteit)); } catch (e) { /* niets */ }
      return identiteit;
    },

    /* Hulpmiddelen, ook handig in tests. */
    timeToSeconds: naarSeconden,
    secondsToTime: naarTijdreeks
  };

  global.SCORM12 = SCORM12;
})(window);
