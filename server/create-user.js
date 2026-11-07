import 'dotenv/config';
import { stdin, stdout } from 'node:process';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Branch, User } from './models.js';

const [emailInput, name, role, ...branchNameParts] = process.argv.slice(2);
const email = emailInput?.toLowerCase();
const branchName = branchNameParts.join(' ').toUpperCase();

if (!email || !name || !['superadmin', 'operator'].includes(role)) {
  console.error('Usage: node create-user.js <email> <name> <superadmin|operator> [BRANCH NAME]');
  process.exit(1);
}

const readHiddenPassword = () => new Promise((resolve, reject) => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    reject(new Error('Run this command in an interactive terminal to enter the password securely.'));
    return;
  }

  let password = '';
  let finished = false;
  stdout.write('Password (input hidden): ');
  stdin.setRawMode(true);
  stdin.resume();

  const finish = (error) => {
    if (finished) return;
    finished = true;
    stdin.removeListener('data', onData);
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\n');
    if (error) reject(error);
    else resolve(password);
  };

  const onData = (chunk) => {
    for (const character of chunk.toString('utf8')) {
      if (character === '\u0003' || character === '\u0004') {
        finish(new Error('Password entry cancelled.'));
        break;
      }
      if (character === '\r' || character === '\n') {
        finish();
        break;
      }
      if (character === '\u007f' || character === '\b') {
        password = Array.from(password).slice(0, -1).join('');
      } else {
        password += character;
      }
    }
  };

  stdin.on('data', onData);
});

const password = await readHiddenPassword();
if (Array.from(password).length < 12) {
  throw new Error('Password must be at least 12 characters.');
}

await mongoose.connect(process.env.MONGODB_URI);
try {
  let branch;
  if (role === 'operator') {
    branch = await Branch.findOne({ name: branchName });
    if (!branch) throw new Error(`Branch not found: ${branchName}`);
  }
  await User.findOneAndUpdate(
    { email },
    {
      email,
      name,
      role,
      branch: branch?._id,
      passwordHash: await bcrypt.hash(password, 12),
    },
    { upsert: true },
  );
  console.log(`Account ready: ${email} (${role}${branch ? `, ${branch.name}` : ''})`);
} finally {
  await mongoose.disconnect();
}
