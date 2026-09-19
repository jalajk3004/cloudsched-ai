import * as fs from 'fs';
import initSqlJs from 'sql.js';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: ts-node list-sqlite-tables.ts <path-to-sqlite-file>');
  process.exit(1);
}

async function main() {
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);

  console.log(`Tables found in ${dbPath}:\n`);
  const stmt = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`);
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    console.log(`  "${row.name}"`);

    // also show that table's columns
    const colStmt = db.prepare(`PRAGMA table_info("${row.name}")`);
    const cols: string[] = [];
    while (colStmt.step()) {
      const col = colStmt.getAsObject() as any;
      cols.push(col.name);
    }
    colStmt.free();
    console.log(`    columns: ${cols.join(', ')}`);
  }
  stmt.free();
  db.close();
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
