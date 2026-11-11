# Office Attendance

A simple attendance app for a small office. Each employee checks in from their phone on the office WiFi. Late fines are calculated automatically. The admin approves leave, decides fines, records fine payments and gets push notifications.

- Employees: `https://office.medialinkers.pk/`
- Admin: `https://office.medialinkers.pk/admin`

There is no database. All data is saved in JSON files in the `data/` folder, which is plenty for a small team.

---

## What it does

### Install it like an app (phone or computer)
Both parts install as their own app (PWA), with an icon and their own window. No app store is needed.

- **Employees** open `office.medialinkers.pk`. **Admin** opens `office.medialinkers.pk/admin`. Each installs separately.
- Tap **Install** (on the sign-in screen, the home screen card, or Profile; for the admin, the sidebar or **More**).
  - **Android (Chrome)** and **Windows/Mac (Chrome or Edge)**: the install window opens straight away.
  - **iPhone**: Safari → Share → **Add to Home Screen**. The app shows these steps when Install is tapped.
  - **Mac Safari**: File → Add to Dock.
- Installed apps open from the home screen, desktop, taskbar or Dock, stay signed in, and show an offline screen with "Try again" when there is no internet. Long-press the icon for shortcuts (Check in, Send a request, Requests, Fines).
- Installing needs HTTPS (step 6 below). On `localhost` it works for testing.


### For employees
- **Sign in once.** The phone stays signed in (the session renews itself every time the app is opened).
- **Add to Home Screen.** It opens like a normal app.
- **Today screen:** one big button to check in or out. It shows a countdown before start time and, when late, the fine right now and when it goes up next.
- **History:** a calendar of the month. Tap any day to see times, fine and the admin's note.
- **Requests:** ask for leave (one or more days), or explain a late or missed day.
- **Fines:** see what is due and what has been paid, month by month.
- **Push notifications:** a reminder 15 minutes before start, a reminder at closing time, and alerts when the admin approves leave, changes a fine or records a payment.

### For the admin
- **Home:** who is in, late, not in yet and absent; requests waiting for a decision; fines today, this month and still unpaid.
- **Attendance:** any day, every employee. Change a fine (waive, half, full or any amount, with a note) or add or edit attendance by hand.
- **Team:** add employees, see each person's month, reset PIN or phone, deactivate.
- **Requests:** approve or reject leave and reasons. For a late-day reason, set that day's fine at the same time.
- **Fines:** for each month, see fine, paid and due for every employee. Tap **Mark paid** for a full or partial payment. Payments can be removed if entered by mistake.
- **Reports:** daily, weekly or monthly. One sheet with every employee from day 1 to the end of the month, plus who missed what. Monthly reports include paid and due. Download for Excel (CSV) or print.
- **Settings:** office hours, fines, weekly off days, holidays, office WiFi IPs, one-phone rule, announcements, password and notifications.

### Push notifications for the admin
Each one can be turned off in Settings → "Notify me about".

| Notification | When |
|---|---|
| Leave request or reason | As soon as an employee sends it |
| Late check-in | When someone checks in late (with minutes and fine) |
| Morning summary | 30 min after start: how many are in, late, on leave, and who is not in yet |
| Missed check-out | 1 hour after closing: who forgot to check out |
| Early check-out | When someone leaves before closing |
| Sign-in on a new phone | When the one-phone rule blocks someone |
| Every check-in | Off by default (can be a lot) |

Employee notifications (check-in reminder, check-out reminder, decisions, announcements) can also be switched off in Settings.

**Notifications need HTTPS** (set up below). On iPhone they only work after the app is added to the Home Screen (iOS 16.4 or newer): Safari → Share → **Add to Home Screen**, then open the app from the Home Screen and turn on notifications.

### Fine rules (default, change in Settings)
| | Fine |
|---|---|
| Check in by 9:30 | Rs 0 |
| 9:31 – 10:30 | Rs 100 |
| 10:31 – 11:30 | Rs 200 |
| Each further hour | + Rs 100 |
| Forgot to check out | Rs 100 |
| Absent without leave | Rs 500 |
| Holiday, weekly off day, approved leave | Rs 0 |

The admin can change any fine. The employee gets a notification.

### Security
- Check-in only works from the office WiFi's public IP. Mobile data and home WiFi are blocked.
- The real IP is only taken from your own Nginx, so nobody can fake the office IP.
- PINs and the password are stored hashed. 5 wrong tries lock that account for 10 minutes.
- Optional "one phone per employee" rule.
- Changing a PIN or resetting a phone signs out that employee's old sessions. Changing the admin password signs out the admin's other devices.

---

## Run on your computer

```bash
npm install
npm run seed     # demo data (6 employees). This REPLACES the data/ folder.
npm start
```

- Employee: http://localhost:3112 (demo: `EMP-101` / PIN `1234`, `EMP-102` / `2345`, `EMP-103` / `3456` …)
- Admin: http://localhost:3112/admin (`admin` / `admin123`)

Tests: `npm test`

---

## Install on office.medialinkers.pk (port 3112)

These steps are for an Ubuntu server (VPS) with Nginx. Run them as a user with `sudo`.

### 1. Point the subdomain to the server
In your DNS panel (where medialinkers.pk is managed), add an **A record**:

| Type | Name | Value |
|---|---|---|
| A | `office` | your server's IP |

If you use Cloudflare, set it to **DNS only** (grey cloud), at least while you set up HTTPS. See the note at the end if you want the orange cloud.

### 2. Install Node.js 20 and PM2 (skip if already installed)
Do this as a normal user with `sudo`, not as `root`. The app should never run as root.
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx
sudo npm install -g pm2
```

### 3. Put the app on the server
Upload this folder (without `node_modules`) to `/var/www/office-attendance`, for example with Git or `scp`. Then:
```bash
cd /var/www/office-attendance
npm install --omit=dev
cp .env.example .env
nano .env
```
In `.env`, set `JWT_SECRET` to a long random value. Make one with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Also set `ADMIN_PASSWORD` (at least 8 characters) for the first admin sign-in. If you leave it empty, the app makes a random password and saves it in `data/FIRST_ADMIN_PASSWORD.txt`; read it with `cat data/FIRST_ADMIN_PASSWORD.txt`. The file is deleted once you change the password. `PORT=3112` is already set.

Lock down the secrets so only your user can read them:
```bash
chmod 600 .env
mkdir -p data && chmod 700 data
```

Do **not** copy your local `data/` folder if it has demo data. The server creates a fresh one.

### 4. Start it and keep it running
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup     # run the command it prints, so the app starts after a reboot
```
Check it: `curl http://127.0.0.1:3112/api/status` should return JSON.

### 5. Connect the domain with Nginx
```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/office.medialinkers.pk
sudo ln -s /etc/nginx/sites-available/office.medialinkers.pk /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Turn on HTTPS (needed for notifications and phone install)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d office.medialinkers.pk
```
Certbot renews the certificate by itself.

### 7. First setup in the app
1. Open `https://office.medialinkers.pk/admin` **from the office WiFi** and sign in. If Settings shows "The server can't see your real IP", fix Nginx first (the WiFi lock depends on it).
2. Settings → **Office WiFi lock** → tap **Add my IP** → **Save settings**. Keep "Check-in only on office WiFi" on.
3. Settings → **Admin password**: change it.
4. Settings → **Notifications**: turn on "On this device", then tap **Send a test notification**.
5. Team → **Add employee** for each person. Give each one their code and PIN.
6. Ask everyone to open `https://office.medialinkers.pk`, sign in, tap **Add to Home Screen**, and turn on notifications.

### Updating later
```bash
cd /var/www/office-attendance
# copy the new files over (keep data/ and .env)
npm install --omit=dev
pm2 restart office-attendance
```

### Using cPanel instead of a VPS?
If your hosting has **Setup Node.js App** in cPanel: create an app with root `office-attendance`, startup file `server.js`, URL `office.medialinkers.pk`, Node 18 or newer. Add the `.env` values as environment variables, run "NPM install", and start it. cPanel picks the port itself, so you can ignore 3112 there. Turn on SSL for the subdomain in cPanel → SSL/TLS.

---

## Security checklist (before going live)

The app already does these by itself:
- Session secret: if `JWT_SECRET` is missing or weak, a random one is created in `data/.session_secret`. There is no built-in default anyone could know.
- First admin password: never `admin123` on the live server. The dashboard shows a red warning until it is changed.
- WiFi lock fails closed: with no office IP added, nobody can check in.
- The app listens on `127.0.0.1` only and trusts the visitor IP only from Nginx on the same server.
- Guessing is blocked: 5 wrong tries per account and IP, 20 per IP, 15 per account (from any IP), plus Nginx allows only 10 sign-in attempts per minute per IP.
- Security headers (Content Security Policy, HSTS, no framing), requests from other websites are refused, 300 API calls per minute per IP.
- PINs and passwords are hashed (PBKDF2, 120,000 rounds). Data files are readable only by the app's user.
- Push addresses must be real push services, so the server can't be tricked into calling internal addresses.
- Excel exports neutralise formulas, so a reason like `=HYPERLINK(...)` can't run in Excel.

You do these on the server:
1. **Firewall:** only SSH, HTTP and HTTPS open. Port 3112 must not be reachable from outside.
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 'Nginx Full'
   sudo ufw enable
   ```
2. **SSH:** sign in with an SSH key and turn off password login (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
3. **Automatic security updates:** `sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`
4. **Never upload** `.env`, `data/` or `.git` to a public place. Keep `chmod 600 .env` and `chmod 700 data`.
5. **HTTPS only:** let certbot redirect HTTP to HTTPS when it asks.
6. **Change the admin password** on the first sign-in, and use a long one.
7. **Optional:** in Settings, turn on "Admin panel only on office WiFi". Then even a stolen password won't work from outside.
8. **Backups** (below), and update Node.js and the app from time to time (`npm audit` should show 0 vulnerabilities).

## Good to know

**Office IP changes.** Most internet connections in Pakistan have a dynamic public IP. If employees suddenly see "You are not on the office WiFi", open the admin panel from the office and tap **Add my IP** again. A static IP from your internet provider avoids this.

**Cloudflare orange cloud.** If you turn on Cloudflare's proxy, add `IP_HEADER=cf-connecting-ip` to `.env` and restart. Only do this if the server accepts web traffic from Cloudflare only, otherwise the IP lock can be bypassed.

**Back up the data.** Everything is in `data/`:

| File | What |
|---|---|
| `employees.json` | Employees (PINs hashed) |
| `attendance.json` | Check-ins, check-outs, fine changes |
| `leaves.json` | Leave requests and reasons |
| `payments.json` | Fine payments |
| `notifications.json` | In-app notifications and announcements |
| `settings.json` | Office settings and admin password (hashed) |
| `push_subscriptions.json` | Phones and browsers with notifications on |
| `vapid.json` | Push notification keys. Keep it: if it is lost, everyone must turn notifications on again |

A simple daily backup:
```bash
crontab -e
# add this line:
0 23 * * * tar czf /var/backups/attendance-$(date +\%F).tgz -C /var/www/office-attendance data
```

**Run only one copy.** Because data is in JSON files, keep PM2 at 1 instance (already set).
