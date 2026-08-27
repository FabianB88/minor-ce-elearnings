#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Zet een Rise-cursus om naar een eigen module.

    python tools/build-module.py <rise-course.json> <slug> [patches.json]

De Rise-export bewaart de hele cursus als base64-JSON in scormcontent/index.html.
Dit script leest die JSON (of een los JSON-bestand), vertaalt de blokken naar een
eigen, kleiner formaat en kopieert het beeldmateriaal mee.

Het resultaat staat in modules/<slug>/ en is verder onafhankelijk van Articulate.
"""

from __future__ import print_function

import base64
import io
import json
import os
import re
import shutil
import sys
import urllib.parse

HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- HTML opschonen

def uit_editor(html):
    """Rise verpakt elk stuk tekst in <div data-editor-id="...">. Die schil weg."""
    if not html:
        return ''
    s = html.strip()
    s = re.sub(r'^<div[^>]*data-editor-id="[^"]*"[^>]*>', '', s)
    s = re.sub(r'</div>$', '', s.strip())
    return s.strip()


def schoon(html):
    """Attributen weghalen die alleen voor de Rise-editor bedoeld waren."""
    if not html:
        return ''
    s = uit_editor(html)
    s = re.sub(r'\sdata-editor-id="[^"]*"', '', s)
    s = re.sub(r'<br class="break-when-trailing">', '', s)
    # Rise zet inline lettergroottes neer die ons eigen ontwerp doorbreken.
    s = re.sub(r'\sstyle="font-size:[^"]*"', '', s)
    s = re.sub(r'<span>\s*</span>', '', s)
    s = re.sub(r'<p>(\s|&nbsp;)*</p>', '', s)
    return s.strip()


def plat(html):
    """Alleen de tekst, voor titels."""
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html or '')).strip()


# ---------------------------------------------------------------- blokken

def youtube_uit(embed):
    """Video-id en starttijd uit een embedly-url peuteren."""
    src = urllib.parse.unquote(embed.get('src') or '')
    orig = embed.get('originalUrl') or ''
    vid = None
    m = re.search(r'youtube\.com/embed/([A-Za-z0-9_-]{11})', src)
    if m:
        vid = m.group(1)
    if not vid:
        m = re.search(r'[?&]v=([A-Za-z0-9_-]{11})', urllib.parse.unquote(orig))
        if m:
            vid = m.group(1)
    if not vid:
        m = re.search(r'youtu\.be/([A-Za-z0-9_-]{11})', orig)
        if m:
            vid = m.group(1)
    start = 0
    m = re.search(r'[?&]start=(\d+)', src)
    if m:
        start = int(m.group(1))
    else:
        m = re.search(r'[?&]t=(\d+)s?', urllib.parse.unquote(orig).replace('&amp;', '&'))
        if m:
            start = int(m.group(1))
    return vid, start


def vertaal(blok, media_uit):
    fam = blok.get('family')
    var = blok.get('variant')
    items = blok.get('items') or []

    if fam == 'continue':
        return {'t': 'continue'}

    if fam == 'text':
        eerste = items[0] if items else {}
        uit = {'t': 'text'}
        kop = schoon(eerste.get('heading'))
        if kop:
            uit['heading'] = plat(kop)
        lijf = schoon(eerste.get('paragraph'))
        if lijf:
            uit['body'] = lijf
        return uit if (uit.get('heading') or uit.get('body')) else None

    if fam == 'list':
        regels = [schoon(i.get('paragraph')) for i in items]
        regels = [r for r in regels if plat(r)]
        if not regels:
            return None
        return {'t': 'list', 'ordered': var == 'numbered', 'items': regels}

    if fam == 'image':
        eerste = items[0] if items else {}
        img = ((eerste.get('media') or {}).get('image')) or {}
        sleutel = img.get('crushedKey') or img.get('key') or ''
        bestand = urllib.parse.unquote(os.path.basename(sleutel))
        if not bestand:
            return None
        media_uit.add(bestand)
        uit = {'t': 'image', 'src': 'media/' + bestand}
        maat = img.get('dimensions') or {}
        if maat.get('originalWidth'):
            uit['w'] = maat['originalWidth']
            uit['h'] = maat['originalHeight']
        bijschrift = plat(schoon(eerste.get('caption')))
        if bijschrift:
            uit['caption'] = bijschrift
        return uit

    if fam == 'multimedia':
        eerste = items[0] if items else {}
        embed = ((eerste.get('media') or {}).get('embed')) or {}
        vid, start = youtube_uit(embed)
        if not vid:
            return None
        uit = {'t': 'video', 'youtube': vid, 'title': embed.get('title') or 'Video'}
        if start:
            uit['start'] = start
        return uit

    if fam == 'interactive' and var == 'tabs':
        tabs = []
        for i in items:
            tabs.append({
                'title': plat(i.get('title')) or 'Tab',
                'body': schoon(i.get('description'))
            })
        return {'t': 'tabs', 'items': tabs} if tabs else None

    if fam == 'knowledgeCheck':
        eerste = items[0] if items else {}
        soort = (eerste.get('type') or '').upper()
        vraag = schoon(eerste.get('title'))
        antwoorden = eerste.get('answers') or []
        terugkoppeling = plat(schoon(eerste.get('feedback'))) or ''

        if soort == 'MATCHING':
            paren = []
            for a in antwoorden:
                links = plat(a.get('title'))
                rechts = plat(a.get('matchTitle'))
                if links and rechts:
                    paren.append({'left': links, 'right': rechts})
            if not paren:
                return None
            return {'t': 'match', 'question': vraag, 'pairs': paren, 'feedback': terugkoppeling}

        opties = []
        for a in antwoorden:
            tekst = plat(schoon(a.get('title')))
            if tekst:
                opties.append({'text': tekst, 'correct': bool(a.get('correct'))})
        if not opties:
            return None
        return {
            't': 'quiz',
            'multi': soort == 'MULTIPLE_RESPONSE',
            'question': vraag,
            'options': opties,
            'feedback': terugkoppeling
        }

    return None


# ---------------------------------------------------------------- deadline uit titel

def splits_titel(titel):
    """"Organisaties & Macht - Afronden voor 5 oktober (uiterlijk)" uit elkaar halen."""
    t = re.sub(r'\s+', ' ', (titel or '').strip())
    m = re.search(r'\s*[-–]?\s*Afronden\s+v[oó]{1,2}r\s+(.+?)\s*(?:\(uiterlijk\))?\s*$', t, re.I)
    if m:
        return t[:m.start()].strip(' -–'), m.group(1).strip()
    return t, ''


# ---------------------------------------------------------------- hoofdprogramma

def lees_rise(pad):
    if pad.lower().endswith('.html'):
        s = io.open(pad, encoding='utf-8', errors='ignore').read()
        m = max(re.finditer(r'"[^"]{4000,}"', s), key=lambda x: len(x.group(0)))
        return json.loads(base64.b64decode(m.group(0)[1:-1]).decode('utf-8'))
    return json.load(io.open(pad, encoding='utf-8'))


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)

    bron, slug = sys.argv[1], sys.argv[2]
    patchpad = sys.argv[3] if len(sys.argv) > 3 else None

    ruw = lees_rise(bron)
    cursus = ruw.get('course', ruw)

    patches = json.load(io.open(patchpad, encoding='utf-8')) if patchpad else {}

    doel = os.path.join(HIER, 'modules', slug)
    mediamap = os.path.join(doel, 'media')
    if os.path.isdir(doel):
        shutil.rmtree(doel)
    os.makedirs(mediamap)

    media_uit = set()
    lessen = []
    overgeslagen = {}

    for i, les in enumerate(cursus.get('lessons') or []):
        blokken_ruw = list(les.get('items') or [])

        p = (patches.get('lessons') or {}).get(str(i)) or {}
        # Van achter naar voren, anders verschuiven de nog te verwerken posities.
        for weg in sorted(p.get('remove') or [], reverse=True):
            del blokken_ruw[weg]
        for verv in sorted(p.get('replace') or [], key=lambda v: -v['range'][0]):
            reeks = verv['range']
            blokken_ruw[reeks[0]:reeks[1]] = verv['with']

        blokken = []
        for b in blokken_ruw:
            v = vertaal(b, media_uit)
            if v:
                blokken.append(v)
            else:
                sleutel = '%s/%s' % (b.get('family'), b.get('variant'))
                overgeslagen[sleutel] = overgeslagen.get(sleutel, 0) + 1

        # Twee opeenvolgende doorgaan-knoppen, of eentje aan het eind, hebben geen zin.
        opgeschoond = []
        for b in blokken:
            if b['t'] == 'continue' and (not opgeschoond or opgeschoond[-1]['t'] == 'continue'):
                continue
            opgeschoond.append(b)
        while opgeschoond and opgeschoond[-1]['t'] == 'continue':
            opgeschoond.pop()

        titel_ruw = (p.get('title') or les.get('title') or ('Module %d' % (i + 1)))
        titel, deadline = splits_titel(titel_ruw)
        lessen.append({
            'id': 'm%d' % (i + 1),
            'title': titel,
            'deadline': deadline,
            'blocks': opgeschoond
        })

    # beeldmateriaal meenemen
    assetmap = patches.get('assets') or os.path.join(
        HIER, 'courses', slug, 'scormcontent', 'assets')
    gekopieerd = 0
    for naam in sorted(media_uit):
        bron_best = os.path.join(assetmap, naam)
        if os.path.isfile(bron_best):
            shutil.copy2(bron_best, os.path.join(mediamap, naam))
            gekopieerd += 1
        else:
            print('  LET OP: afbeelding niet gevonden: %s' % naam)

    uit = {
        'id': slug,
        'title': patches.get('title') or plat(cursus.get('title')) or slug,
        'subtitle': patches.get('subtitle', ''),
        'author': patches.get('author', ''),
        'intro': patches.get('intro', ''),
        'lessons': lessen
    }
    with io.open(os.path.join(doel, 'course.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(uit, indent=2, ensure_ascii=False) + u'\n')

    print('Module gebouwd: %s' % uit['title'])
    print('  map        : modules/%s/' % slug)
    print('  afbeeldingen: %d' % gekopieerd)
    print('')
    for l in lessen:
        soorten = {}
        for b in l['blocks']:
            soorten[b['t']] = soorten.get(b['t'], 0) + 1
        print('  %-42s %2d blokken  %s' % (
            l['title'][:40], len(l['blocks']),
            ' '.join('%s:%d' % kv for kv in sorted(soorten.items()))))
    if overgeslagen:
        print('')
        print('  overgeslagen blokken:', overgeslagen)


if __name__ == '__main__':
    main()
