#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Voegt een SCORM-pakket toe aan de e-learningsite.

    python tools/add-course.py <pakket.zip> [slug]

Het script pakt het pakket uit in courses/<slug>/, leest de titel en het
startbestand uit imsmanifest.xml, en zet de cursus in courses.json.
Bestaat de slug al, dan wordt hij bijgewerkt.
"""

from __future__ import print_function

import io
import json
import os
import re
import shutil
import sys
import unicodedata
import zipfile

HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURSUSSEN = os.path.join(HIER, 'courses')
REGISTER = os.path.join(HIER, 'courses.json')


def slugify(tekst):
    t = unicodedata.normalize('NFKD', tekst)
    t = t.encode('ascii', 'ignore').decode('ascii').lower()
    t = re.sub(r'[^a-z0-9]+', '-', t).strip('-')
    return t or 'cursus'


def lees_manifest(zf):
    """Titel en startbestand uit imsmanifest.xml halen."""
    namen = [n for n in zf.namelist() if n.endswith('imsmanifest.xml')]
    if not namen:
        raise SystemExit('Geen imsmanifest.xml in het pakket. Is dit wel een SCORM-export?')
    # Het manifest in de wortel wint van eentje dieper in een submap.
    namen.sort(key=lambda n: n.count('/'))
    manifest = namen[0]
    voorvoegsel = manifest[:-len('imsmanifest.xml')]
    xml = zf.read(manifest).decode('utf-8', 'ignore')

    titel = ''
    m = re.search(r'<organization\b[^>]*>.*?<title>(.*?)</title>', xml, re.S)
    if not m:
        m = re.search(r'<title>(.*?)</title>', xml, re.S)
    if m:
        titel = re.sub(r'<[^>]+>', '', m.group(1)).strip()

    # Het startbestand is de resource met scormtype "sco"; anders de eerste met href.
    href = ''
    for res in re.finditer(r'<resource\b([^>]*)>', xml):
        attrs = res.group(1)
        h = re.search(r'href="([^"]+)"', attrs)
        if not h:
            continue
        if re.search(r'scormtype="sco"', attrs, re.I):
            href = h.group(1)
            break
        if not href:
            href = h.group(1)

    if not href:
        raise SystemExit('Geen startbestand (href) gevonden in het manifest.')

    versie = ''
    v = re.search(r'<schemaversion>(.*?)</schemaversion>', xml, re.S)
    if v:
        versie = v.group(1).strip()

    return titel, voorvoegsel, href, versie


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)

    zippad = sys.argv[1]
    if not os.path.isfile(zippad):
        raise SystemExit('Bestand niet gevonden: ' + zippad)

    zf = zipfile.ZipFile(zippad)
    titel, voorvoegsel, href, versie = lees_manifest(zf)

    slug = sys.argv[2] if len(sys.argv) > 2 else slugify(titel)
    doel = os.path.join(CURSUSSEN, slug)

    if os.path.isdir(doel):
        antwoord = input('courses/%s/ bestaat al. Overschrijven? [j/N] ' % slug)
        if antwoord.strip().lower() not in ('j', 'ja', 'y', 'yes'):
            raise SystemExit('Afgebroken.')
        shutil.rmtree(doel)

    os.makedirs(doel)
    aantal = 0
    noindex = [0]
    for lid in zf.infolist():
        if lid.is_dir():
            continue
        naam = lid.filename
        if voorvoegsel and naam.startswith(voorvoegsel):
            naam = naam[len(voorvoegsel):]
        if not naam or naam.startswith('..') or os.path.isabs(naam):
            continue
        uit = os.path.join(doel, naam.replace('/', os.sep))
        map_ = os.path.dirname(uit)
        if map_ and not os.path.isdir(map_):
            os.makedirs(map_)
        data = zf.read(lid.filename)

        # Zoekmachines buiten de deur houden. Een robots.txt in een project-repo
        # van GitHub Pages werkt niet (crawlers lezen alleen die van het domein),
        # dus de meta-tag in elke pagina is hier het enige dat telt.
        if naam.lower().endswith(('.html', '.htm')):
            tekst = data.decode('utf-8', 'ignore')
            if 'name="robots"' not in tekst and '<head' in tekst:
                tekst, vervangen = re.subn(
                    r'(<head[^>]*>)',
                    r'\1<meta name="robots" content="noindex, nofollow">',
                    tekst, count=1)
                if vervangen:
                    data = tekst.encode('utf-8')
                    noindex[0] += 1

        with open(uit, 'wb') as f:
            f.write(data)
        aantal += 1

    # Register bijwerken.
    lijst = []
    if os.path.isfile(REGISTER):
        lijst = json.load(io.open(REGISTER, encoding='utf-8'))

    invoer = {
        'slug': slug,
        'title': titel or slug,
        'description': '',
        'entry': 'courses/%s/%s' % (slug, href)
    }

    for i, c in enumerate(lijst):
        if c.get('slug') == slug:
            # Handmatig ingevulde velden overleven een nieuwe import.
            for veld in ('description', 'duration', 'hidden'):
                if c.get(veld):
                    invoer[veld] = c[veld]
            lijst[i] = invoer
            break
    else:
        lijst.append(invoer)

    with io.open(REGISTER, 'w', encoding='utf-8') as f:
        f.write(json.dumps(lijst, indent=2, ensure_ascii=False) + u'\n')

    mb = os.path.getsize(zippad) / 1048576.0
    print('Toegevoegd: %s' % (titel or slug))
    print('  slug      : %s' % slug)
    print('  SCORM     : %s' % (versie or 'onbekend'))
    print('  bestanden : %d (%.1f MB in het zip)' % (aantal, mb))
    print('  start     : %s' % invoer['entry'])
    print('  noindex   : toegevoegd aan %d HTML-bestanden' % noindex[0])
    print('')
    print('Zet nog een omschrijving in courses.json en test met:')
    print('  player.html?c=%s' % slug)


if __name__ == '__main__':
    main()
