// Maakt van tools/_docmodel.json een leesbaar Word-bestand.
//
//   node tools/maak-word.js "C:/pad/naar/uitvoer.docx"
//
// Bedoeld voor collega's die de e-learning niet in de browser willen doorlopen
// maar de inhoud gewoon willen lezen.

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  ImageRun, PageBreak, LevelFormat, ExternalHyperlink
} = require('docx');

const HIER = path.dirname(__dirname);
const model = JSON.parse(fs.readFileSync(path.join(HIER, 'tools', '_docmodel.json'), 'utf8'));
const uitvoer = process.argv[2] || path.join(HIER, 'Business Ethics - volledige inhoud.docx');

// Green Office-palet, zodat het document bij de e-learning past.
const GROEN = '5C7A5A';
const GROEN_DONKER = '4A6349';
const GROEN_LICHT = 'EDF3EC';
const WARM = '7D6034';
const WARM_LICHT = 'F6F0E8';
const GRIJS = '7A6E66';
const VLAK = 'F2EEE9';
const RAND = 'E4DDD6';

const BREEDTE = 9070;          // A4 minus marges, in DXA

function runs(lijst) {
  return (lijst || []).map(r => new TextRun({ text: r.text, bold: r.vet, italics: r.cursief }));
}

function cel(tekst, opties = {}) {
  return new TableCell({
    width: { size: opties.breedte, type: WidthType.DXA },
    shading: opties.vulling ? { type: ShadingType.CLEAR, fill: opties.vulling } : undefined,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    children: [new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new TextRun({
        text: tekst,
        bold: !!opties.vet,
        size: opties.klein ? 18 : 20,
        color: opties.kleur
      })]
    })]
  });
}

function tabel(rijen, kolomBreedtes) {
  return new Table({
    columnWidths: kolomBreedtes,
    width: { size: BREEDTE, type: WidthType.DXA },
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 2, color: RAND },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RAND },
      left:   { style: BorderStyle.SINGLE, size: 2, color: RAND },
      right:  { style: BorderStyle.SINGLE, size: 2, color: RAND },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RAND },
      insideVertical:   { style: BorderStyle.SINGLE, size: 2, color: RAND }
    },
    rows: rijen.map((rij, i) => new TableRow({
      tableHeader: i === 0,
      children: rij.map((tekst, k) => cel(tekst, {
        breedte: kolomBreedtes[k],
        vulling: i === 0 ? GROEN_LICHT : undefined,
        vet: i === 0,
        kleur: i === 0 ? GROEN_DONKER : undefined
      }))
    }))
  });
}

// ------------------------------------------------------------------ voorpagina

const kinderen = [];

kinderen.push(new Paragraph({
  spacing: { before: 2400, after: 120 },
  children: [new TextRun({ text: 'MINOR CIRCULAIRE ECONOMIE', bold: true, size: 18, color: GROEN, characterSpacing: 40 })]
}));
kinderen.push(new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({ text: model.titel, bold: true, size: 60 })]
}));
if (model.ondertitel) {
  kinderen.push(new Paragraph({
    spacing: { after: 360 },
    children: [new TextRun({ text: model.ondertitel, size: 26, color: GRIJS })]
  }));
}
kinderen.push(new Paragraph({
  spacing: { after: 80 },
  children: [new TextRun({ text: 'Door ' + model.auteur, size: 20, color: GRIJS })]
}));
kinderen.push(new Paragraph({
  spacing: { after: 480 },
  children: [new TextRun({
    text: 'Dit document bevat de volledige inhoud van de e-learning: alle teksten, '
        + 'kennisvragen met de juiste antwoorden en toelichting, en verwijzingen naar de video\u2019s.',
    size: 20, color: GRIJS, italics: true
  })]
}));

kinderen.push(new Paragraph({
  spacing: { before: 240, after: 200 },
  children: [new TextRun({ text: 'De vijf modules', bold: true, size: 26 })]
}));

kinderen.push(tabel(
  [['Module', 'Afronden vóór', 'Leesstappen', 'Vragen']].concat(
    model.overzicht.map(m => [
      m.nr + '. ' + m.titel, m.deadline, String(m.stappen), String(m.vragen)
    ])),
  [4670, 1900, 1300, 1200]
));

kinderen.push(new Paragraph({ children: [new PageBreak()] }));

// ------------------------------------------------------------------ modules

model.modules.forEach((mod, mi) => {
  if (mi > 0) kinderen.push(new Paragraph({ children: [new PageBreak()] }));

  kinderen.push(new Paragraph({
    spacing: { before: 0, after: 60 },
    children: [new TextRun({ text: 'MODULE ' + mod.nr + ' VAN ' + model.modules.length, bold: true, size: 18, color: GROEN, characterSpacing: 40 })]
  }));
  kinderen.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: mod.titel, bold: true, size: 36 })]
  }));
  if (mod.deadline) {
    kinderen.push(new Paragraph({
      spacing: { after: 320 },
      shading: { type: ShadingType.CLEAR, fill: WARM_LICHT },
      children: [new TextRun({ text: '  Afronden vóór ' + mod.deadline + '  ', bold: true, size: 18, color: WARM })]
    }));
  }

  mod.elementen.forEach(e => {
    switch (e.type) {

      case 'kop2':
        kinderen.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 360, after: 140 },
          children: [new TextRun({ text: e.tekst, bold: true, size: 27 })]
        }));
        break;

      case 'kop3':
      case 'kop4':
        kinderen.push(new Paragraph({
          heading: e.type === 'kop3' ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
          spacing: { before: 260, after: 110 },
          children: [new TextRun({ text: e.tekst, bold: true, size: 23, color: GROEN_DONKER })]
        }));
        break;

      case 'para':
        kinderen.push(new Paragraph({
          spacing: { after: 160, line: 300 },
          children: runs(e.runs)
        }));
        break;

      case 'bullet':
        kinderen.push(new Paragraph({
          numbering: { reference: 'punten', level: 0 },
          spacing: { after: 80, line: 300 },
          children: runs(e.runs)
        }));
        break;

      case 'nummer':
        kinderen.push(new Paragraph({
          numbering: { reference: 'cijfers', level: 0 },
          spacing: { after: 80, line: 300 },
          children: runs(e.runs)
        }));
        break;

      case 'beeld': {
        try {
          const data = fs.readFileSync(e.pad);
          kinderen.push(new Paragraph({
            spacing: { before: 240, after: 80 },
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ data, type: 'jpg', transformation: { width: 460, height: 251 } })]
          }));
          if (e.bijschrift) {
            kinderen.push(new Paragraph({
              spacing: { after: 260 },
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: e.bijschrift, size: 17, color: GRIJS, italics: true })]
            }));
          }
        } catch (err) {
          kinderen.push(new Paragraph({
            children: [new TextRun({ text: '[afbeelding niet gevonden: ' + path.basename(e.pad) + ']', size: 18, color: GRIJS })]
          }));
        }
        break;
      }

      case 'video':
        kinderen.push(new Paragraph({
          spacing: { before: 180, after: 200 },
          shading: { type: ShadingType.CLEAR, fill: VLAK },
          children: [
            new TextRun({ text: '  Video:  ', bold: true, size: 19, color: GROEN_DONKER }),
            new TextRun({ text: e.titel + '  ', size: 19 }),
            new ExternalHyperlink({
              link: e.url,
              children: [new TextRun({ text: e.url + '  ', size: 17, color: GROEN, underline: {} })]
            })
          ]
        }));
        break;

      case 'tabel':
        kinderen.push(new Paragraph({
          spacing: { before: 300, after: 120 },
          children: [new TextRun({ text: e.titel, bold: true, size: 21, color: GROEN_DONKER })]
        }));
        kinderen.push(tabel(
          e.rijen,
          e.rijen[0].length === 3 ? [2100, 4070, 2900] : [2600, 6470]
        ));
        if (e.bijschrift) {
          kinderen.push(new Paragraph({
            spacing: { before: 100, after: 260 },
            children: [new TextRun({ text: e.bijschrift, size: 17, color: GRIJS, italics: true })]
          }));
        }
        break;

      case 'vraag': {
        kinderen.push(new Paragraph({
          spacing: { before: 320, after: 100 },
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: GROEN } },
          children: [new TextRun({ text: e.soort.toUpperCase(), bold: true, size: 16, color: GROEN, characterSpacing: 30 })]
        }));
        kinderen.push(new Paragraph({
          spacing: { after: 140 },
          children: [new TextRun({ text: e.vraag, bold: true, size: 21 })]
        }));

        if (e.paren) {
          kinderen.push(tabel([['Begrip', 'Hoort bij']].concat(e.paren), [2600, 6470]));
        } else {
          e.opties.forEach(o => {
            kinderen.push(new Paragraph({
              spacing: { after: 60, line: 280 },
              indent: { left: 340, hanging: 340 },
              children: [
                new TextRun({ text: o.goed ? '\u2713  ' : '\u25CB  ', bold: true, size: 20, color: o.goed ? GROEN : 'B0A49A' }),
                new TextRun({ text: o.tekst, size: 20, bold: !!o.goed, color: o.goed ? GROEN_DONKER : undefined })
              ]
            }));
          });
        }

        if (e.feedback) {
          kinderen.push(new Paragraph({
            spacing: { before: 160, after: 260 },
            shading: { type: ShadingType.CLEAR, fill: GROEN_LICHT },
            children: [
              new TextRun({ text: '  Toelichting:  ', bold: true, size: 19, color: GROEN_DONKER }),
              new TextRun({ text: e.feedback + '  ', size: 19, color: GROEN_DONKER })
            ]
          }));
        } else {
          kinderen.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
        }
        break;
      }

      case 'scheiding':
        // In de e-learning zit hier een doorgaan-knop. Op papier is een rustige
        // scheidslijn genoeg om de leesstap te markeren.
        kinderen.push(new Paragraph({
          spacing: { before: 200, after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RAND } },
          children: []
        }));
        break;
    }
  });
});

// ------------------------------------------------------------------ document

const doc = new Document({
  creator: model.auteur || 'Minor Circulaire Economie',
  title: model.titel,
  description: 'Volledige inhoud van de e-learning ' + model.titel,
  numbering: {
    config: [
      {
        reference: 'punten',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 460, hanging: 260 } } }
        }]
      },
      {
        reference: 'cijfers',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 460, hanging: 260 } } }
        }]
      }
    ]
  },
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 21, color: '1C1713' } }
    }
  },
  sections: [{
    properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
    children: kinderen
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(uitvoer, buf);
  console.log('geschreven: ' + uitvoer);
  console.log('alinea-elementen: ' + kinderen.length);
});
