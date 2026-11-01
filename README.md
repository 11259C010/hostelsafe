# HostelSafe: anti-ragging system for your hostel website

Student SOS, anonymous reports, daily check-ins, warden live dashboard, hotspot detection,
allocation check, late-night entry log, evidence trail and automatic SMS escalation.

## 1. Run it (10 minutes)
    npm install
    cp .env.example .env        # then edit .env (JWT_SECRET, phone numbers, REGISTER_CODE)
    npm run create-warden -- "Warden Name" warden@college.edu StrongPassword1
    npm start                   # open http://localhost:3000

Requires Node.js 18+. Data is stored in `safety.db` (back it up regularly).

## 2. Put it on your website (pick one)
**A. Works with ANY site (PHP, WordPress, React, anything).** Run HostelSafe on a server or
subdomain (e.g. `safety.yourhostel.com`, or `yourhostel.com/safety` via an nginx reverse proxy to
port 3000) and add a prominent link/button "Safety & Anti-Ragging" on your booking site.
Set `BASE_PATH=/` (or `/safety` if mounted in a path).

**B. Your site is Node/Express.** Copy this folder in and add one line:

    app.use("/safety", require("./hostelsafe/router"));   // needs JWT_SECRET in env

**C. Use your existing booking logins/room data.** Students currently register here with room and
floor. To reuse your booking database, change the `register` and `login` routes in `router.js` to
look up your booking table (room, floor, year) instead of asking the student to type them.
Send me your stack/table layout and I will write this part.

## 3. SMS alerts (recommended before real use)
Create a Twilio account, fill `TWILIO_*` and the `*_PHONES` lines in `.env`.
Without Twilio, alerts are only shown on the dashboard and printed in the server log.
Escalation: unanswered SOS texts the chief warden after `ESC1_SEC` and security/principal after `ESC2_SEC`.

## 4. Before going live (important)
- Use HTTPS (cookies are secure in production). Hosts like Render, Railway, or a VPS + Caddy/nginx work.
- Set a long random `JWT_SECRET` and a `REGISTER_CODE` so outsiders cannot register.
- Edit `CONTACTS`, `NIGHT`, `FLOORS` at the top of the script in `public/index.html`
  (and keep its escalation timings equal to `ESC1_SEC/ESC2_SEC`).
- Test with real phones: press SOS as a student, confirm the warden's phone and screen both react.
  Run a monthly drill. Wardens must keep the dashboard open on a device with the 🔔 alarm enabled.
- Reports store no student ID. Check-in and SOS data belong to the student account.
  Tell students clearly how their data is used, and decide who may access `safety.db`.
- The system supports your anti-ragging committee. It does not replace the UGC helpline (1800-180-5522).
