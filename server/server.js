import 'dotenv/config';
import express from 'express'; import cors from 'cors'; import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs'; import mongoose from 'mongoose'; import QRCode from 'qrcode';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { pathToFileURL } from 'node:url';
import { AlertState, Asset, Branch, Cluster, InventoryScan, InventorySession, Location, PasswordResetCode, TransferRequest, User, STATUSES } from './models.js';

const localOrigins = ['http://localhost:5173', 'http://localhost:5174', 'https://localhost:5174'];
const applicationOrigin = process.env.APP_URL ? new URL(process.env.APP_URL).origin : null;
const allowedOrigins = new Set(process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [...localOrigins, ...(applicationOrigin ? [applicationOrigin] : [])]);
export const app = express();
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
}));
app.use(express.json());
const errorMessage = (e) => {
  if (e?.code === 11000) return `${Object.keys(e.keyPattern || e.keyValue || {}).join(', ') || 'Value'} already exists`;
  if (e?.name === 'ValidationError') return Object.values(e.errors).map((error) => error.message).join('. ');
  return e?.message || 'The request could not be completed';
};
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(e.status || 400).json({ error: errorMessage(e) }));
const fail = (status, message) => Object.assign(new Error(message), { status });
const validateJwtSecret = () => {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || ['change-me', 'changeme', 'secret'].includes(secret.trim().toLowerCase())) {
    throw new Error('JWT_SECRET must be a unique, high-entropy secret of at least 32 characters.');
  }
};
const getMailTransport = () => {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    throw fail(503, 'Password recovery email is not configured. Contact your administrator.');
  }
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail(503, 'Email service configuration is invalid.');
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
};
const passwordResetCodeHash = (userId, code) => crypto
  .createHmac('sha256', process.env.JWT_SECRET)
  .update(`${userId}:${code}`)
  .digest('hex');
const passwordResetMessage = 'If an account exists for that email, a verification code will be sent. It expires in 10 minutes; contact your administrator if it does not arrive.';
const CLUSTER_NAMES = ['SOUTH', 'NORTH'];
const findAvailableAssetTags = async (branch, quantity, session, excludedAssetId) => {
  const escapedPrefix = branch.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inventoryTag = new RegExp(`^${escapedPrefix}-\\d+$`);
  const existingAssets = await Asset.find({
    branch: branch._id,
    inventoryTag,
    ...(excludedAssetId ? { _id: { $ne: excludedAssetId } } : {}),
  }).select('inventoryTag').session(session).lean();
  const usedSequences = new Set(existingAssets.map((asset) => Number(asset.inventoryTag.slice(branch.prefix.length + 1))));
  const sequences = [];
  for (let sequence = 1; sequences.length < quantity; sequence += 1) {
    if (!usedSequences.has(sequence)) sequences.push(sequence);
  }
  return sequences.map((sequence) => `${branch.prefix}-${String(sequence).padStart(4, '0')}`);
};
const allocateAssetTags = async (branchId, quantity, session, excludedAssetId) => {
  const branch = await Branch.findByIdAndUpdate(
    branchId,
    { $inc: { seq: quantity } },
    { new: true, session },
  );
  if (!branch) throw fail(404, 'Branch not found while reserving asset codes');
  const inventoryTags = await findAvailableAssetTags(branch, quantity, session, excludedAssetId);
  const lastAllocatedSequence = Number(inventoryTags.at(-1).slice(branch.prefix.length + 1));
  if (branch.seq < lastAllocatedSequence) {
    branch.seq = lastAllocatedSequence;
    await branch.save({ session });
  }
  return { branch, inventoryTags };
};
const parseBranchLocations = (value) => {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw fail(400, 'Locations must be a list');
  const ids = new Set();
  const names = new Set();
  return value.map((location) => {
    if (!location || typeof location.name !== 'string') throw fail(400, 'Each location must have a name');
    const name = location.name.trim();
    if (!name) throw fail(400, 'Location names cannot be empty');
    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) throw fail(400, `Location "${name}" is listed more than once`);
    names.add(normalizedName);
    if (location.id !== undefined) {
      if (!mongoose.isValidObjectId(location.id)) throw fail(400, 'Invalid location ID');
      const id = String(location.id);
      if (ids.has(id)) throw fail(400, 'A location cannot be listed more than once');
      ids.add(id);
      return { id, name };
    }
    return { name };
  });
};
const prepareBranchLocations = async (branchId, locations, relocations = [], session) => {
  if (locations === null) return null;
  if (!Array.isArray(relocations)) throw fail(400, 'Location asset moves must be a list');
  const existing = await Location.find({ branch: branchId }).select('_id name').session(session).lean();
  const existingById = new Map(existing.map((location) => [String(location._id), location]));
  const retainedIds = new Set();
  const relocationByLocation = new Map();
  const locationOperations = [];
  const assetOperations = [];

  for (const relocation of relocations) {
    if (!relocation || !mongoose.isValidObjectId(relocation.locationId) || !mongoose.isValidObjectId(relocation.targetLocationId)) {
      throw fail(400, 'Invalid location asset move');
    }
    if (relocationByLocation.has(String(relocation.locationId))) throw fail(400, 'A location can only have one asset destination');
    relocationByLocation.set(String(relocation.locationId), String(relocation.targetLocationId));
  }

  for (const location of locations) {
    if (!location.id) {
      locationOperations.push({ insertOne: { document: { name: location.name, branch: branchId } } });
      continue;
    }
    const current = existingById.get(location.id);
    if (!current) throw fail(400, 'Location does not belong to this branch');
    retainedIds.add(location.id);
    if (current.name !== location.name) {
      locationOperations.push({ updateOne: { filter: { _id: current._id, branch: branchId }, update: { $set: { name: location.name } } } });
    }
  }

  const removedIds = existing.filter((location) => !retainedIds.has(String(location._id))).map((location) => location._id);
  for (const removedId of removedIds) {
    const targetId = relocationByLocation.get(String(removedId));
    if (targetId && (!retainedIds.has(targetId) || !existingById.has(targetId))) {
      throw fail(400, 'Assets must be moved to a location that remains in this branch');
    }
    if (await Asset.exists({ location: removedId }).session(session)) {
      if (!targetId) throw fail(409, 'Choose a destination for assets before removing their location');
      assetOperations.push({
        updateMany: {
          filter: { location: removedId },
          update: { $set: { location: targetId } },
        },
      });
    } else if (targetId) {
      throw fail(400, 'Assets can only be moved from a location that is being removed');
    }
  }
  for (const locationId of relocationByLocation.keys()) {
    if (!removedIds.some((removedId) => String(removedId) === locationId)) {
      throw fail(400, 'Assets can only be moved from a location that is being removed');
    }
  }
  locationOperations.push(...removedIds.map((_id) => ({ deleteOne: { filter: { _id, branch: branchId } } })));
  return { locationOperations, assetOperations };
};
const saveBranchLocations = async (operations, session) => {
  if (operations?.locationOperations.length) {
    await Location.bulkWrite(operations.locationOperations, { session });
  }
  if (operations?.assetOperations.length) {
    await Asset.bulkWrite(operations.assetOperations, { session });
  }
};

// ---- Auth & role scoping -------------------------------------------------
const auth = (req, _res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').slice(7), process.env.JWT_SECRET); next(); }
  catch { next(fail(401, 'Sign in required')); }
};
const superOnly = (req, _res, next) => req.user.role === 'superadmin' ? next() : next(fail(403, 'Super admin only'));
// Operators are hard-filtered to their own branch on EVERY query.
const scope = (u) => (u.role === 'superadmin' ? {} : { branch: u.branch });
const sameBranch = (u, a) => u.role === 'superadmin' || String(a.branch) === String(u.branch);
const canAccessBranch = (u, branchId) => u.role === 'superadmin' || String(u.branch) === String(branchId);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const parseQrCode = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[0] === 'a' ? parts[1] || raw : raw;
  } catch { return raw; }
};

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = await User.findOne({ email });
  if (!u || !(await bcrypt.compare(req.body.password || '', u.passwordHash))) throw fail(401, 'Wrong email or password');
  const user = { id: u._id, name: u.name, role: u.role, branch: u.branch };
  res.json({ token: jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' }), user });
}));

app.post('/api/auth/forgot-password', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
  const transport = getMailTransport();
  const user = await User.findOne({ email }).select('_id email').lean();
  if (!user) return res.json({ message: passwordResetMessage });

  const now = new Date();
  const existing = await PasswordResetCode.findOne({ user: user._id }).select('requestedAt').lean();
  if (existing && now - existing.requestedAt < 60_000) {
    return res.json({ message: passwordResetMessage });
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await PasswordResetCode.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        codeHash: passwordResetCodeHash(user._id, code),
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        requestedAt: now,
        attempts: 0,
        challengeId: crypto.randomUUID(),
        verifiedAt: null,
        consumedAt: null,
      },
    },
    { upsert: true, new: true, runValidators: true },
  );
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: user.email,
      subject: 'Your Cosmopolitan Asset Register verification code',
      text: `COSMOPOLITAN FUNERAL HOMES\nASSET REGISTER · ACCOUNT SECURITY\n\nYour verification code is: ${code}\n\nEnter this six-digit code in the password recovery form. It expires in 10 minutes and can only be used once. Never share this code with anyone. If you did not request a password reset, you can ignore this email.`,
      html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Your verification code</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f5fa;font-family:Arial,Helvetica,sans-serif;color:#182033;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your one-time password recovery code expires in 10 minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#f3f5fa;">
      <tr>
        <td align="center" style="padding:36px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;border-collapse:separate;border-spacing:0;background-color:#ffffff;border:1px solid #e4e8f1;border-radius:18px;overflow:hidden;box-shadow:0 12px 36px rgba(28,43,78,.10);">
            <tr>
              <td align="center" style="padding:28px 24px;background-color:#344fc7;background-image:linear-gradient(120deg,#344fc7,#5572f5);">
                <p style="margin:0;color:#e3e9ff;font-size:10px;font-weight:bold;line-height:1.4;letter-spacing:2px;">COSMOPOLITAN FUNERAL HOMES</p>
                <p style="margin:7px 0 0;color:#ffffff;font-size:13px;font-weight:bold;line-height:1.4;letter-spacing:.5px;">ASSET ACCOUNT RECOVERY</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 30px 12px;">
                <p style="margin:0 0 8px;color:#5572f5;font-size:10px;font-weight:bold;line-height:1.4;letter-spacing:1.7px;">ACCOUNT RECOVERY</p>
                <h1 style="margin:0;color:#182033;font-size:24px;font-weight:700;line-height:1.3;">Verify your email</h1>
                <p style="margin:12px 0 0;color:#626d82;font-size:14px;line-height:1.7;">Use this one-time code to continue resetting your Account password.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:18px 30px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
                  <tr>
                    <td align="center" style="padding:16px 22px;border:1px solid #dce4ff;border-radius:12px;background-color:#f3f6ff;">
                      <span style="display:inline-block;color:#243b91;font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:bold;line-height:1.25;letter-spacing:9px;white-space:nowrap;">${code}</span>
                    </td>
                  </tr>
                </table>
                <p style="margin:12px 0 0;color:#8791a4;font-size:11px;line-height:1.5;">Enter the six-digit code on the recovery screen</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 30px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-radius:10px;background-color:#f6f8fc;">
                  <tr>
                    <td style="padding:13px 15px;color:#59657a;font-size:12px;line-height:1.65;">
                      <strong style="color:#26334d;">This code expires in 10 minutes</strong> and can only be used once. For your security, never share it with anyone.
                    </td>
                  </tr>
                </table>
                <p style="margin:18px 0 0;color:#7a8496;font-size:12px;line-height:1.65;">If you did not request a password reset, you can safely ignore this message. Your password will not change.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:16px 24px;border-top:1px solid #edf0f5;background-color:#fbfcfe;">
                <p style="margin:0;color:#8b94a5;font-size:10px;line-height:1.6;">Automated security message · Please do not reply</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#98a1b1;font-size:10px;line-height:1.5;">Cosmopolitan Funeral Homes · Asset Register</p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    });
  } catch (error) {
    console.error('Password reset email delivery failed:', error);
  }
  res.json({ message: passwordResetMessage });
}));

app.post('/api/auth/verify-reset-code', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
  if (!/^\d{6}$/.test(code)) throw fail(400, 'Enter the six-digit verification code.');

  const user = await User.findOne({ email }).select('_id');
  const reset = user && await PasswordResetCode.findOne({
    user: user._id,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: 5 },
    verifiedAt: null,
    consumedAt: null,
  });
  if (!user || !reset) throw fail(400, 'The verification code is invalid or expired. Request a new code.');

  const expectedHash = Buffer.from(reset.codeHash, 'hex');
  const submittedHash = Buffer.from(passwordResetCodeHash(user._id, code), 'hex');
  if (expectedHash.length !== submittedHash.length || !crypto.timingSafeEqual(expectedHash, submittedHash)) {
    await PasswordResetCode.updateOne(
      { _id: reset._id, attempts: { $lt: 5 }, verifiedAt: null, consumedAt: null },
      { $inc: { attempts: 1 } },
    );
    throw fail(400, 'The verification code is invalid or expired. Request a new code.');
  }

  const verified = await PasswordResetCode.findOneAndUpdate(
    {
      _id: reset._id,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 },
      verifiedAt: null,
      consumedAt: null,
    },
    { $set: { verifiedAt: new Date() } },
    { new: true },
  );
  if (!verified) throw fail(400, 'The verification code is invalid or expired. Request a new code.');
  const resetToken = jwt.sign(
    { purpose: 'password-reset', challengeId: verified.challengeId },
    process.env.JWT_SECRET,
    { subject: String(user._id), expiresIn: '10m' },
  );
  res.json({ resetToken });
}));

app.post('/api/auth/reset-password', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const resetToken = String(req.body.resetToken || '');
  const password = req.body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8) throw fail(400, 'Password must be at least 8 characters.');

  let claims;
  try {
    claims = jwt.verify(resetToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw fail(400, 'Verify your email code before setting a new password.');
  }
  if (claims.purpose !== 'password-reset' || typeof claims.challengeId !== 'string') {
    throw fail(400, 'Verify your email code before setting a new password.');
  }

  const user = await User.findOne({ email }).select('_id passwordHash');
  if (!user || String(user._id) !== claims.sub) {
    throw fail(400, 'Verify your email code before setting a new password.');
  }
  const claimed = await PasswordResetCode.findOneAndUpdate(
    {
      user: user._id,
      challengeId: claims.challengeId,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 },
      verifiedAt: { $ne: null },
      consumedAt: null,
    },
    { $set: { consumedAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw fail(400, 'Your verification has expired. Verify your email again.');

  user.passwordHash = await bcrypt.hash(password, 12);
  await user.save();
  await PasswordResetCode.deleteOne({ _id: claimed._id });
  res.json({ message: 'Password updated. You can now sign in.' });
}));

app.get('/api/meta', auth, wrap(async (req, res) => {
  const bf = req.user.role === 'superadmin' ? {} : { _id: req.user.branch };
  const branches = await Branch.find(bf).populate('cluster').lean();
  const locations = await Location.find(req.user.role === 'superadmin' ? {} : { branch: req.user.branch }).lean();
  const locationIds = locations.map((location) => location._id);
  const assetCounts = await Asset.aggregate([
    { $match: { location: { $in: locationIds } } },
    { $group: { _id: '$location', count: { $sum: 1 } } },
  ]);
  const countsByLocation = new Map(assetCounts.map((entry) => [String(entry._id), entry.count]));
  res.json({
    branches,
    locations: locations.map((location) => ({ ...location, assetCount: countsByLocation.get(String(location._id)) || 0 })),
    clusters: await Cluster.find({ name: { $in: CLUSTER_NAMES } }).lean(),
    statuses: STATUSES,
  });
}));

app.get('/api/admin/users', auth, superOnly, wrap(async (_req, res) => {
  res.json(await User.find().select('email name role branch').populate('branch', 'name prefix').sort('name').lean());
}));

app.post('/api/admin/branches', auth, superOnly, wrap(async (req, res) => {
  const name = req.body.name?.trim();
  const prefix = req.body.prefix?.trim().toUpperCase();
  const locations = parseBranchLocations(req.body.locations);
  if (!name || !prefix || !req.body.cluster) throw fail(400, 'Branch name, prefix, and cluster are required');
  if (!mongoose.isValidObjectId(req.body.cluster)) throw fail(400, 'Cluster not found');
  const session = await mongoose.startSession();
  let branch;
  try {
    await session.withTransaction(async () => {
      if (!await Cluster.exists({ _id: req.body.cluster, name: { $in: CLUSTER_NAMES } }).session(session)) throw fail(400, 'Select either the SOUTH or NORTH cluster');
      if (await Branch.exists({ $or: [{ name }, { prefix }] }).session(session)) throw fail(409, 'A branch with that name or prefix already exists');
      [branch] = await Branch.create([{ name, prefix, cluster: req.body.cluster }], { session });
      const locationOperations = await prepareBranchLocations(branch._id, locations || [], [], session);
      await saveBranchLocations(locationOperations, session);
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json(branch);
}));

app.put('/api/admin/branches/:id', auth, superOnly, wrap(async (req, res) => {
  const name = req.body.name?.trim();
  const prefix = req.body.prefix?.trim().toUpperCase();
  const locations = parseBranchLocations(req.body.locations);
  if (!name || !prefix || !req.body.cluster) throw fail(400, 'Branch name, prefix, and cluster are required');
  if (!mongoose.isValidObjectId(req.body.cluster)) throw fail(400, 'Cluster not found');
  const session = await mongoose.startSession();
  let branch;
  try {
    await session.withTransaction(async () => {
      if (!await Cluster.exists({ _id: req.body.cluster, name: { $in: CLUSTER_NAMES } }).session(session)) throw fail(400, 'Select either the SOUTH or NORTH cluster');
      if (await Branch.exists({ _id: { $ne: req.params.id }, $or: [{ name }, { prefix }] }).session(session)) throw fail(409, 'A branch with that name or prefix already exists');
      const locationOperations = await prepareBranchLocations(req.params.id, locations, req.body.relocations || [], session);
      branch = await Branch.findByIdAndUpdate(req.params.id, { name, prefix, cluster: req.body.cluster }, { new: true, runValidators: true, session });
      if (!branch) throw fail(404, 'Branch not found');
      await Asset.updateMany({ branch: branch._id }, { $set: { cluster: branch.cluster } }, { session });
      await saveBranchLocations(locationOperations, session);
    });
  } finally {
    await session.endSession();
  }
  res.json(branch);
}));

app.delete('/api/admin/branches/:id', auth, superOnly, wrap(async (req, res) => {
  const session = await mongoose.startSession();
  let deletedCounts;
  try {
    await session.withTransaction(async () => {
      const branch = await Branch.findById(req.params.id).session(session);
      if (!branch) throw fail(404, 'Branch not found');
      const locations = await Location.find({ branch: branch._id }).select('_id').session(session).lean();
      const locationIds = locations.map((location) => location._id);
      const users = await User.find({ branch: branch._id }).select('_id').session(session).lean();
      const userIds = users.map((user) => user._id);
      const inventorySessions = await InventorySession.find({
        $or: [{ branch: branch._id }, { createdBy: { $in: userIds } }],
      }).select('_id').session(session).lean();
      const inventorySessionIds = inventorySessions.map((inventorySession) => inventorySession._id);
      const assets = await Asset.find({
        $or: [{ branch: branch._id }, { location: { $in: locationIds } }],
      }).select('_id').session(session).lean();
      const assetIds = assets.map((asset) => asset._id);

      const deletedTransferRequests = await TransferRequest.deleteMany({
        $or: [
          { sourceBranch: branch._id },
          { destinationBranch: branch._id },
          { sourceLocation: { $in: locationIds } },
          { destinationLocation: { $in: locationIds } },
          { asset: { $in: assetIds } },
          { requestedBy: { $in: userIds } },
          { reviewedBy: { $in: userIds } },
        ],
      }).session(session);
      const deletedScans = await InventoryScan.deleteMany({
        $or: [
          { session: { $in: inventorySessionIds } },
          { asset: { $in: assetIds } },
          { scanBranch: branch._id },
          { scannedBy: { $in: userIds } },
        ],
      }).session(session);
      await PasswordResetCode.deleteMany({ user: { $in: userIds } }).session(session);
      await AlertState.deleteMany({ user: { $in: userIds } }).session(session);
      await InventorySession.deleteMany({ _id: { $in: inventorySessionIds } }).session(session);
      await Asset.deleteMany({ _id: { $in: assetIds } }).session(session);
      await Location.deleteMany({ _id: { $in: locationIds } }).session(session);
      await User.deleteMany({ _id: { $in: userIds } }).session(session);
      await branch.deleteOne({ session });
      deletedCounts = {
        assets: assetIds.length,
        locations: locationIds.length,
        users: userIds.length,
        inventorySessions: inventorySessionIds.length,
        inventoryScans: deletedScans.deletedCount,
        transferRequests: deletedTransferRequests.deletedCount,
      };
    });
  } finally {
    await session.endSession();
  }
  res.json({ deleted: true, ...deletedCounts });
}));

app.post('/api/admin/users', auth, superOnly, wrap(async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const name = req.body.name?.trim();
  const role = req.body.role;
  if (!email || !name || !req.body.password || !['superadmin', 'operator'].includes(role)) throw fail(400, 'Name, email, password, and a valid role are required');
  if (role === 'operator' && !req.body.branch) throw fail(400, 'Operators must be assigned to a branch');
  if (req.body.branch && (!mongoose.isValidObjectId(req.body.branch) || !await Branch.exists({ _id: req.body.branch }))) throw fail(400, 'Branch not found');
  const user = await User.create({ email, name, role, branch: role === 'operator' ? req.body.branch : undefined, passwordHash: await bcrypt.hash(req.body.password, 12) });
  res.status(201).json(await User.findById(user._id).select('email name role branch').populate('branch', 'name prefix').lean());
}));

app.put('/api/admin/users/:id', auth, superOnly, wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw fail(404, 'User not found');
  const email = req.body.email?.trim().toLowerCase();
  const name = req.body.name?.trim();
  const role = req.body.role;
  if (!email || !name || !['superadmin', 'operator'].includes(role)) throw fail(400, 'Name, email, and a valid role are required');
  if (role === 'operator' && !req.body.branch) throw fail(400, 'Operators must be assigned to a branch');
  if (req.body.branch && (!mongoose.isValidObjectId(req.body.branch) || !await Branch.exists({ _id: req.body.branch }))) throw fail(400, 'Branch not found');
  user.email = email; user.name = name; user.role = role; user.branch = role === 'operator' ? req.body.branch : undefined;
  if (req.body.password) user.passwordHash = await bcrypt.hash(req.body.password, 12);
  await user.save();
  res.json(await User.findById(user._id).select('email name role branch').populate('branch', 'name prefix').lean());
}));

app.delete('/api/admin/users/:id', auth, superOnly, wrap(async (req, res) => {
  if (String(req.user.id) === String(req.params.id)) throw fail(409, 'You cannot delete your own account');
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw fail(404, 'User not found');
  res.json({ deleted: true });
}));

// ---- Monthly physical inventory -----------------------------------------
const inventorySessionOut = (session) => ({
  ...session.toObject(),
  branch: session.branch?.name ? session.branch : undefined,
});
const getInventorySession = async (req, id) => {
  const session = await InventorySession.findById(id).populate('branch', 'name prefix').populate('createdBy', 'name');
  if (!session) throw fail(404, 'Inventory session not found');
  if (!canAccessBranch(req.user, session.branch._id)) throw fail(403, 'This inventory session belongs to another branch');
  return session;
};
const inventoryProgress = async (req, session) => {
  const [assets, scans] = await Promise.all([
    Asset.find({ branch: session.branch._id }).select('inventoryTag name category location status').populate('location', 'name').sort('inventoryTag').lean(),
    InventoryScan.find({ session: session._id }).populate('asset', 'inventoryTag name status branch').populate('scannedBy', 'name').sort('-createdAt').lean(),
  ]);
  const verifiedScans = new Map();
  for (const scan of scans) {
    if (scan.verified && scan.asset && !verifiedScans.has(String(scan.asset._id))) {
      verifiedScans.set(String(scan.asset._id), {
        checkedAt: scan.createdAt,
        checkedBy: scan.scannedBy?.name || 'Unknown',
      });
    }
  }
  return {
    session: inventorySessionOut(session),
    totalAssets: assets.length,
    checkedAssets: verifiedScans.size,
    assets: assets.map((asset) => {
      const verification = verifiedScans.get(String(asset._id));
      return { ...asset, checked: Boolean(verification), ...verification };
    }),
    scans,
  };
};

app.get('/api/inventory/sessions', auth, wrap(async (req, res) => {
  const branchId = req.query.branch || req.user.branch;
  if (!branchId || !mongoose.isValidObjectId(branchId)) throw fail(400, 'Select a valid branch');
  if (!canAccessBranch(req.user, branchId)) throw fail(403, 'You can only inventory your assigned branch');
  const sessions = await InventorySession.find({ branch: branchId }).populate('branch', 'name prefix').populate('createdBy', 'name').sort('-month');
  res.json(sessions.map(inventorySessionOut));
}));

app.post('/api/inventory/sessions', auth, wrap(async (req, res) => {
  const branchId = req.body.branch || req.user.branch;
  const month = req.body.month || currentMonth();
  if (!branchId || !mongoose.isValidObjectId(branchId)) throw fail(400, 'Select a valid branch');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400, 'Inventory month is invalid');
  if (!canAccessBranch(req.user, branchId)) throw fail(403, 'You can only inventory your assigned branch');
  if (!await Branch.exists({ _id: branchId })) throw fail(404, 'Branch not found');
  const session = await InventorySession.findOneAndUpdate(
    { branch: branchId, month },
    { $setOnInsert: { branch: branchId, month, createdBy: req.user.id, status: 'open' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).populate('branch', 'name prefix').populate('createdBy', 'name');
  res.status(201).json(inventorySessionOut(session));
}));

app.get('/api/inventory/sessions/:id', auth, wrap(async (req, res) => {
  const session = await getInventorySession(req, req.params.id);
  res.json(await inventoryProgress(req, session));
}));

app.post('/api/inventory/sessions/:id/lookup', auth, wrap(async (req, res) => {
  const session = await getInventorySession(req, req.params.id);
  const code = parseQrCode(req.body.code);
  if (!code) throw fail(400, 'Enter or scan a QR code');
  const asset = await Asset.findOne({ $or: [{ qrToken: code }, { inventoryTag: code }] }).populate('branch', 'name prefix').populate('location', 'name').populate('cluster', 'name').lean();
  if (!asset) return res.json({ code, outcome: 'not-found', message: 'No asset matches this QR code.' });
  if (String(asset.branch._id) !== String(session.branch._id)) return res.json({ code, outcome: 'wrong-branch', asset, message: `This asset belongs to ${asset.branch.name}, not ${session.branch.name}.` });
  if (asset.status !== 'Active') return res.json({ code, outcome: 'inactive', asset, message: `This asset is marked ${asset.status}.` });
  const existing = await InventoryScan.findOne({ session: session._id, asset: asset._id, verified: true }).sort('-createdAt').populate('scannedBy', 'name').lean();
  res.json({ code, outcome: existing ? 'duplicate' : 'ready', asset, existing, message: existing ? 'This asset was already checked in this session.' : 'Asset found. Confirm the physical asset before recording the check.' });
}));

app.post('/api/inventory/sessions/:id/scan', auth, wrap(async (req, res) => {
  const session = await getInventorySession(req, req.params.id);
  if (session.status === 'closed') throw fail(409, 'This inventory session is closed');
  if (req.body.confirmed !== true) throw fail(400, 'Confirm the physical asset before recording the check');
  const code = parseQrCode(req.body.code);
  if (!code) throw fail(400, 'Enter or scan a QR code');
  const asset = await Asset.findOne({ $or: [{ qrToken: code }, { inventoryTag: code }] }).lean();
  let outcome = 'not-found';
  let verified = false;
  if (asset) {
    const existing = await InventoryScan.findOne({ session: session._id, asset: asset._id }).lean();
    if (existing) return res.json({ outcome: existing.verified ? 'duplicate' : existing.outcome, verified: existing.verified, scan: existing });
    if (String(asset.branch) !== String(session.branch._id)) outcome = 'wrong-branch';
    else if (asset.status !== 'Active') outcome = 'inactive';
    else {
      outcome = 'verified'; verified = true;
    }
  }
  let scan;
  try {
    scan = await InventoryScan.create({ session: session._id, asset: asset?._id, code, scanBranch: session.branch._id, scannedBy: req.user.id, outcome, verified });
  } catch (error) {
    if (error?.code === 11000 && asset?._id) {
      const existing = await InventoryScan.findOne({ session: session._id, asset: asset._id }).lean();
      if (existing) return res.json({ outcome: existing.verified ? 'duplicate' : existing.outcome, verified: existing.verified, scan: existing });
    }
    throw error;
  }
  if (outcome === 'verified') await Asset.updateOne({ _id: asset._id }, { $push: { history: { at: scan.createdAt, by: req.user.name, action: 'Inventory checked', note: `${session.month} physical inventory` } } });
  res.status(201).json({ outcome, verified, scan });
}));

// ---- 1 & 2. Procurement, tagging, QR -------------------------------------
app.post('/api/assets/preview-tags', auth, superOnly, wrap(async (req, res) => {
  const quantity = Number(req.body.quantity);
  if (!mongoose.isValidObjectId(req.body.branch)) throw fail(400, 'Select a valid branch');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    throw fail(400, 'Quantity must be a whole number between 1 and 500');
  }
  const branch = await Branch.findById(req.body.branch).select('prefix');
  if (!branch) throw fail(404, 'Branch not found');
  res.json({ tags: await findAvailableAssetTags(branch, quantity) });
}));

app.post('/api/assets', auth, superOnly, wrap(async (req, res) => {
  const d = req.body;
  if (!d.name?.trim()) throw fail(400, 'Asset name is required');
  if (d.description !== undefined && typeof d.description !== 'string') throw fail(400, 'Description must be text');
  if (d.condition !== undefined && (typeof d.condition !== 'string' || d.condition.trim().length > 120)) throw fail(400, 'Condition must be 120 characters or fewer');
  const quantity = d.quantity === undefined || d.quantity === '' ? 1 : Number(d.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw fail(400, 'Quantity must be a whole number between 1 and 500');
  if (d.purchaseDate && Number.isNaN(Date.parse(d.purchaseDate))) throw fail(400, 'Purchase date is invalid');
  for (const key of ['cost', 'salvageValue']) {
    if (d[key] !== undefined && d[key] !== '' && (!Number.isFinite(Number(d[key])) || Number(d[key]) < 0)) {
      throw fail(400, `${key === 'cost' ? 'Cost' : 'Salvage value'} must be a non-negative number`);
    }
  }
  if (d.usefulLifeYears !== undefined && d.usefulLifeYears !== '' && (!Number.isFinite(Number(d.usefulLifeYears)) || Number(d.usefulLifeYears) < 1)) throw fail(400, 'Useful life must be at least 1 year');
  const branch = await Branch.findById(d.branch);
  if (!branch) throw fail(404, 'Branch not found');
  const location = await Location.findOne({ _id: d.location, branch: branch._id });
  if (!location) throw fail(400, 'Location does not belong to that branch');

  const session = await mongoose.startSession();
  let created = [];
  try {
    await session.withTransaction(async () => {
      const { branch: allocated, inventoryTags } = await allocateAssetTags(branch._id, quantity, session);
      if (!await Location.exists({ _id: location._id, branch: allocated._id }).session(session)) {
        throw fail(400, 'Location does not belong to that branch');
      }
      const qrBaseUrl = process.env.APP_URL?.replace(/\/+$/, '') || 'http://localhost:5173';
      const documents = await Promise.all(Array.from({ length: quantity }, async (_, index) => {
        const inventoryTag = inventoryTags[index];
        const qrToken = crypto.randomBytes(16).toString('hex');
        const qrUrl = `${qrBaseUrl}/a/${qrToken}`;
        const qrCodeValue = inventoryTag;
        const qrImage = await QRCode.toDataURL(qrCodeValue, { width: 400, margin: 1 });
        return {
          name: d.name.trim(),
          category: d.category?.trim(),
          description: d.description?.trim(),
          condition: 'Good',
          serialNo: index === 0 ? d.serialNo?.trim() : '',
          ...(d.purchaseDate && { purchaseDate: d.purchaseDate }),
          cost: d.cost === undefined || d.cost === '' ? 0 : Number(d.cost),
          salvageValue: d.salvageValue === undefined || d.salvageValue === '' ? 0 : Number(d.salvageValue),
          usefulLifeYears: d.usefulLifeYears === undefined || d.usefulLifeYears === '' ? 5 : Number(d.usefulLifeYears),
          location: location._id,
          branch: branch._id,
          cluster: allocated.cluster,
          inventoryTag,
          qrToken,
          qrUrl,
          qrCodeValue,
          qrImage,
          status: 'Active',
          history: [{ by: req.user.name, action: 'Registered', note: `Tagged ${inventoryTag}` }],
        };
      }));
      created = await Asset.insertMany(documents, { session, ordered: true });
    });
  } finally {
    await session.endSession();
  }
  const populated = await pop(Asset.find({ _id: { $in: created.map((asset) => asset._id) } }).sort('inventoryTag'));
  res.status(201).json(populated.length === 1 ? out(populated[0]) : populated.map(out));
}));

const createAsset = async (d, user) => {
  if (!d.name?.trim()) throw fail(400, 'Asset name is required');
  if (d.description !== undefined && typeof d.description !== 'string') throw fail(400, 'Description must be text');
  if (d.condition !== undefined && (typeof d.condition !== 'string' || d.condition.trim().length > 120)) throw fail(400, 'Condition must be 120 characters or fewer');
  if (d.purchaseDate && Number.isNaN(Date.parse(d.purchaseDate))) throw fail(400, 'Purchase date is invalid');
  if (d.cost !== undefined && d.cost !== '' && (!Number.isFinite(Number(d.cost)) || Number(d.cost) < 0)) throw fail(400, 'Cost must be a non-negative number');
  if (d.usefulLifeYears !== undefined && d.usefulLifeYears !== '' && (!Number.isFinite(Number(d.usefulLifeYears)) || Number(d.usefulLifeYears) < 1)) throw fail(400, 'Useful life must be at least 1 year');
  const branchQuery = mongoose.isValidObjectId(d.branch) ? { _id: d.branch } : { name: new RegExp(`^${String(d.branch || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
  const b = await Branch.findOne(branchQuery);
  if (!b) throw fail(400, `Branch not found: ${d.branch || '(empty)'}`);
  const locationQuery = mongoose.isValidObjectId(d.location) ? { _id: d.location } : { name: new RegExp(`^${String(d.location || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
  const loc = await Location.findOne({ ...locationQuery, branch: b._id });
  if (!loc) throw fail(400, `Location not found for ${b.name}: ${d.location || '(empty)'}`);
  const { seq } = await Branch.findByIdAndUpdate(b._id, { $inc: { seq: 1 } }, { new: true });
  const inventoryTag = `${b.prefix}-${String(seq).padStart(4, '0')}`;
  const qrToken = crypto.randomBytes(16).toString('hex');
  const qrUrl = `${process.env.APP_URL?.replace(/\/+$/, '') || 'http://localhost:5173'}/a/${qrToken}`;
  const qrCodeValue = inventoryTag;
  return Asset.create({
    name: d.name.trim(), category: d.category?.trim(), description: d.description?.trim(), condition: d.condition?.trim() || 'Good', serialNo: d.serialNo?.trim(),
    ...(d.purchaseDate && { purchaseDate: d.purchaseDate }),
    cost: d.cost === undefined || d.cost === '' ? 0 : Number(d.cost),
    salvageValue: d.salvageValue === undefined || d.salvageValue === '' ? 0 : Number(d.salvageValue),
    usefulLifeYears: d.usefulLifeYears === undefined || d.usefulLifeYears === '' ? 5 : Number(d.usefulLifeYears),
    location: loc._id, branch: b._id, cluster: b.cluster, inventoryTag, qrToken, qrUrl, qrCodeValue,
    qrImage: await QRCode.toDataURL(qrCodeValue, { width: 400, margin: 1 }),
    status: STATUSES.includes(d.status) ? d.status : 'Active',
    ...(d.disposalDate && { disposalDate: d.disposalDate }),
    history: [{ by: user.name, action: 'Imported', note: `Tagged ${inventoryTag}` }],
  });
};

app.post('/api/assets/import', auth, superOnly, wrap(async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length || rows.length > 500) throw fail(400, 'Import must contain between 1 and 500 rows');
  const errors = [];
  const prepared = [];
  let totalQuantity = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      const d = rows[i];
      if (typeof d.name !== 'string' || !d.name.trim()) throw fail(400, 'Asset name is required');
      if (!d.branch) throw fail(400, 'Branch is required');
      if (!d.location) throw fail(400, 'Location is required');
      const quantity = d.quantity === '' || d.quantity === undefined ? 1 : Number(d.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw fail(400, 'Quantity must be a whole number from 1 to 500');
      if (d.status && !STATUSES.includes(String(d.status))) throw fail(400, `Invalid status: ${d.status}`);
      if (d.description !== undefined && typeof d.description !== 'string') throw fail(400, 'Description must be text');
      if (d.condition !== undefined && (typeof d.condition !== 'string' || d.condition.trim().length > 120)) throw fail(400, 'Condition must be 120 characters or fewer');
      if (d.status === 'Disposed' && !d.disposalDate) throw fail(400, 'Disposal date is required for disposed assets');
      if (d.purchaseDate && Number.isNaN(Date.parse(d.purchaseDate))) throw fail(400, 'Purchase date is invalid');
      for (const [field, label, min] of [['cost', 'Cost', 0], ['salvageValue', 'Salvage value', 0], ['usefulLifeYears', 'Useful life', 1]]) {
        if (d[field] !== undefined && d[field] !== '' && (!Number.isFinite(Number(d[field])) || Number(d[field]) < min)) {
          throw fail(400, field === 'usefulLifeYears' ? 'Useful life must be at least 1 year.' : `Enter a valid ${label.toLowerCase()} amount.`);
        }
      }
      const branchText = String(d.branch).trim();
      const branchPattern = new RegExp(`^${branchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const branchQuery = mongoose.isValidObjectId(branchText)
        ? { _id: branchText }
        : { $or: [{ name: branchPattern }, { prefix: branchPattern }] };
      const b = await Branch.findOne(branchQuery).lean();
      if (!b) throw fail(400, `Branch "${branchText}" not found. Use a branch name or code, such as CARCAR or CCR.`);
      const locationQuery = mongoose.isValidObjectId(d.location) ? { _id: d.location } : { name: new RegExp(`^${String(d.location).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
      const location = await Location.findOne({ ...locationQuery, branch: b._id }).lean();
      if (!location) throw fail(400, `Location not found for ${d.branch}: ${d.location}`);
      if (d.status === 'Disposed' && Number.isNaN(Date.parse(d.disposalDate))) throw fail(400, 'Disposal date is invalid');
      totalQuantity += quantity;
      if (totalQuantity > 500) throw fail(400, 'You can add up to 500 assets at a time.');
      prepared.push({ data: d, quantity, branch: b, location });
    } catch (e) { errors.push(`Row ${rows[i]?.sourceRow || i + 2}: ${e.message}`); }
  }
  if (errors.length) throw fail(400, `Import stopped. ${errors.join(' | ')}`);
  const session = await mongoose.startSession();
  let createdCount = 0;
  try {
    await session.withTransaction(async () => {
      const quantityByBranch = new Map();
      for (const row of prepared) {
        const key = String(row.branch._id);
        quantityByBranch.set(key, (quantityByBranch.get(key) || 0) + row.quantity);
      }
      const allocatedBranches = new Map();
      for (const [branchId, quantity] of quantityByBranch) {
        allocatedBranches.set(branchId, await allocateAssetTags(branchId, quantity, session));
      }
      const qrBaseUrl = process.env.APP_URL?.replace(/\/+$/, '') || 'http://localhost:5173';
      const documents = [];
      for (const { data, quantity, branch: originalBranch, location } of prepared) {
        const branchId = String(originalBranch._id);
        const allocation = allocatedBranches.get(branchId);
        const branch = allocation.branch;
        if (!await Location.exists({ _id: location._id, branch: branch._id }).session(session)) {
          throw fail(400, `Location no longer belongs to ${branch.name}`);
        }
        for (let index = 0; index < quantity; index += 1) {
          const inventoryTag = allocation.inventoryTags.shift();
          const qrToken = crypto.randomBytes(16).toString('hex');
          const qrCodeValue = inventoryTag;
          documents.push({
            name: data.name.trim(),
            category: data.category?.trim(),
            description: data.description?.trim(),
            condition: data.condition?.trim() || 'Good',
            serialNo: index === 0 ? data.serialNo?.trim() : '',
            ...(data.purchaseDate && { purchaseDate: data.purchaseDate }),
            cost: data.cost === undefined || data.cost === '' ? 0 : Number(data.cost),
            salvageValue: data.salvageValue === undefined || data.salvageValue === '' ? 0 : Number(data.salvageValue),
            usefulLifeYears: data.usefulLifeYears === undefined || data.usefulLifeYears === '' ? 5 : Number(data.usefulLifeYears),
            location: location._id,
            branch: branch._id,
            cluster: branch.cluster,
            inventoryTag,
            qrToken,
            qrUrl: `${qrBaseUrl}/a/${qrToken}`,
            qrCodeValue,
            qrImage: await QRCode.toDataURL(qrCodeValue, { width: 400, margin: 1 }),
            status: data.status || 'Active',
            ...(data.status === 'Disposed' && { disposalDate: data.disposalDate }),
            history: [{ by: req.user.name, action: 'Imported', note: `Tagged ${inventoryTag}` }],
          });
        }
      }
      await Asset.insertMany(documents, { session, ordered: true });
      createdCount = documents.length;
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json({ imported: createdCount, rows: rows.length });
}));

app.put('/api/assets/:id', auth, superOnly, wrap(async (req, res) => {
  const a = await Asset.findById(req.params.id); if (!a) throw fail(404, 'Not found');
  if (a.status === 'Disposed') throw fail(409, 'Disposed assets are read-only');
  const d = req.body;
  if (!d.name?.trim()) throw fail(400, 'Asset name is required');
  if (d.description !== undefined && typeof d.description !== 'string') throw fail(400, 'Description must be text');
  if (d.condition !== undefined && (typeof d.condition !== 'string' || d.condition.trim().length > 120)) throw fail(400, 'Condition must be 120 characters or fewer');
  if (d.purchaseDate && Number.isNaN(Date.parse(d.purchaseDate))) throw fail(400, 'Purchase date is invalid');
  for (const k of ['cost', 'salvageValue']) if (d[k] !== undefined && d[k] !== '' && (!Number.isFinite(Number(d[k])) || Number(d[k]) < 0)) throw fail(400, `${k === 'cost' ? 'Cost' : 'Salvage value'} must be a non-negative number`);
  if (d.usefulLifeYears !== undefined && d.usefulLifeYears !== '' && (!Number.isFinite(Number(d.usefulLifeYears)) || Number(d.usefulLifeYears) < 1)) throw fail(400, 'Useful life must be at least 1 year');
  const b = await Branch.findById(d.branch); if (!b) throw fail(404, 'Branch not found');
  const loc = await Location.findOne({ _id: d.location, branch: b._id }); if (!loc) throw fail(400, 'Location does not belong to that branch');
  const changes = [];
  const update = (field, value, label = field) => { const old = a[field] == null ? '' : String(a[field]); const next = value == null ? '' : String(value); if (old !== next) { changes.push(`${label}: ${old || '(empty)'} → ${next || '(empty)'}`); a[field] = value; } };
  update('name', d.name.trim(), 'Name'); update('category', d.category?.trim(), 'Category'); update('description', d.description?.trim(), 'Description'); update('condition', d.condition?.trim() || 'Good', 'Condition'); update('serialNo', d.serialNo?.trim(), 'Serial number');
  update('branch', b._id, `Branch (${b.name})`); update('cluster', b.cluster, `Cluster (${(await Cluster.findById(b.cluster).select('name').lean())?.name || ''})`); update('location', loc._id, `Location (${loc.name})`);
  update('purchaseDate', d.purchaseDate || undefined, 'Purchase date');
  for (const k of ['cost', 'salvageValue', 'usefulLifeYears']) update(k, d[k] === '' || d[k] === undefined ? (k === 'cost' || k === 'salvageValue' ? 0 : 5) : Number(d[k]), k === 'usefulLifeYears' ? 'Useful life' : k === 'salvageValue' ? 'Salvage value' : 'Cost');
  if (changes.length) { a.history.push({ by: req.user.name, action: 'Asset details updated', note: changes.join('; ') }); await a.save(); }
  res.json(out(await pop(Asset.findById(a._id))));
}));

app.delete('/api/assets/:id', auth, superOnly, wrap(async (req, res) => {
  const a = await Asset.findById(req.params.id); if (!a) throw fail(404, 'Not found');
  if (a.status === 'Disposed') throw fail(409, 'Disposed assets are read-only and kept for history');
  await Asset.deleteOne({ _id: a._id });
  res.json({ deleted: true, id: a._id });
}));

app.get('/api/transfer/options', auth, wrap(async (_req, res) => {
  const [branches, locations] = await Promise.all([
   Branch.find().select('_id name').sort('name').lean(),
   Location.find().select('_id name branch').sort('name').lean(),
  ]);
  res.json({ branches, locations });
}));

const populateTransferRequest = (query) => query
  .populate({ path: 'asset', select: 'inventoryTag name status branch location', populate: { path: 'location', select: 'name' } })
  .populate('requestedBy', 'name role branch')
  .populate('sourceBranch', 'name prefix')
  .populate('sourceLocation', 'name')
  .populate('destinationBranch', 'name prefix')
  .populate('destinationLocation', 'name')
  .populate('reviewedBy', 'name');

app.get('/api/transfer-requests', auth, wrap(async (req, res) => {
  const filter = req.user.role === 'superadmin' ? {} : { requestedBy: req.user.id };
  res.json(await populateTransferRequest(TransferRequest.find(filter)).sort('-createdAt').lean());
}));

app.post('/api/transfer-requests', auth, wrap(async (req, res) => {
  const reason = String(req.body.note || '').trim();
  if (!reason) throw fail(400, 'A reason for the transfer is required');
  if (reason.length > 500) throw fail(400, 'Transfer reason cannot exceed 500 characters');
  const assetIds = req.body.assets ?? (req.body.asset ? [req.body.asset] : []);
  if (!Array.isArray(assetIds) || assetIds.length < 1 || assetIds.length > 100
    || assetIds.some((id) => !mongoose.isValidObjectId(id))
    || new Set(assetIds.map(String)).size !== assetIds.length
    || !mongoose.isValidObjectId(req.body.branch) || !mongoose.isValidObjectId(req.body.location)) {
    throw fail(400, 'Select between 1 and 100 unique assets, a destination branch, and a destination location');
  }

  const session = await mongoose.startSession();
  let createdRequests = [];
  try {
    await session.withTransaction(async () => {
      const assets = await Asset.find({ _id: { $in: assetIds } }).session(session);
      if (assets.length !== assetIds.length) throw fail(404, 'One or more selected assets were not found');
      if (assets.some((asset) => !sameBranch(req.user, asset))) throw fail(403, 'You can only transfer assets from your assigned branch');
      if (assets.some((asset) => asset.status === 'Disposed' || asset.status === 'In-Transit')) {
        throw fail(409, 'Disposed or in-transit assets cannot be transferred');
      }
      if (assets.some((asset) => String(asset.branch) === String(req.body.branch))) {
        throw fail(400, 'The destination branch must differ from every selected asset’s current branch');
      }
      if (await TransferRequest.exists({ asset: { $in: assetIds }, status: { $in: ['pending', 'approving'] } }).session(session)) {
        throw fail(409, 'A selected asset already has a transfer request awaiting approval');
      }

      const destination = await Branch.findById(req.body.branch).session(session).populate('cluster', 'name');
      if (!destination) throw fail(404, 'Destination branch not found');
      const location = await Location.findOne({ _id: req.body.location, branch: destination._id }).session(session);
      if (!location) throw fail(400, 'Location does not belong to the destination branch');

      const sourceBranches = await Branch.find({ _id: { $in: assets.map((asset) => asset.branch) } }).select('name').session(session).lean();
      const sourceLocations = await Location.find({ _id: { $in: assets.map((asset) => asset.location) } }).select('name').session(session).lean();
      const branchNames = new Map(sourceBranches.map((branch) => [String(branch._id), branch.name]));
      const locationNames = new Map(sourceLocations.map((item) => [String(item._id), item.name]));
      const requests = [];

      for (const asset of assets) {
        const sourceBranchId = asset.branch;
        const sourceLocationId = asset.location;
        const oldTag = asset.inventoryTag;
        const { inventoryTags } = await allocateAssetTags(destination._id, 1, session, asset._id);
        const [inventoryTag] = inventoryTags;

        asset.branch = destination._id;
        asset.cluster = destination.cluster._id;
        asset.location = location._id;
        asset.status = 'In-Transit';
        asset.inventoryTag = inventoryTag;
        asset.history.push({
          by: req.user.name,
          action: 'Asset transfer automatically approved',
          note: `${oldTag} · ${branchNames.get(String(sourceBranchId)) || 'Source branch'} / ${locationNames.get(String(sourceLocationId)) || 'Source location'} → ${inventoryTag} · ${destination.name} / ${location.name} · Reason: ${reason}`,
        });
        await asset.save({ session });
        requests.push({
          asset: asset._id,
          requestedBy: req.user.id,
          sourceBranch: sourceBranchId,
          sourceLocation: sourceLocationId,
          destinationBranch: destination._id,
          destinationLocation: location._id,
          note: reason,
          status: 'approved',
        });
      }
      createdRequests = await TransferRequest.insertMany(requests, { session, ordered: true });
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json(await populateTransferRequest(TransferRequest.find({ _id: { $in: createdRequests.map((request) => request._id) } })).sort('-createdAt').lean());
}));

app.post('/api/transfer-requests/:id/approve', auth, superOnly, wrap(async (req, res) => {
  const request = await TransferRequest.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { $set: { status: 'approving', reviewedBy: req.user.id, reviewedAt: new Date() } },
    { new: true },
  );
  if (!request) throw fail(409, 'This transfer request is no longer pending');

  try {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const currentRequest = await TransferRequest.findOne({ _id: request._id, status: 'approving' }).session(session);
        if (!currentRequest) throw fail(409, 'This transfer request is no longer being approved');
        const asset = await Asset.findById(currentRequest.asset).session(session);
        if (!asset) throw fail(404, 'The requested asset no longer exists');
        if (String(asset.branch) !== String(currentRequest.sourceBranch)) throw fail(409, 'The asset branch changed after this request was submitted');
        if (asset.status === 'Disposed' || asset.status === 'In-Transit') throw fail(409, 'The asset can no longer be transferred');
        const destination = await Branch.findById(currentRequest.destinationBranch).populate('cluster', 'name').session(session);
        if (!destination) throw fail(404, 'The destination branch no longer exists');
        const location = await Location.findOne({ _id: currentRequest.destinationLocation, branch: destination._id }).session(session);
        if (!location) throw fail(409, 'The destination location no longer exists');
        const [oldBranch, oldLocation] = await Promise.all([
          Branch.findById(asset.branch).select('name').session(session).lean(),
          Location.findById(asset.location).select('name').session(session).lean(),
        ]);
        const oldTag = asset.inventoryTag;
        const { inventoryTags } = await allocateAssetTags(destination._id, 1, session, asset._id);
        const [inventoryTag] = inventoryTags;

        asset.branch = destination._id;
        asset.cluster = destination.cluster._id;
        asset.location = location._id;
        asset.status = 'In-Transit';
        asset.inventoryTag = inventoryTag;
        asset.history.push({
          by: req.user.name,
          action: 'Asset transfer approved',
          note: `${oldTag} · ${oldBranch?.name || 'Unknown'} / ${oldLocation?.name || 'Unknown'} → ${inventoryTag} · ${destination.name} / ${location.name}${currentRequest.note ? ` · ${currentRequest.note}` : ''}`,
        });
        await asset.save({ session });
        currentRequest.status = 'approved';
        await currentRequest.save({ session });
      });
    } finally {
      await session.endSession();
    }
    res.json({
      request: await populateTransferRequest(TransferRequest.findById(request._id)).lean(),
      asset: out(await pop(Asset.findById(request.asset))),
    });
  } catch (error) {
    await TransferRequest.updateOne(
      { _id: request._id, status: 'approving' },
      { $set: { status: 'pending' }, $unset: { reviewedBy: 1, reviewedAt: 1 } },
    );
    throw error;
  }
}));

app.post('/api/transfer-requests/:id/reject', auth, superOnly, wrap(async (req, res) => {
  const request = await TransferRequest.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { $set: { status: 'rejected', reviewedBy: req.user.id, reviewedAt: new Date() } },
    { new: true },
  );
  if (!request) throw fail(409, 'This transfer request is no longer pending');
  res.json(await populateTransferRequest(TransferRequest.findById(request._id)).lean());
}));

app.post('/api/assets/:id/transfer', auth, superOnly, wrap(async (req, res) => {
  const a = await Asset.findById(req.params.id); if (!a) throw fail(404, 'Not found');
  if (a.status === 'Disposed') throw fail(409, 'Disposed assets are read-only');
  const reason = String(req.body.note || '').trim();
  if (!reason) throw fail(400, 'A reason for the transfer is required');
  if (reason.length > 500) throw fail(400, 'Transfer reason cannot exceed 500 characters');
  if (await TransferRequest.exists({ asset: a._id, status: { $in: ['pending', 'approving'] } })) {
    throw fail(409, 'Resolve the pending transfer request before transferring this asset');
  }
  const b = await Branch.findById(req.body.branch).populate('cluster', 'name'); if (!b) throw fail(404, 'Branch not found');
  const loc = await Location.findOne({ _id: req.body.location, branch: b._id }); if (!loc) throw fail(400, 'Location does not belong to that branch');
  if (String(a.branch) === String(b._id)) throw fail(400, 'Asset is already in this branch');
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const asset = await Asset.findById(a._id).session(session);
      if (!asset) throw fail(404, 'Not found');
      if (asset.status === 'Disposed') throw fail(409, 'Disposed assets are read-only');
      if (String(asset.branch) === String(b._id)) throw fail(400, 'Asset is already in this branch');
      if (await TransferRequest.exists({ asset: asset._id, status: { $in: ['pending', 'approving'] } }).session(session)) {
        throw fail(409, 'Resolve the pending transfer request before transferring this asset');
      }
      const destination = await Branch.findById(b._id).populate('cluster', 'name').session(session);
      if (!destination) throw fail(404, 'Branch not found');
      const location = await Location.findOne({ _id: req.body.location, branch: destination._id }).session(session);
      if (!location) throw fail(400, 'Location does not belong to that branch');
      const [oldBranch, oldLocation] = await Promise.all([
        Branch.findById(asset.branch).select('name').session(session).lean(),
        Location.findById(asset.location).select('name').session(session).lean(),
      ]);
      const oldTag = asset.inventoryTag;
      const { inventoryTags } = await allocateAssetTags(destination._id, 1, session, asset._id);
      const [inventoryTag] = inventoryTags;
      asset.branch = destination._id;
      asset.cluster = destination.cluster._id;
      asset.location = location._id;
      asset.status = 'In-Transit';
      asset.inventoryTag = inventoryTag;
      asset.history.push({ by: req.user.name, action: 'Asset transferred', note: `${oldTag} · ${oldBranch?.name || 'Unknown'} / ${oldLocation?.name || 'Unknown'} → ${inventoryTag} · ${destination.name} / ${location.name} · Reason: ${reason}` });
      await asset.save({ session });
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    throw fail(409, 'The destination asset code was taken. Please retry the transfer.');
  } finally {
    await session.endSession();
  }
  res.json(out(await pop(Asset.findById(a._id))));
}));

app.post('/api/assets/:id/receive', auth, wrap(async (req, res) => {
  const a = await Asset.findById(req.params.id); if (!a) throw fail(404, 'Not found');
  if (!sameBranch(req.user, a)) throw fail(403, 'Only the destination branch can receive this asset');
  if (a.status !== 'In-Transit') throw fail(409, 'This asset is not awaiting receipt');
  a.status = 'Active';
  a.history.push({ by: req.user.name, action: 'Asset received', note: `${a.inventoryTag} verified at destination location` });
  await a.save();
  res.json(out(await pop(Asset.findById(a._id))));
}));

app.post('/api/assets/:id/documents', auth, wrap(async (req, res) => {
  const a = await Asset.findById(req.params.id); if (!a) throw fail(404, 'Not found');
  if (!sameBranch(req.user, a)) throw fail(403, 'Outside your branch');
  if (a.status === 'Disposed') throw fail(409, 'Disposed assets are read-only');
  if (!req.body.name?.trim() || !req.body.url?.trim()) throw fail(400, 'Document name and URL are required');
  a.documents.push({ name: req.body.name.trim(), url: req.body.url.trim(), type: req.body.type?.trim(), addedBy: req.user.name });
  a.history.push({ by: req.user.name, action: 'Document added', note: req.body.name.trim() });
  await a.save();
  res.status(201).json(out(await pop(Asset.findById(a._id))));
}));

app.delete('/api/assets/:id/documents/:documentId', auth, wrap(async (req, res) => {
  const a = await Asset.findById(req.params.id); if (!a) throw fail(404, 'Not found');
  if (!sameBranch(req.user, a)) throw fail(403, 'Outside your branch');
  if (a.status === 'Disposed') throw fail(409, 'Disposed assets are read-only');
  const document = a.documents.id(req.params.documentId); if (!document) throw fail(404, 'Document not found');
  a.history.push({ by: req.user.name, action: 'Document removed', note: document.name });
  document.deleteOne();
  await a.save();
  res.json(out(await pop(Asset.findById(a._id))));
}));

app.post('/api/assets/:id/maintenance', auth, superOnly, wrap(async (req, res) => {
  const a = await Asset.findById(req.params.id); if (!a) throw fail(404, 'Not found');
  if (a.status === 'Disposed') throw fail(409, 'Disposed assets are read-only');
  const d = req.body;
  if (d.nextDue && Number.isNaN(Date.parse(d.nextDue))) throw fail(400, 'Next due date is invalid');
  if (d.performedAt && Number.isNaN(Date.parse(d.performedAt))) throw fail(400, 'Performed date is invalid');
  if (d.cost !== undefined && d.cost !== '' && (!Number.isFinite(Number(d.cost)) || Number(d.cost) < 0)) throw fail(400, 'Maintenance cost must be a non-negative number');
  if (!d.note?.trim() && !d.vendor?.trim() && !d.nextDue) throw fail(400, 'Add a maintenance note, vendor, or next due date');
  const record = {
    performedAt: d.performedAt || undefined, nextDue: d.nextDue || undefined,
    status: d.status || 'Scheduled', cost: d.cost === undefined || d.cost === '' ? 0 : Number(d.cost),
    vendor: d.vendor?.trim(), note: d.note?.trim(), by: req.user.name,
  };
  a.maintenance.push(record);
  a.history.push({ by: req.user.name, action: 'Maintenance recorded', note: [record.status, record.vendor, record.note].filter(Boolean).join(' · ') });
  await a.save();
  res.status(201).json(out(await pop(Asset.findById(a._id))));
}));

// ---- Lists, QR lookup (scan landing), metrics ----------------------------
const out = (a) => ({ ...a.toObject(), bookValue: a.bookValue() });
const pop = (q) => q.populate('branch', 'name prefix').populate('location', 'name').populate('cluster', 'name');
const assetQuery = (req) => {
  const q = { ...scope(req.user) };
  for (const k of ['status', 'location', 'branch', 'cluster']) if (req.query[k]) {
    if (k === 'branch' && req.user.role !== 'superadmin') continue;
    q[k] = req.query[k];
  }
  for (const k of ['category', 'condition']) {
    const value = String(req.query[k] || '').trim();
    if (value) q[k] = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  if (req.query.q) {
    const text = new RegExp(req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ inventoryTag: text }, { name: text }, { description: text }, { serialNo: text }];
  }
  if (req.query.purchaseFrom || req.query.purchaseTo) {
    q.purchaseDate = {};
    if (req.query.purchaseFrom) {
      q.purchaseDate.$gte = new Date(req.query.purchaseFrom);
      if (Number.isNaN(q.purchaseDate.$gte.getTime())) throw fail(400, 'Purchase start date is invalid');
    }
    if (req.query.purchaseTo) {
      q.purchaseDate.$lte = new Date(`${req.query.purchaseTo}T23:59:59.999Z`);
      if (Number.isNaN(q.purchaseDate.$lte.getTime())) throw fail(400, 'Purchase end date is invalid');
    }
    if (q.purchaseDate.$gte && q.purchaseDate.$lte && q.purchaseDate.$gte > q.purchaseDate.$lte) {
      throw fail(400, 'Purchase start date must be before the end date');
    }
  }
  return q;
};

app.get('/api/assets', auth, wrap(async (req, res) => {
  res.json((await pop(Asset.find(assetQuery(req)).sort('inventoryTag'))).map(out));
}));

app.get('/api/audit', auth, superOnly, wrap(async (req, res) => {
  const assets = await Asset.find(scope(req.user)).populate('branch', 'name').populate('location', 'name').lean().sort({ inventoryTag: 1 });
  const action = req.query.action?.trim().toLowerCase();
  const text = req.query.q?.trim().toLowerCase();
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw fail(400, 'Audit date filter is invalid');
  const rows = assets.flatMap((asset) => (asset.history || []).map((entry, index) => ({
    id: `${asset._id}-${entry._id || index}`,
    assetId: asset._id,
    qrToken: asset.qrToken,
    inventoryTag: asset.inventoryTag,
    assetName: asset.name,
    branch: asset.branch?.name || '',
    location: asset.location?.name || '',
    action: entry.action || 'Updated',
    note: entry.note || '',
    by: entry.by || 'System',
    at: entry.at,
  }))).filter((entry) => {
    const time = new Date(entry.at);
    return (!action || entry.action.toLowerCase().includes(action))
      && (!text || `${entry.inventoryTag} ${entry.assetName} ${entry.note} ${entry.by}`.toLowerCase().includes(text))
      && (!from || time >= from) && (!to || time <= to);
  }).sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json(rows);
}));

app.delete('/api/audit', auth, superOnly, wrap(async (_req, res) => {
  const result = await Asset.updateMany({}, { $set: { history: [] } });
  res.json({ cleared: true, assetsUpdated: result.modifiedCount });
}));

const csv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
app.get('/api/assets/export', auth, wrap(async (req, res) => {
  const assets = await pop(Asset.find(assetQuery(req)).sort('inventoryTag'));
  const lines = [
    ['Inventory tag', 'Name', 'Category', 'Description / Brand / Model', 'Serial number', 'Cluster', 'Branch', 'Location', 'Condition', 'Status', 'Purchase date', 'Cost', 'Salvage value', 'Useful life', 'Book value'],
    ...assets.map((a) => [a.inventoryTag, a.name, a.category, a.description, a.serialNo, a.cluster?.name, a.branch?.name, a.location?.name, a.condition, a.status, a.purchaseDate?.toISOString().slice(0, 10), a.cost, a.salvageValue, a.usefulLifeYears, a.bookValue()]),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="assets.csv"');
  res.send(lines.map((line) => line.map(csv).join(',')).join('\r\n'));
}));

app.get('/api/assets/qr/:token', auth, wrap(async (req, res) => {
  const a = await pop(Asset.findOne({ qrToken: req.params.token }));
  if (!a) throw fail(404, 'No asset for this QR code');
  if (!sameBranch(req.user, { branch: a.branch._id })) throw fail(403, 'This asset belongs to another branch');
  res.json(out(a));
}));

app.post('/api/assets/resolve-qr', auth, wrap(async (req, res) => {
  const code = parseQrCode(req.body.code);
  if (!code) throw fail(400, 'Enter or scan a QR code');
  const asset = await pop(Asset.findOne({ $or: [{ qrToken: code }, { inventoryTag: code }] }));
  if (asset && !sameBranch(req.user, { branch: asset.branch._id })) throw fail(403, 'This asset belongs to another branch');
  res.json({ asset: asset ? out(asset) : null });
}));

app.get('/api/metrics', auth, wrap(async (req, res) => {
  const active = await Asset.find({ ...scope(req.user), status: { $ne: 'Disposed' } }); // disposed excluded
  const byStatus = await Asset.aggregate([{ $match: scope(req.user) }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const maintenance = active.flatMap((a) => a.maintenance || []);
  res.json({ inService: active.length, cost: active.reduce((s, a) => s + a.cost, 0),
    bookValue: +active.reduce((s, a) => s + a.bookValue(), 0).toFixed(2), byStatus,
    maintenanceDue: maintenance.filter((x) => x.nextDue && x.status === 'Scheduled' && new Date(x.nextDue) >= today && new Date(x.nextDue) <= new Date(today.getTime() + 30 * 864e5)).length,
    maintenanceOverdue: maintenance.filter((x) => x.nextDue && x.status === 'Scheduled' && new Date(x.nextDue) < today).length });
}));

app.get('/api/dashboard', auth, wrap(async (req, res) => {
  const assets = await Asset.find(scope(req.user)).populate('cluster', 'name').populate('branch', 'name').lean();
  const by = (key) => Object.entries(assets.reduce((map, a) => { const name = a[key]?.name || 'Unassigned'; map[name] = (map[name] || 0) + 1; return map; }, {})).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const valueByBranch = Object.entries(assets.reduce((map, a) => {
    const name = a.branch?.name || 'Unassigned'; map[name] = (map[name] || 0) + (a.cost || 0); return map;
  }, {})).map(([name, value]) => ({ name, value: +value.toFixed(2) })).sort((a, b) => b.value - a.value);
  res.json({ byCluster: by('cluster'), byBranch: by('branch'), valueByBranch, byStatus: Object.entries(assets.reduce((map, a) => { map[a.status] = (map[a.status] || 0) + 1; return map; }, {})).map(([name, count]) => ({ name, count })) });
}));

const getAlerts = async (req) => {
  const assets = await Asset.find(scope(req.user)).populate('branch', 'name').populate('location', 'name').lean();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const alerts = [];
  for (const a of assets) {
    const alert = (type, level, title, detail) => alerts.push({
      id: `${a._id}:${type}`,
      level,
      title,
      detail,
      token: a.qrToken,
      branch: a.branch?.name || '',
      location: a.location?.name || '',
    });
    if (a.status === 'Damaged') alert('damaged', 'warning', 'Damaged asset', `${a.inventoryTag} · ${a.name}`);
    if (a.status === 'Missing') alert('missing', 'danger', 'Missing asset', `${a.inventoryTag} · ${a.name}`);
    if (a.status === 'Disposed') alert('disposed', 'danger', 'Disposed asset', `${a.inventoryTag} · ${a.name}`);
    if (!a.location || !a.branch || !a.name) alert('incomplete', 'warning', 'Incomplete asset record', a.inventoryTag);
    for (const [index, m] of (a.maintenance || []).entries()) {
      if (m.status === 'Scheduled' && m.nextDue && new Date(m.nextDue) < today) {
        alert(`maintenance-${m._id || index}`, 'danger', 'Overdue maintenance', `${a.inventoryTag} · due ${new Date(m.nextDue).toISOString().slice(0, 10)}`);
      }
    }
  }
  const limitedAlerts = alerts.slice(0, 100);
  const states = await AlertState.find({
    user: req.user.id,
    key: { $in: limitedAlerts.map((item) => item.id) },
  }).select('key readAt dismissedAt').lean();
  const statesByKey = new Map(states.map((state) => [state.key, state]));
  return limitedAlerts.map((item) => {
    const state = statesByKey.get(item.id);
    return { ...item, readAt: state?.readAt || null, dismissedAt: state?.dismissedAt || null };
  });
};

app.get('/api/alerts', auth, wrap(async (req, res) => {
  const alerts = await getAlerts(req);
  res.json(req.query.includeDismissed === 'true' ? alerts : alerts.filter((alert) => !alert.dismissedAt));
}));

app.post('/api/alerts/:alertId/:action', auth, wrap(async (req, res) => {
  const { alertId, action } = req.params;
  if (!['read', 'dismiss', 'restore'].includes(action)) throw fail(400, 'Unsupported alert action');
  const alert = (await getAlerts(req)).find((item) => item.id === alertId);
  if (!alert) throw fail(404, 'Alert not found');
  const filter = { user: req.user.id, key: alertId };
  if (action === 'restore') {
    await AlertState.updateOne(filter, { $unset: { dismissedAt: 1 } });
  } else {
    const update = { $set: { [action === 'read' ? 'readAt' : 'dismissedAt']: new Date() } };
    if (action === 'dismiss') update.$set.readAt = new Date();
    await AlertState.updateOne(filter, update, { upsert: true, setDefaultsOnInsert: true });
  }
  const state = await AlertState.findOne(filter).select('readAt dismissedAt').lean();
  res.json({ id: alertId, readAt: state?.readAt || null, dismissedAt: state?.dismissedAt || null });
}));

// ---- 3 & 5. Audit / status change ----------------------------------------
app.post('/api/assets/:id/audit', auth, wrap(async (req, res) => {
  const a = await Asset.findById(req.params.id); if (!a) throw fail(404, 'Not found');
  if (!sameBranch(req.user, a)) throw fail(403, 'Outside your branch');
  if (a.status === 'Disposed') throw fail(409, 'Disposed assets are read-only');
  const { locationId, status, condition, disposalDate, note } = req.body; const log = [];
  if (locationId && String(locationId) !== String(a.location)) {
    if (!(await Location.exists({ _id: locationId, branch: a.branch }))) throw fail(400, 'Location is not in this branch');
    a.location = locationId; log.push('Location updated');
  }
  if (status && status !== a.status) {
    if (!STATUSES.includes(status)) throw fail(400, 'Bad status');
    if (status === 'Disposed') { if (!disposalDate) throw fail(400, 'Disposal date is required'); a.disposalDate = disposalDate; }
    log.push(`Status ${a.status} → ${status}`); a.status = status;
  }
  if (condition !== undefined) {
    if (typeof condition !== 'string' || condition.trim().length > 120) throw fail(400, 'Condition must be 120 characters or fewer');
    const nextCondition = condition.trim();
    if (nextCondition !== a.condition) {
      log.push(`Condition ${a.condition || '(empty)'} → ${nextCondition || '(empty)'}`);
      a.condition = nextCondition;
    }
  }
  a.history.push({ by: req.user.name, action: log.join('; ') || 'Audit verified', note });
  await a.save(); res.json(out(await pop(Asset.findById(a._id))));
}));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateJwtSecret();
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(process.env.PORT || 4000, '0.0.0.0', () => console.log('API ready'));
}
