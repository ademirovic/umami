/* eslint-disable no-console */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import chalk from 'chalk';
import semver from 'semver';
import { PrismaClient } from '../generated/prisma/client.js';

const MIN_VERSION = '9.4.0';

if (process.env.SKIP_DB_CHECK) {
  console.log('Skipping database check.');
  process.exit(0);
}

const url = new URL(process.env.DATABASE_URL);

const ssl = process.env.DATABASE_CA_CERT
  ? {
    ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n'),
  }
  : undefined;

const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port) || 5432,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.slice(1)),
  ssl,
});
const adapter = new PrismaPg(pool, { schema: url.searchParams.get('schema') });

const prisma = new PrismaClient({ adapter });

function success(msg) {
  console.log(chalk.greenBright(`✓ ${msg}`));
}

function error(msg) {
  console.log(chalk.redBright(`✗ ${msg}`));
}

async function checkEnv() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined.');
  } else {
    success('DATABASE_URL is defined.');
  }

  if (process.env.REDIS_URL) {
    success('REDIS_URL is defined.');
  }
}

async function checkConnection() {
  try {
    await prisma.$connect();

    success('Database connection successful.');
  } catch (e) {
    throw new Error('Unable to connect to the database: ' + e.message);
  }
}

async function checkDatabaseVersion() {
  const query = await prisma.$queryRaw`select version() as version`;
  const version = semver.valid(semver.coerce(query[0].version));

  if (semver.lt(version, MIN_VERSION)) {
    throw new Error(
      `Database version is not compatible. Please upgrade to ${MIN_VERSION} or greater.`,
    );
  }

  success('Database version check successful.');
}

async function applyMigration() {
  if (!process.env.SKIP_DB_MIGRATION) {
    console.log('Applying database migrations...');
    try {
      // Use stdio: 'inherit' to stream the output from the command in real-time.
      // This will show detailed prisma output instead of hanging silently.
      execSync('prisma migrate deploy', { stdio: 'inherit' });
    } catch (e) {
      throw new Error(`Migration command failed: ${e.message}`);
    }

    success('Database is up to date.');
  }
}

(async () => {
  let err = false;
  for (const fn of [checkEnv, checkConnection, checkDatabaseVersion, applyMigration]) {
    try {
      await fn();
    } catch (e) {
      error(e.message);
      err = true;
    } finally {
      if (err) {
        process.exit(1);
      }
    }
  }
})();
