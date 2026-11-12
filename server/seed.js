import 'dotenv/config'; import mongoose from 'mongoose'; import bcrypt from 'bcryptjs';
import { Asset, Cluster, Branch, Location, User } from './models.js';
await mongoose.connect(process.env.MONGODB_URI);
try {
  const tree = {
    SOUTH: { CARCAR: 'CCR', ARGAO: 'ARG', JUNQUERA: 'JNQ', CORDOVA: 'CRD', LAPULAPU: 'LLP'},
    NORTH: { LILOAN: 'LIL', DANAO: 'DNO', BOGO: 'BGO', MARACAS: 'MRC', MANDAUE: 'MND'},
  };
  const zones = ['OFFICE', 'SHOWROOM', 'EMBALMING ROOM', 'CHAPEL A', 'CHAPEL B', 'LOBBY'];
  for (const [clusterName, branches] of Object.entries(tree)) {
    const cluster = await Cluster.findOneAndUpdate({ name: clusterName }, {}, { upsert: true, new: true });
    for (const [name, prefix] of Object.entries(branches)) {
      const branch = await Branch.findOneAndUpdate({ name }, { name, prefix, cluster: cluster._id }, { upsert: true, new: true });
      await Asset.updateMany({ branch: branch._id }, { $set: { cluster: cluster._id } });
      for (const zone of zones) await Location.findOneAndUpdate({ name: zone, branch: branch._id }, {}, { upsert: true });
    }
  }

  const legacyClusters = await Cluster.find({ name: /^METRO CEBU$/i });
  for (const cluster of legacyClusters) {
    if (await Branch.exists({ cluster: cluster._id }) || await Asset.exists({ cluster: cluster._id })) {
      throw new Error(`Cannot remove the Metro Cebu cluster while branches or assets still reference it. Reassign them to SOUTH or NORTH first.`);
    }
    await Cluster.deleteOne({ _id: cluster._id });
  }

  const ensureUser = async ({ email, passwordVariable, name, role, branch }) => {
    if (await User.exists({ email })) {
      console.log(`Preserved existing ${role} account: ${email}`);
      return;
    }
    const password = process.env[passwordVariable];
    if (!password || password.length < 12) {
      throw new Error(`${passwordVariable} must be set to a password of at least 12 characters to create ${email}.`);
    }
    await User.create({
      email,
      name,
      role,
      ...(branch ? { branch } : {}),
      passwordHash: await bcrypt.hash(password, 12),
    });
    console.log(`Created ${role} account: ${email}`);
  };

  const carcar = await Branch.findOne({ name: 'CARCAR' });
  if (!carcar) throw new Error('CARCAR branch was not available after seeding.');
  await ensureUser({
    email: 'admin@cosmopolitan.local',
    passwordVariable: 'SEED_ADMIN_PASSWORD',
    name: 'HQ Admin',
    role: 'superadmin',
  });
  await ensureUser({
    email: 'carcar@cosmopolitan.local',
    passwordVariable: 'SEED_OPERATOR_PASSWORD',
    name: 'Carcar Operator',
    role: 'operator',
    branch: carcar._id,
  });
  console.log('Seeded branches and locations. Existing accounts were not modified.');
} finally {
  await mongoose.disconnect();
}
