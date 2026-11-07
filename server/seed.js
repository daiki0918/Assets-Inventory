import 'dotenv/config'; import mongoose from 'mongoose'; import bcrypt from 'bcryptjs';
import { Cluster, Branch, Location, User } from './models.js';
await mongoose.connect(process.env.MONGODB_URI);
try {
  const tree = {
    SOUTH: { CARCAR: 'CCR', ARGAO: 'ARG' },
    'METRO CEBU': { JUNQUERA: 'JNQ', MARACAS: 'MRC', CORDOVA: 'CRD', LAPULAPU: 'LLP', MANDAUE: 'MND' },
    NORTH: { LILOAN: 'LIL', DANAO: 'DNO', BOGO: 'BGO' },
  };
  const zones = ['OFFICE', 'SHOWROOM', 'EMBALMING ROOM', 'CHAPEL A', 'CHAPEL B', 'LOBBY'];
  for (const [clusterName, branches] of Object.entries(tree)) {
    const cluster = await Cluster.findOneAndUpdate({ name: clusterName }, {}, { upsert: true, new: true });
    for (const [name, prefix] of Object.entries(branches)) {
      const branch = await Branch.findOneAndUpdate({ name }, { name, prefix, cluster: cluster._id }, { upsert: true, new: true });
      for (const zone of zones) await Location.findOneAndUpdate({ name: zone, branch: branch._id }, {}, { upsert: true });
    }
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
