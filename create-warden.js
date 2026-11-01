// Usage: npm run create-warden -- "Name" email@college.edu StrongPassword
require("dotenv").config();
const db = require("../db"), bcrypt = require("bcryptjs");
const [name, email, pass] = process.argv.slice(2);
if (!name || !email || !pass || pass.length < 8) { console.log('Usage: npm run create-warden -- "Name" email password(8+ chars)'); process.exit(1); }
const e = email.toLowerCase(), h = bcrypt.hashSync(pass, 10);
if (db.prepare("SELECT 1 FROM users WHERE email=?").get(e)) db.prepare("UPDATE users SET name=?,pass=?,role='warden' WHERE email=?").run(name, h, e);
else db.prepare("INSERT INTO users(name,email,pass,role,room,floor,year) VALUES(?,?,?,'warden','-','-','-')").run(name, e, h);
console.log("Warden account ready:", e);
