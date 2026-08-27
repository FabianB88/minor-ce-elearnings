#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Past de kennisvragen van een module aan en voegt nieuwe toe.

    python tools/vragen.py <slug>

Wat dit script doet:

1. Zet bij elke bestaande vraag een terugkoppeling. Zonder uitleg is een vraag
   een tolpoortje: je hoort dat je fout zat, niet waarom.

2. Herschrijft afleiders die te kort waren. In de oorspronkelijke set was bij
   vijftien van de negentien meerkeuzevragen het juiste antwoord het langste,
   gemiddeld 155 tekens tegen 107. Je kon scoren door de zin met de meeste
   nuance te kiezen zonder de stof te lezen. De afleiders zijn daarom
   uitgeschreven tot vergelijkbare lengte en plausibiliteit.

3. Voegt nieuwe vragen toe op plekken waar lang achter elkaar door gelezen werd.

Het script is idempotent: elke toegevoegde vraag krijgt een sleutel, en een
vraag met een sleutel die al bestaat wordt overgeslagen.
"""

from __future__ import print_function

import io
import json
import os
import sys

HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VRAAG_MODULE = os.environ.get('VRAGEN_MODULE', 'business_ethics_vragen')


def laad_inhoud(naam):
    pad = os.path.join(HIER, 'tools', naam + '.json')
    return json.load(io.open(pad, encoding='utf-8'))


def vraagblokken(les):
    return [b for b in les['blocks'] if b['t'] in ('quiz', 'match')]


def segmentgrenzen(blocks):
    """Index van elk continue-blok, plus het einde van de lijst."""
    grenzen = [i for i, b in enumerate(blocks) if b['t'] == 'continue']
    return grenzen + [len(blocks)]


def voeg_toe(les, na_segment, blok):
    """Zet een blok aan het eind van segment `na_segment` (1-based), gevolgd
    door een doorgaan-knop zodat het een eigen stap wordt."""
    grenzen = segmentgrenzen(les['blocks'])
    if na_segment < 1 or na_segment > len(grenzen):
        raise SystemExit('segment %d bestaat niet in %s' % (na_segment, les['title']))
    pos = grenzen[na_segment - 1]
    les['blocks'][pos:pos] = [blok]
    return pos


def splits_bij_kop(les, kop):
    """Knipt het tekstblok met deze tussenkop in tweeën, met een doorgaan-knop
    ertussen. Zo wordt een muur van zeshonderd woorden twee leesbare stappen."""
    merk = '<h3>%s</h3>' % kop
    for i, b in enumerate(les['blocks']):
        if b['t'] != 'text' or merk not in (b.get('body') or ''):
            continue
        voor, na = b['body'].split(merk, 1)
        if not voor.strip():
            return False
        b['body'] = voor.strip()
        nieuw = {'t': 'text', 'heading': kop, 'body': na.strip(), 'key': 'split:' + kop}
        les['blocks'][i + 1:i + 1] = [{'t': 'continue'}, nieuw]
        return True
    return False


def splits_voor_blok(les, kop):
    """Zet een doorgaan-knop vóór het blok met deze kop, zodat twee blokken die
    in hetzelfde segment stonden ieder een eigen leesstap krijgen."""
    for i, b in enumerate(les['blocks']):
        if b.get('heading') == kop and i > 0 and les['blocks'][i - 1]['t'] != 'continue':
            les['blocks'][i:i] = [{'t': 'continue'}]
            b['key'] = 'voorsplit:' + kop
            return True
    return False


def spreid_antwoorden(d):
    """Het juiste antwoord stond bijna altijd op dezelfde plek. Rouleer de opties
    zodat het correcte antwoord gelijkmatig over A, B, C en D verdeeld staat.
    Deterministisch, dus een herbouw levert dezelfde volgorde op."""
    n = 0
    teller = 0
    for les in d['lessons']:
        for b in les['blocks']:
            if b['t'] != 'quiz' or b.get('multi'):
                continue
            opties = b['options']
            huidig = next((i for i, o in enumerate(opties) if o['correct']), None)
            if huidig is None:
                continue
            doel = teller % len(opties)
            teller += 1
            if huidig != doel:
                b['options'] = opties[huidig - doel:] + opties[:huidig - doel]
                n += 1
    return n


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else 'business-ethics'
    pad = os.path.join(HIER, 'modules', slug, 'course.json')
    d = json.load(io.open(pad, encoding='utf-8'))

    inhoud = laad_inhoud(slug.replace('-', '_') + '_vragen')

    # ---- 1 en 2: bestaande vragen bijwerken -------------------------------
    alle = [b for l in d['lessons'] for b in vraagblokken(l)]
    bijgewerkt = herschreven = 0
    for sleutel, wijziging in sorted(inhoud.get('bestaand', {}).items(), key=lambda x: int(x[0])):
        i = int(sleutel) - 1
        if i >= len(alle):
            print('  LET OP: vraag %s bestaat niet (er zijn er %d)' % (sleutel, len(alle)))
            continue
        b = alle[i]
        if wijziging.get('feedback'):
            b['feedback'] = wijziging['feedback']
            bijgewerkt += 1
        if wijziging.get('options'):
            nieuw = wijziging['options']
            oud_goed = [o['text'] for o in b.get('options', []) if o['correct']]
            if len([o for o in nieuw if o['correct']]) != len(oud_goed):
                print('  LET OP: vraag %s wijzigt het aantal juiste antwoorden' % sleutel)
            b['options'] = nieuw
            herschreven += 1

    # ---- 3: te lange segmenten splitsen ----------------------------------
    # Eerst splitsen, dan pas vragen invoegen: het splitsen verandert de
    # segmentnummering waarop de vragen zijn geplaatst.
    gesplitst = 0
    for s in inhoud.get('splits', []):
        les = d['lessons'][s['module'] - 1]
        soort = s.get('waar', 'bij')
        merk = ('voorsplit:' if soort == 'voor' else 'split:') + s['kop']
        if any(b.get('key') == merk for b in les['blocks']):
            continue
        gelukt = splits_voor_blok(les, s['kop']) if soort == 'voor' else splits_bij_kop(les, s['kop'])
        if gelukt:
            gesplitst += 1
        else:
            print('  LET OP: kop niet gevonden om te splitsen: %s' % s['kop'])

    # ---- 4: nieuwe vragen invoegen ---------------------------------------
    bestaande_sleutels = {b.get('key') for l in d['lessons'] for b in l['blocks'] if b.get('key')}
    toegevoegd = 0
    # van achter naar voren, anders verschuiven de posities
    nieuw = sorted(inhoud.get('nieuw', []), key=lambda v: (-v['module'], -v['na_segment']))
    for v in nieuw:
        if v['key'] in bestaande_sleutels:
            continue
        blok = {k: val for k, val in v.items() if k not in ('module', 'na_segment')}
        voeg_toe(d['lessons'][v['module'] - 1], v['na_segment'], blok)
        toegevoegd += 1

    # ---- 5: antwoordposities gelijkmatig verdelen ------------------------
    verplaatst = spreid_antwoorden(d)

    with io.open(pad, 'w', encoding='utf-8') as f:
        f.write(json.dumps(d, indent=2, ensure_ascii=False) + u'\n')

    tot = sum(len(vraagblokken(l)) for l in d['lessons'])
    print('terugkoppelingen gezet : %d' % bijgewerkt)
    print('antwoorden herschreven : %d' % herschreven)
    print('antwoorden verschoven  : %d' % verplaatst)
    print('segmenten gesplitst    : %d' % gesplitst)
    print('nieuwe vragen ingevoegd: %d' % toegevoegd)
    print('vragen in de cursus nu : %d' % tot)
    print()
    for i, l in enumerate(d['lessons'], 1):
        segs = len(segmentgrenzen(l['blocks']))
        print('  m%d %-42s %2d vragen in %2d segmenten' % (i, l['title'][:40], len(vraagblokken(l)), segs))


if __name__ == '__main__':
    main()
