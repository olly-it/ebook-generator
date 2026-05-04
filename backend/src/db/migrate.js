require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./client');

async function migrate() {
  const migrations = ['001_init.sql', '002_source_image.sql'];
  for (const file of migrations) {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8');
    await pool.query(sql);
    console.log(`Applied: ${file}`);
  }
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
