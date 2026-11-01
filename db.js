const Database = require("better-sqlite3"), path = require("path");
const db = new Database(process.env.DB_FILE || path.join(__dirname, "safety.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, pass TEXT,
  role TEXT DEFAULT 'student', room TEXT, floor TEXT, year TEXT);
CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, room TEXT, floor TEXT,
  year TEXT, loc TEXT, t INTEGER, status TEXT DEFAULT 'open', ack_t INTEGER, res_t INTEGER, note TEXT, esc INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS alert_log(id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id INTEGER, t INTEGER, a TEXT);
-- reports deliberately have NO user_id: the reporter is not stored
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, accused TEXT, room TEXT, when_txt TEXT,
  text TEXT, status TEXT DEFAULT 'new');
CREATE TABLE IF NOT EXISTS checkins(user_id INTEGER, date TEXT, name TEXT, room TEXT, year TEXT, ok INTEGER, t INTEGER,
  done INTEGER DEFAULT 0, PRIMARY KEY(user_id, date));
CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, floor TEXT, room TEXT, t INTEGER, by_id INTEGER);
`);
module.exports = db;
