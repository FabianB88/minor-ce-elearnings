#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Herstelt opmaakschade in een module.

    python tools/opschonen.py <slug>

Bij het overzetten uit Word naar Rise zijn in sommige blokken alle alineagrenzen
verdwenen. Modules 4 en 5 van Business Ethics kwamen daardoor binnen als één
muur tekst per blok, met zinnen die aan elkaar plakken ("...gebruiken.In de
praktijk...") en tussenkoppen die in de lopende tekst zijn opgegaan.

Het script is idempotent: nog een keer draaien verandert niets meer.
"""

from __future__ import print_function

import io
import json
import os
import re
import sys

HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Woorden waarin een hoofdletter middenin hoort. Zonder deze uitzonderingen
# zou het script "BlackRock" en "DiMaggio" uit elkaar trekken.
SAMENSTELLINGEN = ['BlackRock', 'DiMaggio', 'IoT', 'YouTube', 'PostNL', 'eBay',
                   'iPhone', 'macOS', 'eHerkenning']

# Opsommingen die hun structuur kwijt zijn geraakt: de losse punten zijn na een
# dubbele punt aan elkaar geplakt. Per geval de exacte tekst en de losse punten.
LIJSTEN = [
    ('bepaalt:welke informatie teltwelke risico’s zwaar wegenwelke investeringen '
     'als rationeel worden gezienwelke tijdshorizon dominant wordtIn combinatie',
     'bepaalt:', [
         'welke informatie telt',
         'welke risico’s zwaar wegen',
         'welke investeringen als rationeel worden gezien',
         'welke tijdshorizon dominant wordt',
     ], 'In combinatie'),

    ('bepaalt:Welke data worden verzameldHoe gebruikers worden geprofileerdWelke '
     'informatie zichtbaar wordtWelke keuzes worden gestimuleerdAlgoritmische',
     'bepaalt:', [
         'Welke data worden verzameld',
         'Hoe gebruikers worden geprofileerd',
         'Welke informatie zichtbaar wordt',
         'Welke keuzes worden gestimuleerd',
     ], 'Algoritmische'),

    ('bepalen namelijk:wie toegang krijgt tot essentiële systemenwelke standaarden '
     'worden gebruikthoe kosten en voordelen worden verdeeldDeze beslissingen',
     'bepalen namelijk:', [
         'wie toegang krijgt tot essentiële systemen',
         'welke standaarden worden gebruikt',
         'hoe kosten en voordelen worden verdeeld',
     ], 'Deze beslissingen'),
]

# Losse verschrijvingen die uit de conversie zijn overgebleven.
TYPOS = [
    ('beinvloeden', 'beïnvloeden'),
    ('beinvloed', 'beïnvloed'),
    ('>n de praktijk bestaan', '>In de praktijk bestaan'),
]

# Bijschriften en alt-teksten voor het beeldmateriaal. Zonder deze is een
# afbeelding voor een schermlezer niets en voor de rest een plaatje zonder duiding.
BEELDEN = {
    'Gemini_Generated_Image_2cy.jpg':
        'Links de menselijke maat met empathie, rechtvaardigheid en persoonlijke '
        'overtuigingen; rechts het systeem met optimalisatie, efficiëntie en '
        'winstmaximalisatie. In het midden botsen ze: morele overwegingen tegenover '
        'doelgerichte machinefunctie.',
    'Gemini_Generated_Image_m3y.jpg':
        'Schematische weergave van hoe bezit, schaal en technologie samen '
        'machtsconcentratie opbouwen.',
    'ChatGPT Image 27 jan.jpg':
        'Illustratie bij morele ontkoppeling: hoe mensen binnen een systeem hun eigen '
        'aandeel in de schade uit het zicht verliezen.',
    'ChatGPT Image 23 feb.jpg':
        'Illustratie bij het spectrum van aandeelhoudersmodel naar stakeholdersmodel.',
    'common-ethical-challenges-.jpg':
        'Overzicht van veelvoorkomende ethische vraagstukken bij het gebruik van '
        'kunstmatige intelligentie.',
}


# ---------------------------------------------------------------- gereedschap

def maskeer(s, bewaard):
    """Tags en samenstellingen tijdelijk vervangen, zodat de regels hieronder
    alleen op lopende tekst werken."""
    def vang(m):
        bewaard.append(m.group(0))
        return '\x00%d\x00' % (len(bewaard) - 1)
    s = re.sub(r'<[^>]+>', vang, s)
    for w in SAMENSTELLINGEN:
        s = s.replace(w, vang(re.match(re.escape(w), w)))
    return s


def ontmaskeer(s, bewaard):
    return re.sub(r'\x00(\d+)\x00', lambda m: bewaard[int(m.group(1))], s)


PLAK = re.compile(r'([a-zëéïü\)”"])\.([A-Z“])')
KOP_GRENS = re.compile(r'^(.{4,90}?)([a-zëéï])([A-Z])')


def splits_alineas(html):
    """Punt direct gevolgd door hoofdletter is een verdwenen alineagrens."""
    bewaard = []
    s = maskeer(html, bewaard)
    s, n = PLAK.subn(lambda m: m.group(1) + '.\x01' + m.group(2), s)
    return ontmaskeer(s, bewaard), n


def promoveer_koppen(html):
    """Een alinea die begint met een korte titel zonder leesteken, direct gevolgd
    door een hoofdletter, had een tussenkop moeten zijn."""
    aantal = [0]

    def per_alinea(m):
        binnen = m.group(1)
        bewaard = []
        s = maskeer(binnen, bewaard)
        k = KOP_GRENS.match(s)
        if not k:
            return m.group(0)
        kop = (k.group(1) + k.group(2))
        # Een kop is kort, bevat geen zinseinde en eindigt niet op een komma.
        if len(kop.split()) > 12 or re.search(r'[.!?;]', kop) or kop.rstrip().endswith(','):
            return m.group(0)
        rest = s[len(kop):]
        aantal[0] += 1
        return ('<h3>%s</h3><p>%s</p>'
                % (ontmaskeer(kop.strip(), bewaard), ontmaskeer(rest.strip(), bewaard)))

    uit = re.sub(r'<p>(.*?)</p>', per_alinea, html, flags=re.S)
    return uit, aantal[0]


def herstel_lijsten(html, rapport):
    for zoek, aanhef, punten, staart in LIJSTEN:
        kern = zoek.split(aanhef, 1)[1]
        if kern not in html:
            continue
        vervanging = ('</p><ul>' + ''.join('<li>%s</li>' % p for p in punten)
                      + '</ul><p>' + staart)
        origineel = ''.join(punten) + staart
        if origineel not in html:
            rapport.append('  LET OP: lijst niet exact gevonden bij "%s"' % aanhef)
            continue
        html = html.replace(origineel, vervanging, 1)
        rapport.append('  lijst hersteld (%d punten) na "%s"' % (len(punten), aanhef))
    return html


def poets(html):
    """Restjes uit de conversie."""
    # Spans uit Word dragen hier niets bij; sommige zetten een harde tekstkleur
    # of een witte achtergrond, wat op ons warme papier als een vlek opvalt.
    html = re.sub(r'<span[^>]*>\s*</span>', '', html)
    html = re.sub(r'</?span[^>]*>', '', html)
    html = re.sub(r'\sstyle="[^"]*(?:color|background)[^"]*"', '', html)
    html = html.replace('&nbsp;', ' ')
    html = re.sub(r'(?<=\S)  +(?=\S)', ' ', html)
    html = re.sub(r'<p>\s*</p>', '', html)
    for a, b in TYPOS:
        html = html.replace(a, b)
    # De bloktitel is al een h2. Tussenkoppen in de lopende tekst staan door de
    # modules heen op h2, h4 en h5 door elkaar; die worden allemaal h3.
    html = re.sub(r'<(/?)h[245]>', r'<\1h3>', html)
    return html


def verwerk(html, rapport):
    if not html:
        return html, 0, 0
    html = poets(html)
    html = herstel_lijsten(html, rapport)
    html, n_alinea = splits_alineas(html)
    html = html.replace('\x01', '</p><p>')
    html, n_kop = promoveer_koppen(html)
    html = re.sub(r'<p>\s*</p>', '', html)
    return html, n_alinea, n_kop


# ---------------------------------------------------------------- hoofdprogramma

def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else 'business-ethics'
    pad = os.path.join(HIER, 'modules', slug, 'course.json')
    d = json.load(io.open(pad, encoding='utf-8'))

    totaal_a = totaal_k = 0
    for li, les in enumerate(d['lessons'], 1):
        rapport = []
        a = k = 0
        for b in les['blocks']:
            if b.get('body'):
                b['body'], na, nk = verwerk(b['body'], rapport)
                a += na; k += nk
            if b['t'] == 'tabs':
                for it in b['items']:
                    it['body'], na, nk = verwerk(it.get('body'), rapport)
                    a += na; k += nk
            if b['t'] == 'list':
                b['items'] = [poets(x) for x in b['items']]
            if b['t'] == 'image':
                naam = os.path.basename(b['src'])
                if naam in BEELDEN and not b.get('caption'):
                    b['caption'] = BEELDEN[naam]
        totaal_a += a; totaal_k += k
        print('m%d %-42s alineagrenzen: %3d   tussenkoppen: %2d' % (li, les['title'][:40], a, k))
        for r in rapport:
            print(r)

    with io.open(pad, 'w', encoding='utf-8') as f:
        f.write(json.dumps(d, indent=2, ensure_ascii=False) + u'\n')

    print()
    print('Totaal %d alineagrenzen hersteld en %d tussenkoppen teruggezet.' % (totaal_a, totaal_k))


if __name__ == '__main__':
    main()
