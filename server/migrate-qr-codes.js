import 'dotenv/config';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import { Asset } from './models.js';

await mongoose.connect(process.env.MONGODB_URI);

try {
  let updated = 0;
  let operations = [];

  for await (const asset of Asset.find().select('inventoryTag').cursor()) {
    const qrCodeValue = asset.inventoryTag;

    operations.push({
      updateOne: {
        filter: { _id: asset._id },
        update: {
          $set: {
            qrCodeValue,
            qrImage: await QRCode.toDataURL(qrCodeValue, { width: 400, margin: 1 }),
          },
        },
      },
    });

    if (operations.length === 100) {
      const result = await Asset.bulkWrite(operations);
      updated += result.modifiedCount;
      operations = [];
    }
  }

  if (operations.length) {
    const result = await Asset.bulkWrite(operations);
    updated += result.modifiedCount;
  }

  console.log(`Updated QR codes for ${updated} asset${updated === 1 ? '' : 's'}.`);
} finally {
  await mongoose.disconnect();
}
