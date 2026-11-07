import QRCode from 'qrcode';

export function createAssetQr(qrCodeValue) {
  if (!qrCodeValue) throw new Error('This asset has no QR code value.');
  return QRCode.toDataURL(qrCodeValue, {
    width: 500,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#172554', light: '#FFFFFF' },
  });
}
