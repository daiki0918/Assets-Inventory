import { AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import { createAssetQr } from './assetQr';

const dataUrlToBytes = (dataUrl) => Uint8Array.from(atob(dataUrl.split(',')[1]), (character) => character.charCodeAt(0));

const createBrandedQr = (qrDataUrl, logoUrl) => new Promise((resolve, reject) => {
  const qrImage = new Image();
  const logoImage = new Image();
  qrImage.onload = () => {
    logoImage.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = qrImage.naturalWidth || 800;
      canvas.height = qrImage.naturalHeight || 800;
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('Unable to prepare the branded QR code.'));
      context.drawImage(qrImage, 0, 0, canvas.width, canvas.height);
      const patchSize = Math.round(canvas.width * 0.145);
      context.fillStyle = '#fff';
      context.fillRect((canvas.width - patchSize) / 2, (canvas.height - patchSize) / 2, patchSize, patchSize);
      context.strokeStyle = '#2F4FE8';
      context.lineWidth = Math.max(2, Math.round(canvas.width * 0.006));
      context.strokeRect((canvas.width - patchSize) / 2, (canvas.height - patchSize) / 2, patchSize, patchSize);
      const logoHeight = Math.round(patchSize * 0.64);
      const logoWidth = Math.round(logoHeight * (logoImage.naturalWidth / logoImage.naturalHeight));
      context.drawImage(logoImage, (canvas.width - logoWidth) / 2, (canvas.height - logoHeight) / 2, logoWidth, logoHeight);
      resolve(canvas.toDataURL('image/png'));
    };
    logoImage.onerror = () => reject(new Error('Unable to load the company logo.'));
    logoImage.src = logoUrl;
  };
  qrImage.onerror = () => reject(new Error('Unable to prepare the QR code.'));
  qrImage.src = qrDataUrl;
});

const labelCell = (asset, qrDataUrl) => {
  const centered = (text, options = {}) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 45, line: 250 },
    children: [new TextRun({ text, font: 'Aptos', ...options })],
  });
  const details = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 70 }, children: [new ImageRun({ data: dataUrlToBytes(qrDataUrl), transformation: { width: 132, height: 132 }, type: 'png' })] }),
    centered('COSMOPOLITAN FUNERAL HOMES-INC.', { bold: true, size: 9, color: '2F4FE8' }),
    centered(asset.inventoryTag || '', { bold: true, size: 19, color: '152033' }),
    centered(asset.name || '', { bold: true, size: 13, color: '152033' }),
  ];
  if (asset.description) details.push(centered(asset.description, { size: 10, color: '475467' }));
  if (asset.category) details.push(centered(asset.category, { size: 9, color: '667085' }));
  if (asset.serialNo) details.push(centered(`SN: ${asset.serialNo}`, { size: 9, color: '667085' }));
  const cutBorder = { style: BorderStyle.DASHED, size: 5, color: '9AA9C8' };
  return new TableCell({ verticalAlign: VerticalAlign.CENTER, borders: { top: cutBorder, bottom: cutBorder, left: cutBorder, right: cutBorder }, margins: { top: 120, bottom: 120, left: 120, right: 120 }, children: details });
};

export async function downloadQrLabels(inputAssets) {
  const seen = new Set();
  const assets = inputAssets.filter((asset) => {
    const identity = asset._id || asset.qrToken || asset.inventoryTag;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  const logoResponse = await fetch('/logo-blue.png');
  if (!logoResponse.ok) throw new Error('Unable to load the company logo.');
  const logoUrl = URL.createObjectURL(await logoResponse.blob());
  try {
    const branded = await Promise.all(assets.map(async (asset) => ({ asset, qrDataUrl: await createBrandedQr(await createAssetQr(asset.inventoryTag), logoUrl) })));
    const children = [];
    for (let index = 0; index < branded.length; index += 12) {
      const page = branded.slice(index, index + 12);
      const rows = [];
      for (let rowIndex = 0; rowIndex < page.length; rowIndex += 3) {
        rows.push(new TableRow({ children: [0, 1, 2].map((offset) => page[rowIndex + offset] ? labelCell(page[rowIndex + offset].asset, page[rowIndex + offset].qrDataUrl) : new TableCell({ children: [new Paragraph('')] })) }));
      }
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.NONE, size: 0 }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 }, insideHorizontal: { style: BorderStyle.NONE, size: 0 }, insideVertical: { style: BorderStyle.NONE, size: 0 } }, rows }));
      if (index + 12 < branded.length) children.push(new Paragraph({ children: [], pageBreakBefore: true }));
    }
    const wordDocument = new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 576, right: 576, bottom: 576, left: 576 } } }, children }] });
    const blob = await Packer.toBlob(wordDocument);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qr-labels-${new Date().toISOString().slice(0, 10)}.docx`;
    link.click();
    URL.revokeObjectURL(url);
  } finally {
    URL.revokeObjectURL(logoUrl);
  }
}
