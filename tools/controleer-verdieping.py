"""Controleert verdieping.json tegen course.json.

    python tools/controleer-verdieping.py <slug> [--bijwerken]

Meldt:
  - begrippen, verbanden of samenvattingen die naar een module of begrip
    verwijzen dat niet (meer) bestaat;
  - begrippen waarvan de naam niet in de lestekst van hun module voorkomt
    (dan is de les misschien aangepast, of hoort het begrip bij een andere les);
  - modules waarvan de tekst is veranderd sinds de verdieping voor het laatst
    is nagekeken.

Met --bijwerken wordt van elke module een vingerafdruk van de tekst in
verdieping.json gezet. Doe dat pas nadat je de verdieping van een gewijzigde
module hebt nagelopen.
"""
import datetime
import hashlib
import io
import json
import os
import re
import sys
import unicodedata

HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def plat(s):
    s = re.sub(r'<[^>]+>', ' ', str(s or '')).replace(u'\u2019', "'").replace(u'\u2018', "'")
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', s).lower()


def tekst_van(blok):
    delen = []

    def loop(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ('src', 'youtube', 'vimeo', 'url', 't', 'id', 'w', 'h'):
                    continue
                loop(v)
        elif isinstance(o, list):
            for v in o:
                loop(v)
        elif isinstance(o, str):
            delen.append(o)
    loop(blok)
    return plat(' '.join(delen))


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    slug = sys.argv[1]
    bijwerken = '--bijwerken' in sys.argv
    map_ = os.path.join(HIER, 'modules', slug)
    cursus = json.load(io.open(os.path.join(map_, 'course.json'), encoding='utf-8'))
    pad = os.path.join(map_, 'verdieping.json')
    v = json.load(io.open(pad, encoding='utf-8'))

    lessen = dict((l['id'], tekst_van(l['blocks'])) for l in cursus['lessons'])
    titels = dict((l['id'], l['title']) for l in cursus['lessons'])
    fouten, let_op = [], []

    ids = set()
    for b in v.get('begrippen', []):
        if b['id'] in ids:
            fouten.append('dubbel begrip: %s' % b['id'])
        ids.add(b['id'])
        if b['les'] not in lessen:
            fouten.append('begrip %s hoort bij onbekende module %s' % (b['naam'], b['les']))
            continue
        # Eén van de kernwoorden van de naam moet in de les staan.
        kern = plat(re.sub(r'\(.*?\)', '', b['naam']))
        woorden = [w for w in re.split(r'[^a-z0-9]+', kern) if len(w) > 3]
        if kern.strip() not in lessen[b['les']] and not any(w in lessen[b['les']] for w in woorden):
            let_op.append('%s (%s): naam niet in de lestekst gevonden' % (b['naam'], b['les']))

    for e in v.get('verbanden', []):
        for kant in ('a', 'b'):
            if e[kant] not in ids:
                fouten.append('verband naar onbekend begrip: %s' % e[kant])
        if e.get('type') not in v.get('types', {}):
            fouten.append('verband met onbekend type: %s' % e.get('type'))
    for e in v.get('extern', []):
        if e['begrip'] not in ids:
            fouten.append('verwijzing naar onbekend begrip: %s' % e['begrip'])
    for les in v.get('samenvattingen', {}):
        if les not in lessen:
            fouten.append('samenvatting bij onbekende module %s' % les)

    vingers = dict((les, hashlib.sha1(t.encode('utf-8')).hexdigest()[:12]) for les, t in lessen.items())
    nagekeken = v.get('nagekeken', {})
    for les, vinger in vingers.items():
        oud = nagekeken.get(les)
        if oud and oud.get('vinger') != vinger:
            let_op.append('module %s (%s) is veranderd sinds %s: loop de begrippen, verbanden en samenvatting na'
                          % (les, titels[les][:40], oud.get('datum', '?')))
        elif not oud:
            let_op.append('module %s heeft nog geen vingerafdruk (draai met --bijwerken na controle)' % les)

    for f in fouten:
        print('FOUT   ' + f)
    for w in let_op:
        print('LET OP ' + w)
    if not fouten and not let_op:
        print('Alles klopt: %d begrippen, %d verbanden.' % (len(ids), len(v.get('verbanden', []))))

    if bijwerken:
        vandaag = datetime.date.today().isoformat()
        v['nagekeken'] = dict((les, {'vinger': vinger, 'datum': vandaag}) for les, vinger in vingers.items())
        with io.open(pad, 'w', encoding='utf-8') as f:
            f.write(json.dumps(v, indent=1, ensure_ascii=False) + u'\n')
        print('Vingerafdrukken bijgewerkt (%s).' % vandaag)
    raise SystemExit(1 if fouten else 0)


if __name__ == '__main__':
    main()
