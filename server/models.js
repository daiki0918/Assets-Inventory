import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });

export const Cluster = model('Cluster', new Schema({ name: { type: String, unique: true, required: true } }));
export const Branch = model('Branch', new Schema({
  name: { type: String, unique: true, required: true },
  prefix: { type: String, unique: true, required: true, uppercase: true }, // e.g. CCR
  cluster: { ...ref('Cluster'), required: true },
  seq: { type: Number, default: 0 }, // atomic counter for inventoryTag
}));
export const Location = model('Location', new Schema({
  name: { type: String, required: true }, branch: { ...ref('Branch'), required: true },
}));
export const User = model('User', new Schema({
  email: { type: String, unique: true, required: true }, passwordHash: String, name: String,
  role: { type: String, enum: ['superadmin', 'operator'], required: true },
  branch: ref('Branch'), // required for operators
}));
const passwordResetCodeSchema = new Schema({
  user: { ...ref('User'), required: true, unique: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  requestedAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  challengeId: String,
  verifiedAt: Date,
  consumedAt: Date,
});
passwordResetCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordResetCode = model('PasswordResetCode', passwordResetCodeSchema);
const alertStateSchema = new Schema({
  user: { ...ref('User'), required: true },
  key: { type: String, required: true },
  readAt: Date,
  dismissedAt: Date,
});
alertStateSchema.index({ user: 1, key: 1 }, { unique: true });
export const AlertState = model('AlertState', alertStateSchema);

export const InventorySession = model('InventorySession', new Schema({
  branch: { ...ref('Branch'), required: true, index: true },
  month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  createdBy: { ...ref('User'), required: true },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
}, { timestamps: true }));
InventorySession.schema.index({ branch: 1, month: 1 }, { unique: true });

export const InventoryScan = model('InventoryScan', new Schema({
  session: { ...ref('InventorySession'), required: true, index: true },
  asset: { ...ref('Asset'), index: true },
  code: { type: String, required: true },
  scanBranch: { ...ref('Branch'), required: true },
  scannedBy: { ...ref('User'), required: true },
  outcome: { type: String, enum: ['verified', 'duplicate', 'wrong-branch', 'inactive', 'not-found'], required: true },
  verified: { type: Boolean, default: false },
}, { timestamps: true }));
InventoryScan.schema.index({ session: 1, asset: 1 }, { unique: true, partialFilterExpression: { asset: { $exists: true } } });

const transferRequestSchema = new Schema({
  asset: { ...ref('Asset'), required: true, index: true },
  requestedBy: { ...ref('User'), required: true, index: true },
  sourceBranch: { ...ref('Branch'), required: true },
  sourceLocation: { ...ref('Location'), required: true },
  destinationBranch: { ...ref('Branch'), required: true },
  destinationLocation: { ...ref('Location'), required: true },
  note: { type: String, trim: true, maxlength: 500 },
  status: { type: String, enum: ['pending', 'approving', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: ref('User'),
  reviewedAt: Date,
}, { timestamps: true });
transferRequestSchema.index({ asset: 1, status: 1 });
export const TransferRequest = model('TransferRequest', transferRequestSchema);

export const STATUSES = ['Active', 'Damaged', 'Missing', 'In-Transit', 'Disposed'];
const assetSchema = new Schema({
  inventoryTag: { type: String, unique: true, required: true },
  qrToken: { type: String, unique: true, required: true },
  qrUrl: { type: String, required: true },
  qrCodeValue: { type: String },
  qrImage: { type: String, required: true },  // PNG data URL
  name: { type: String, required: true }, category: String, description: String, serialNo: String,
  cluster: { ...ref('Cluster'), required: true, index: true },
  branch: { ...ref('Branch'), required: true, index: true },
  location: { ...ref('Location'), required: true },
  condition: { type: String, trim: true, maxlength: 120, default: 'Good' },
  status: { type: String, enum: STATUSES, default: 'Active', index: true },
  disposalDate: { type: Date, required: function () { return this.status === 'Disposed'; } },
  purchaseDate: { type: Date },
  cost: { type: Number, default: 0, min: 0 },
  salvageValue: { type: Number, default: 0 },
  usefulLifeYears: { type: Number, default: 5, min: 1 },
  history: [{ at: { type: Date, default: Date.now }, by: String, action: String, note: String }],
  maintenance: [{
    performedAt: Date, nextDue: Date, status: { type: String, enum: ['Scheduled', 'Completed', 'Cancelled'], default: 'Scheduled' },
    cost: { type: Number, default: 0, min: 0 }, vendor: String, note: String,
    by: String, createdAt: { type: Date, default: Date.now },
  }],
  documents: [{
    name: { type: String, required: true }, url: { type: String, required: true },
    type: String, addedBy: String, addedAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

// Straight-line depreciation, stops accruing at disposal date.
assetSchema.methods.bookValue = function (asOf = new Date()) {
  if (!this.purchaseDate) return Math.max(this.salvageValue, this.cost);
  const end = this.disposalDate && this.disposalDate < asOf ? this.disposalDate : asOf;
  const years = Math.max(0, (end - this.purchaseDate) / (365.25 * 864e5));
  const annual = (this.cost - this.salvageValue) / this.usefulLifeYears;
  return Math.max(this.salvageValue, +(this.cost - annual * years).toFixed(2));
};
export const Asset = model('Asset', assetSchema);
