
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');
const tests = JSON.parse(fs.readFileSync(__dirname + '/trate_tests.json', 'utf8'));
function pick(cols, names) { return names.find(n => cols.includes(n)); }
async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'khuntest_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'khuntest_lab'
  });
  const [tables] = await conn.query("SHOW TABLES LIKE 'tests'");
  if (!tables.length) {
    await conn.query(`CREATE TABLE tests (id INT AUTO_INCREMENT PRIMARY KEY, test_name VARCHAR(255) NOT NULL UNIQUE, price DECIMAL(10,2) NOT NULL DEFAULT 0, category VARCHAR(100) DEFAULT 'Lab Test', is_active TINYINT(1) DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  }
  const [columns] = await conn.query("SHOW COLUMNS FROM tests");
  const cols = columns.map(c => c.Field);
  const nameCol = pick(cols, ['test_name','name','title','testName']);
  const priceCol = pick(cols, ['price','rate','amount','test_rate','mrp']);
  const categoryCol = pick(cols, ['category','test_category','type']);
  const activeCol = pick(cols, ['is_active','active','status']);
  if (!nameCol || !priceCol) throw new Error('Could not detect tests table columns. Found: ' + cols.join(', '));
  let inserted=0, updated=0;
  for (const t of tests) {
    const [existing] = await conn.query(`SELECT ${nameCol} FROM tests WHERE ${nameCol} = ? LIMIT 1`, [t.test_name]);
    if (existing.length) {
      const setParts=[`${priceCol} = ?`]; const params=[t.rate];
      if (categoryCol) { setParts.push(`${categoryCol} = ?`); params.push(t.category); }
      if (activeCol) { setParts.push(`${activeCol} = ?`); params.push(1); }
      params.push(t.test_name);
      await conn.query(`UPDATE tests SET ${setParts.join(', ')} WHERE ${nameCol} = ?`, params);
      updated++;
    } else {
      const insCols=[nameCol,priceCol], qs=['?','?'], params=[t.test_name,t.rate];
      if (categoryCol) { insCols.push(categoryCol); qs.push('?'); params.push(t.category); }
      if (activeCol) { insCols.push(activeCol); qs.push('?'); params.push(1); }
      await conn.query(`INSERT INTO tests (${insCols.join(', ')}) VALUES (${qs.join(', ')})`, params);
      inserted++;
    }
  }
  console.log(`Imported tests complete. Inserted: ${inserted}, Updated: ${updated}, Total: ${tests.length}`);
  await conn.end();
}
main().catch(err => { console.error(err); process.exit(1); });
