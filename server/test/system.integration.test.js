import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Asset, Branch, Cluster, Location, User } from '../models.js';
import { app } from '../server.js';

const originalUri = process.env.MONGODB_URI;
const testDatabase = `asset_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
let server;
let baseUrl;
let adminToken;
let operatorAToken;
let operatorBToken;
let branchA;
let branchB;
let branchC;
let locationA;
let locationA2;
let locationB;
let assetsA = [];
let assetB;

const request = async (path, { token, method = 'GET', body, origin } = {}) => {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
};

before(async () => {
  if (!originalUri || !process.env.JWT_SECRET) {
    throw new Error('Set MONGODB_URI and JWT_SECRET in server/.env to run isolated integration tests.');
  }
  const parsedUri = new URL(originalUri);
  parsedUri.pathname = `/${testDatabase}`;
  const isolatedUri = parsedUri.toString();
  process.env.MONGODB_URI = isolatedUri;
  await mongoose.connect(isolatedUri, { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    throw new Error('Integration tests require a transaction-capable MongoDB replica set or cluster.');
  }
  await mongoose.connection.dropDatabase();

  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const passwordHash = await bcrypt.hash('Integration-Test-Password-83!', 10);
  const cluster = await Cluster.create({ name: `Integration ${suffix}` });
  branchA = await Branch.create({ name: `Test Source ${suffix}`, prefix: `SA${suffix}`, cluster: cluster._id });
  branchB = await Branch.create({ name: `Test Destination ${suffix}`, prefix: `SB${suffix}`, cluster: cluster._id });
  locationA = await Location.create({ name: 'Source Room', branch: branchA._id });
  locationA2 = await Location.create({ name: 'Second Room', branch: branchA._id });
  locationB = await Location.create({ name: 'Destination Room', branch: branchB._id });
  await User.create([
    { email: `admin-${suffix.toLowerCase()}@test.invalid`, name: 'Test Admin', role: 'superadmin', passwordHash },
    { email: `operator-a-${suffix.toLowerCase()}@test.invalid`, name: 'Operator A', role: 'operator', branch: branchA._id, passwordHash },
    { email: `operator-b-${suffix.toLowerCase()}@test.invalid`, name: 'Operator B', role: 'operator', branch: branchB._id, passwordHash },
  ]);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  }
});

test('authenticated asset-management workflows preserve scope and consistency', async (t) => {
  const suffix = branchA.name.split(' ').at(-1);
  const adminLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: `admin-${suffix.toLowerCase()}@test.invalid`, password: 'Integration-Test-Password-83!' },
  });
  const operatorALogin = await request('/auth/login', {
    method: 'POST',
    body: { email: `operator-a-${suffix.toLowerCase()}@test.invalid`, password: 'Integration-Test-Password-83!' },
  });
  const operatorBLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: `operator-b-${suffix.toLowerCase()}@test.invalid`, password: 'Integration-Test-Password-83!' },
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(operatorALogin.status, 200);
  assert.equal(operatorBLogin.status, 200);
  adminToken = adminLogin.data.token;
  operatorAToken = operatorALogin.data.token;
  operatorBToken = operatorBLogin.data.token;

  await t.test('authentication and operator branch restrictions', async () => {
    const allowedOrigin = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')[0].trim()
      : (process.env.APP_URL ? new URL(process.env.APP_URL).origin : 'http://localhost:5173');
    const trustedOrigin = await request('/meta', { token: adminToken, origin: allowedOrigin });
    const untrustedOrigin = await request('/meta', { token: adminToken, origin: 'https://untrusted.invalid' });
    assert.equal(trustedOrigin.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.equal(untrustedOrigin.headers.get('access-control-allow-origin'), null);
    assert.equal((await request('/meta')).status, 401);
    const expiredToken = jwt.sign({ id: 'expired', role: 'operator' }, process.env.JWT_SECRET, { expiresIn: -1 });
    assert.equal((await request('/meta', { token: expiredToken })).status, 401);
    const meta = await request('/meta', { token: operatorAToken });
    assert.equal(meta.status, 200);
    assert.deepEqual(meta.data.branches.map((item) => String(item._id)), [String(branchA._id)]);
    assert.equal((await request('/audit', { token: operatorAToken })).status, 403);
    assert.equal((await request('/assets', { token: operatorAToken, method: 'POST', body: {} })).status, 403);
  });

  await t.test('asset registration, QR lookup, editing, and deletion', async () => {
    const registered = await request('/assets', {
      token: adminToken,
      method: 'POST',
      body: {
        name: 'Integration Chair',
        category: 'Furniture',
        branch: String(branchA._id),
        location: String(locationA._id),
        quantity: 3,
        cost: 1250,
        usefulLifeYears: 5,
      },
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.data.length, 3);
    assetsA = registered.data;
    assert.equal(new Set(assetsA.map((asset) => asset.inventoryTag)).size, 3);
    for (const asset of assetsA) {
      assert.equal(asset.qrCodeValue, asset.inventoryTag);
      assert.match(asset.qrImage, /^data:image\/png;base64,/);
      const qrLookup = await request('/assets/resolve-qr', {
        token: operatorAToken,
        method: 'POST',
        body: { code: asset.qrToken },
      });
      assert.equal(qrLookup.status, 200);
      assert.equal(qrLookup.data.asset._id, asset._id);
      assert.equal((await request(`/assets/qr/${asset.qrToken}`, { token: operatorAToken })).status, 200);
    }

    const secondBranchAsset = await request('/assets', {
      token: adminToken,
      method: 'POST',
      body: { name: 'Destination Chair', branch: String(branchB._id), location: String(locationB._id) },
    });
    assert.equal(secondBranchAsset.status, 201);
    assetB = secondBranchAsset.data;
    assert.equal((await request(`/assets/qr/${assetB.qrToken}`, { token: operatorAToken })).status, 403);

    const edited = await request(`/assets/${assetsA[0]._id}`, {
      token: adminToken,
      method: 'PUT',
      body: {
        name: 'Edited Integration Chair',
        branch: String(branchA._id),
        location: String(locationA2._id),
        cost: 1500,
      },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.location._id, String(locationA2._id));
    assert.equal(edited.data.name, 'Edited Integration Chair');
    assert.ok(edited.data.history.some((entry) => entry.action === 'Asset details updated'));
    assetsA[0] = edited.data;

    const operatorAssets = await request('/assets', { token: operatorAToken });
    const allAssets = await request('/assets', { token: adminToken });
    assert.equal(operatorAssets.status, 200);
    assert.equal(operatorAssets.data.length, 3);
    assert.equal(allAssets.data.length, 4);
    assert.ok(operatorAssets.data.every((asset) => String(asset.branch._id) === String(branchA._id)));
    const scopedExport = await request('/assets/export', { token: operatorAToken });
    assert.equal(scopedExport.status, 200);
    assert.ok(scopedExport.data.includes('Integration Chair'));
    assert.ok(!scopedExport.data.includes('Destination Chair'));

    const removed = await request(`/assets/${assetsA[2]._id}`, { token: adminToken, method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(await Asset.exists({ _id: assetsA[2]._id }), null);
  });

  await t.test('spreadsheet import is validated, transactional, and assigns unique codes', async () => {
    const countBefore = await Asset.countDocuments();
    const invalidImport = await request('/assets/import', {
      token: adminToken,
      method: 'POST',
      body: {
        rows: [
          { name: 'Valid row', branch: branchB.prefix, location: 'Destination Room', quantity: 1 },
          { name: 'Invalid row', branch: branchB.prefix, location: 'Missing Room', quantity: 1 },
        ],
      },
    });
    assert.equal(invalidImport.status, 400);
    assert.equal(await Asset.countDocuments(), countBefore);

    const imported = await request('/assets/import', {
      token: adminToken,
      method: 'POST',
      body: {
        rows: [{
          sourceRow: 8,
          name: 'Spreadsheet Import Test',
          branch: branchB.prefix,
          location: 'Destination Room',
          quantity: 2,
          serialNo: 'IMPORT-SN-1',
          cost: 50,
        }],
      },
    });
    assert.equal(imported.status, 201);
    assert.deepEqual(imported.data, { imported: 2, rows: 1 });
    const importedAssets = await Asset.find({ name: 'Spreadsheet Import Test' }).sort('inventoryTag').lean();
    assert.equal(importedAssets.length, 2);
    assert.equal(new Set(importedAssets.map((asset) => asset.inventoryTag)).size, 2);
    assert.equal(importedAssets[0].serialNo, 'IMPORT-SN-1');
    assert.equal(importedAssets[1].serialNo, '');
    assert.ok(importedAssets.every((asset) => asset.qrCodeValue === asset.inventoryTag));
    for (const asset of importedAssets) {
      assert.equal((await request(`/assets/${asset._id}`, { token: adminToken, method: 'DELETE' })).status, 200);
    }
    assert.equal(await Asset.countDocuments({ name: 'Spreadsheet Import Test' }), 0);
  });

  await t.test('inventory QR scan, transfer batch, and destination receipt', async () => {
    const session = await request('/inventory/sessions', {
      token: operatorAToken,
      method: 'POST',
      body: { branch: String(branchA._id), month: '2026-11' },
    });
    assert.equal(session.status, 201);
    const lookup = await request(`/inventory/sessions/${session.data._id}/lookup`, {
      token: operatorAToken,
      method: 'POST',
      body: { code: assetsA[0].inventoryTag },
    });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.data.outcome, 'ready');
    const scan = await request(`/inventory/sessions/${session.data._id}/scan`, {
      token: operatorAToken,
      method: 'POST',
      body: { code: assetsA[0].inventoryTag, confirmed: true },
    });
    assert.equal(scan.status, 201);
    assert.equal(scan.data.verified, true);

    const forbiddenInventory = await request('/inventory/sessions', {
      token: operatorAToken,
      method: 'POST',
      body: { branch: String(branchB._id), month: '2026-11' },
    });
    assert.equal(forbiddenInventory.status, 403);

    const transfer = await request('/transfer-requests', {
      token: operatorAToken,
      method: 'POST',
      body: {
        assets: assetsA.slice(0, 2).map((asset) => asset._id),
        branch: String(branchB._id),
        location: String(locationB._id),
        note: 'Integration batch transfer',
      },
    });
    assert.equal(transfer.status, 201);
    assert.equal(transfer.data.length, 2);
    assert.ok(transfer.data.every((item) => item.status === 'approved'));
    assert.ok(transfer.data.every((item) => String(item.sourceBranch._id) === String(branchA._id)));
    assert.ok(transfer.data.every((item) => String(item.destinationBranch._id) === String(branchB._id)));
    const movedAssets = await request('/assets', { token: adminToken });
    const transferred = movedAssets.data.filter((asset) => assetsA.slice(0, 2).some((original) => original._id === asset._id));
    assert.equal(transferred.length, 2);
    assert.ok(transferred.every((asset) => asset.status === 'In-Transit'));
    assert.ok(transferred.every((asset) => String(asset.location._id) === String(locationB._id)));

    const deniedReceive = await request(`/assets/${transferred[0]._id}/receive`, {
      token: operatorAToken,
      method: 'POST',
      body: {},
    });
    assert.equal(deniedReceive.status, 403);
    const received = await request(`/assets/${transferred[0]._id}/receive`, {
      token: operatorBToken,
      method: 'POST',
      body: {},
    });
    assert.equal(received.status, 200);
    assert.equal(received.data.status, 'Active');

    const metrics = await request('/metrics', { token: operatorAToken });
    assert.equal(metrics.status, 200);
    assert.equal(metrics.data.inService, 0);
    const csv = await request('/assets/export', { token: operatorAToken });
    assert.equal(csv.status, 200);
    assert.ok(!csv.data.includes('Destination Chair'));
  });

  await t.test('branch/location transactions and relationship guards', async () => {
    const clusterId = String(branchA.cluster);
    const createdBranch = await request('/admin/branches', {
      token: adminToken,
      method: 'POST',
      body: { name: `Temporary Branch ${suffix}`, prefix: `SC${suffix}`, cluster: clusterId, locations: [{ name: 'Old Room' }] },
    });
    assert.equal(createdBranch.status, 201);
    branchC = createdBranch.data;
    let locations = await Location.find({ branch: branchC._id }).lean();
    assert.equal(locations.length, 1);
    const invalidUpdate = await request(`/admin/branches/${branchC._id}`, {
      token: adminToken,
      method: 'PUT',
      body: {
        name: `Should Roll Back ${suffix}`,
        prefix: `SD${suffix}`,
        cluster: clusterId,
        locations: [{ id: String(locationA._id), name: 'Foreign Room' }],
      },
    });
    assert.equal(invalidUpdate.status, 400);
    const unchangedBranch = await Branch.findById(branchC._id).lean();
    assert.equal(unchangedBranch.name, createdBranch.data.name);
    assert.equal((await Location.find({ branch: branchC._id })).length, 1);

    const updatedBranch = await request(`/admin/branches/${branchC._id}`, {
      token: adminToken,
      method: 'PUT',
      body: {
        name: `Updated Branch ${suffix}`,
        prefix: `SE${suffix}`,
        cluster: clusterId,
        locations: [{ id: String(locations[0]._id), name: 'Renamed Room' }],
      },
    });
    assert.equal(updatedBranch.status, 200);
    assert.equal((await Location.findOne({ branch: branchC._id })).name, 'Renamed Room');

    const withDestination = await request(`/admin/branches/${branchC._id}`, {
      token: adminToken,
      method: 'PUT',
      body: {
        name: updatedBranch.data.name,
        prefix: updatedBranch.data.prefix,
        cluster: clusterId,
        locations: [{ id: String(locations[0]._id), name: 'Renamed Room' }, { name: 'New Room' }],
      },
    });
    assert.equal(withDestination.status, 200);
    const destinationLocation = await Location.findOne({ branch: branchC._id, name: 'New Room' });
    const relocationAsset = await request('/assets', {
      token: adminToken,
      method: 'POST',
      body: {
        name: 'Relocation Test Asset',
        branch: String(branchC._id),
        location: String(locations[0]._id),
      },
    });
    assert.equal(relocationAsset.status, 201);
    const relocationAssetId = Array.isArray(relocationAsset.data)
      ? relocationAsset.data[0]._id
      : relocationAsset.data._id;
    const relocate = await request(`/admin/branches/${branchC._id}`, {
      token: adminToken,
      method: 'PUT',
      body: {
        name: withDestination.data.name,
        prefix: withDestination.data.prefix,
        cluster: clusterId,
        locations: [{ id: String(destinationLocation._id), name: 'New Room' }],
        relocations: [{ locationId: String(locations[0]._id), targetLocationId: String(destinationLocation._id) }],
      },
    });
    assert.equal(relocate.status, 200);
    const relocatedAsset = await Asset.findById(relocationAssetId).lean();
    assert.equal(String(relocatedAsset.location), String(destinationLocation._id));
    assert.equal(await Location.exists({ _id: locations[0]._id }), null);
    assert.equal((await request(`/assets/${relocationAssetId}`, { token: adminToken, method: 'DELETE' })).status, 200);

    const removeLocations = await request(`/admin/branches/${branchC._id}`, {
      token: adminToken,
      method: 'PUT',
      body: { name: relocate.data.name, prefix: relocate.data.prefix, cluster: clusterId, locations: [] },
    });
    assert.equal(removeLocations.status, 200);
    assert.equal(await Location.countDocuments({ branch: branchC._id }), 0);
    assert.equal((await request(`/admin/branches/${branchC._id}`, { token: adminToken, method: 'DELETE' })).status, 200);

    const protectedDelete = await request(`/admin/branches/${branchA._id}`, { token: adminToken, method: 'DELETE' });
    assert.equal(protectedDelete.status, 409);

    const adminAudit = await request('/audit', { token: adminToken });
    assert.equal(adminAudit.status, 200);
    assert.ok(adminAudit.data.some((entry) => entry.action === 'Asset transfer automatically approved' && entry.note.includes('Integration batch transfer')));
  });
});
