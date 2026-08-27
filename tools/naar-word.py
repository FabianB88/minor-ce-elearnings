#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Zet een module om naar een leesbaar documentmodel voor Word.

    python tools/naar-word.py <slug>

Schrijft tools/_docmodel.json. Het bijbehorende Node-script maakt daar het
.docx van. De splitsing houdt het HTML-ontleden in Python en de Word-opmaak
in JavaScript, waar de docx-bibliotheek zit.
"""

from __future__ import print_function

import html as htmlmod
import io
import json
import os
import re
import sys
from html.parser import HTMLParser

HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Ontleder(HTMLParser):
    """Zet een stukje HTML om naar alinea's met vet/cursief-stukken."""

    BLOK = {'p', 'h1', 'h2', 'h3', 'h4', 'li'}

    def __init__(self):
        super().__init__()
        self.uit = []
        self.runs = []
        self.soort = 'para'
        self.vet = 0
        self.cursief = 0
        self.lijst = []
        self.in_li = 0

    def _sluit(self):
        runs = [r for r in self.runs if r['text'].strip() or r['text'] == ' ']
        if runs:
            soort = self.soort
            # Rise zet de tekst van een opsommingspunt vaak in een <p> binnen de
            # <li>. Zonder deze regel wordt zo'n punt een gewone alinea.
            if self.in_li and soort == 'para':
                soort = 'bullet' if (self.lijst and self.lijst[-1] == 'ul') else 'nummer'
            self.uit.append({'type': soort, 'runs': runs})
        self.runs = []
        self.soort = 'para'

    def handle_starttag(self, tag, attrs):
        if tag in ('strong', 'b'):
            self.vet += 1
        elif tag in ('em', 'i'):
            self.cursief += 1
        elif tag in ('ul', 'ol'):
            self.lijst.append(tag)
        elif tag in self.BLOK:
            self._sluit()
            if tag == 'li':
                self.in_li += 1
                self.soort = 'bullet' if (self.lijst and self.lijst[-1] == 'ul') else 'nummer'
            elif tag in ('h1', 'h2', 'h3', 'h4'):
                self.soort = 'kop3'

    def handle_endtag(self, tag):
        if tag in ('strong', 'b'):
            self.vet = max(0, self.vet - 1)
        elif tag in ('em', 'i'):
            self.cursief = max(0, self.cursief - 1)
        elif tag in ('ul', 'ol'):
            if self.lijst:
                self.lijst.pop()
        elif tag in self.BLOK:
            self._sluit()
            if tag == 'li':
                self.in_li = max(0, self.in_li - 1)

    def handle_data(self, data):
        t = re.sub(r'\s+', ' ', data)
        if not t:
            return
        self.runs.append({'text': t, 'vet': self.vet > 0, 'cursief': self.cursief > 0})

    def klaar(self):
        self._sluit()
        return self.uit


def ontleed(h):
    if not h:
        return []
    p = Ontleder()
    p.feed(h)
    return p.klaar()


def plat(h):
    return re.sub(r'\s+', ' ', htmlmod.unescape(re.sub(r'<[^>]+>', ' ', h or ''))).strip()


# De drie schema's kunnen niet als tekening mee; ze worden een tabel met
# dezelfde inhoud, zodat de lezer niets mist.
SCHEMA_TABELLEN = {
    'Drie kenmerken van infrastructuur': [
        ['Kenmerk', 'Wat het betekent'],
        ['1. Maakt mogelijk', 'Zonder haar kan de activiteit niet plaatsvinden: goederen, energie, geld, informatie.'],
        ['2. Werkt op schaal', 'Ze bedient iedereen tegelijk en valt daardoor pas op wanneer ze het begeeft.'],
        ['3. Legt vast', 'Standaarden en afhankelijkheden waar anderen zich naar moeten voegen. Hier zit de macht: wie de standaard bepaalt, bepaalt de voorwaarden voor alle anderen.'],
    ],
    'Vier vormen van greenwashing': [
        ['Vorm', 'Voorbeeld', 'Waar de misleiding zit'],
        ['Selectief', 'Eén goed initiatief breed uitmeten, de rest buiten beeld laten.', 'De rest van het verhaal bestaat wél.'],
        ['Vaag', '‘Groen’, ‘natuurlijk’, ‘eco-friendly’ zonder definitie of maatstaf.', 'Niets onwaars, niets controleerbaars.'],
        ['Irrelevant', '‘CFK-vrij’ voor een stof die al jaren verboden is.', 'Waar, maar zonder betekenis.'],
        ['Symbolisch', 'Een klein gebaar met weinig effect, zwaar aangezet in de communicatie.', 'Te klein om ertoe te doen.'],
    ],
    'Van aandeelhouders- naar stakeholdersmodel': [
        ['Positie', 'Hoe zeggenschap wordt gerechtvaardigd'],
        ['Aandeelhoudersmodel', 'Zeggenschap volgt kapitaal. Wie het geld inbrengt beslist; andere belangen tellen mee voor zover ze het rendement dienen.'],
        ['In de praktijk ertussenin', 'De meeste ondernemingen zitten hier: formeel het ene model, feitelijk met meerdere afhankelijkheden.'],
        ['Stakeholdersmodel', 'Zeggenschap volgt inzet. Werknemers, leveranciers en gemeenschappen doen specifieke investeringen en dragen dus ook risico.'],
    ],
}


def schema_tabel(blok):
    kop = (blok.get('caption') or '').split('.')[0]
    for naam, tabel in SCHEMA_TABELLEN.items():
        eerste = tabel[1][0].split('.')[-1].strip().lower()
        if eerste[:12] in (blok.get('alt') or '').lower() or naam.lower()[:14] in (blok.get('alt') or '').lower():
            return naam, tabel
    # terugval op de alt-tekst
    return kop or 'Schema', [['Toelichting'], [blok.get('alt') or '']]


def bouw(slug):
    pad = os.path.join(HIER, 'modules', slug, 'course.json')
    c = json.load(io.open(pad, encoding='utf-8'))

    doc = {
        'titel': c['title'],
        'ondertitel': c.get('subtitle', ''),
        'auteur': c.get('author', ''),
        'intro': c.get('intro', ''),
        'overzicht': [{'nr': i + 1, 'titel': l['title'], 'deadline': l.get('deadline', ''),
                       'vragen': len([b for b in l['blocks'] if b['t'] in ('quiz', 'match')]),
                       'stappen': len([b for b in l['blocks'] if b['t'] == 'continue']) + 1}
                      for i, l in enumerate(c['lessons'])],
        'modules': []
    }

    for i, les in enumerate(c['lessons'], 1):
        mod = {'nr': i, 'titel': les['title'], 'deadline': les.get('deadline', ''), 'elementen': []}
        E = mod['elementen']

        for b in les['blocks']:
            t = b['t']

            if t == 'continue':
                E.append({'type': 'scheiding'})

            elif t == 'text':
                if b.get('heading'):
                    E.append({'type': 'kop2', 'tekst': b['heading']})
                E.extend(ontleed(b.get('body')))

            elif t == 'list':
                for it in b['items']:
                    for e in ontleed(it):
                        e['type'] = 'nummer' if b.get('ordered') else 'bullet'
                        E.append(e)

            elif t == 'image':
                E.append({'type': 'beeld',
                          'pad': os.path.join(HIER, 'modules', slug, b['src'].replace('/', os.sep)),
                          'bijschrift': b.get('caption', '')})

            elif t == 'video':
                E.append({'type': 'video', 'titel': b.get('title', 'Video'),
                          'url': 'https://www.youtube.com/watch?v=' + b['youtube']
                                 + ('&t=%ds' % b['start'] if b.get('start') else '')})

            elif t == 'tabs':
                E.append({'type': 'kop3', 'tekst': 'Tabbladen in de e-learning'})
                for tab in b['items']:
                    E.append({'type': 'kop4', 'tekst': tab['title']})
                    E.extend(ontleed(tab['body']))

            elif t == 'svg':
                naam, tabel = schema_tabel(b)
                E.append({'type': 'tabel', 'titel': naam, 'rijen': tabel,
                          'bijschrift': b.get('caption', '')})

            elif t in ('quiz', 'match'):
                v = {'type': 'vraag', 'vraag': plat(b.get('question')),
                     'feedback': b.get('feedback', '')}
                if t == 'match':
                    v['soort'] = 'Koppelvraag'
                    v['paren'] = [[p['left'], p['right']] for p in b['pairs']]
                else:
                    v['soort'] = 'Meerdere antwoorden juist' if b.get('multi') else 'Kennisvraag'
                    v['opties'] = [{'tekst': o['text'], 'goed': o['correct']} for o in b['options']]
                E.append(v)

        doc['modules'].append(mod)

    uit = os.path.join(HIER, 'tools', '_docmodel.json')
    with io.open(uit, 'w', encoding='utf-8') as f:
        f.write(json.dumps(doc, ensure_ascii=False, indent=1))

    n = sum(len(m['elementen']) for m in doc['modules'])
    print('documentmodel: %d modules, %d elementen -> %s' % (len(doc['modules']), n, uit))
    return uit


if __name__ == '__main__':
    bouw(sys.argv[1] if len(sys.argv) > 1 else 'business-ethics')
