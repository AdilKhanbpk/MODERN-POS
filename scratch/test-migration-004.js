const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');

console.log('Testing migration 004 logic in memory...');

