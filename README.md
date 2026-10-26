# Hotline

สายด่วนบริการลูกค้าผ่านแชต LINE Official Account (รองรับหลาย OA): Bot คัดกรองเรื่อง → เจ้าหน้าที่ตอบผ่านหน้าเว็บ → เปิดงาน (Job) ส่งต่อไปยังระบบอื่นผ่าน Webhook → ระบบปลายทางแจ้งสถานะกลับ → แจ้งลูกค้าใน LINE อัตโนมัติ

```
ลูกค้า (LINE) ──▶ /webhooks/line ──▶ คิว ──▶ Bot (เมนู/ฟอร์ม) ──┬──▶ สร้าง Job อัตโนมัติ ─┐
                                                              └──▶ โอนให้เจ้าหน้าที่ ──▶ Agent Console ──▶ สร้าง Job ─┤
                                                                                                                  ▼
ลูกค้า (LINE) ◀── การ์ดแจ้งสถานะ ◀── /webhooks/jobs/:id/status ◀── ระบบปลายทาง ◀── POST (HMAC + retry) ◀── Job
```

## โครงสร้าง

| โฟลเดอร์ | รายละเอียด |
|---|---|
| `web/` | แอปเดียวแบบ full-stack: **Next.js (App Router) + Ant Design** — Agent console, REST API (`src/app/api`), webhook (`src/app/webhooks`), Socket.IO และ queue worker ผ่าน custom server (`server.ts`); ตรรกะฝั่งเซิร์ฟเวอร์อยู่ที่ `src/server`, Prisma (PostgreSQL) อยู่ที่ `prisma/` |
| `desktop/` | Desktop app สำหรับเจ้าหน้าที่ (Windows, **Tauri v2**) — เปิด console จากเซิร์ฟเวอร์ แล้วเพิ่มแจ้งเตือน native, ตัวเลขบน taskbar และ system tray ดู [Desktop app](#desktop-app-windows) |
| `tools/mock-receiver/` | ระบบปลายทางจำลอง (รับงาน + กดส่งสถานะกลับ) ที่ http://localhost:4001 |
| `tools/simulate-line.js` | ยิง event LINE ปลอมเข้า API (ทดสอบได้โดยไม่ต้องมี LINE OA) |
| `docs/integration-api.md` | สเปกสำหรับทีมระบบปลายทาง |

คิวงาน (ประมวลผล event LINE, ส่งงาน, push แจ้งเตือน) เก็บใน PostgreSQL (`QueueTask` + `FOR UPDATE SKIP LOCKED`) — ไม่ต้องใช้ Redis มี retry แบบ exponential backoff

ทุกอย่างรันในโปรเซสเดียวที่พอร์ต 3000: `server.ts` สร้าง HTTP server ให้ Next.js, ผูก Socket.IO (`/inbox`) และเริ่ม queue worker (ปิดได้ด้วย `QUEUE_WORKER=false`)

## เริ่มต้น (dev)

ต้องมี Node.js 20+ และ PostgreSQL (หรือ `docker compose up -d`)

```bash
npm install
```

```bash
cp web/.env.example web/.env
```

```bash
npm run prisma:migrate -w web
```

```bash
npm run seed -w web
```

รัน 2 ส่วน (คนละ terminal):

```bash
npm run dev
```

```bash
npm run dev:mock
```

ถ้าต้องให้เข้าถึงจากภายนอก (LINE webhook จริง) รัน `npm run tunnel` เพิ่มอีก terminal — ดู [เชื่อมต่อ LINE OA จริง](#เชื่อมต่อ-line-oa-จริง)

เปิด http://localhost:3000 แล้วเข้าสู่ระบบด้วยบัญชีจาก seed (`admin@example.com` / ค่า `SEED_ADMIN_PASSWORD` ใน `web/.env`)

> หน้าเว็บและ Route Handler hot reload ได้ตามปกติ แต่ถ้าแก้โค้ดใน `web/src/server/` ที่ queue worker หรือ Socket.IO ใช้ ให้รีสตาร์ต `npm run dev`

### ทดลองโดยไม่ต้องมี LINE

OA ที่ยังไม่ได้ตั้ง Access token จะใช้ stub client (log ข้อความที่จะส่งแทนการเรียก LINE) — หลัง migrate จะมี OA `default` ให้ใช้ทดสอบได้ทันที

```bash
node tools/simulate-line.js text "สวัสดี"
```

```bash
node tools/simulate-line.js postback "action=cat&code=repair"
```

จากนั้นตอบคำถามด้วย `text ...` และยืนยันด้วย `postback "action=confirm"` — งานจะไปโผล่ที่ http://localhost:4001 กดปุ่มสถานะเพื่อส่ง callback กลับ
(ตั้ง `AUTO=1` ให้ mock receiver เปลี่ยนสถานะเองอัตโนมัติ, `FAIL=1` เพื่อทดสอบ retry)

ทดสอบ OA อื่น: ตั้ง `CHANNEL=<id ของ OA>` (ดูได้จาก Webhook URL ในหน้า “บัญชี LINE OA”) เช่น `CHANNEL=xxxx node tools/simulate-line.js text "สวัสดี"`

## เชื่อมต่อ LINE OA จริง

ทำซ้ำได้สำหรับทุก OA ที่ต้องการเชื่อม

1. สร้าง Messaging API channel ที่ [LINE Developers Console](https://developers.line.biz/console/)
2. เปิด API ให้เข้าถึงจากภายนอกด้วย HTTPS ด้วย Cloudflare quick tunnel (ต้องติดตั้ง [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) เช่น `winget install --id Cloudflare.cloudflared` — ไม่ต้องมีบัญชี Cloudflare)

   ```bash
   npm run tunnel
   ```

   สคริปต์จะได้ URL แบบ `https://xxxx.trycloudflare.com` และเขียน `PUBLIC_BASE_URL` ลง `web/.env` ให้อัตโนมัติ จากนั้นรัน (หรือรีสตาร์ต) `npm run dev`
   (ใช้สร้าง Webhook URL, URL รูปภาพที่เจ้าหน้าที่ส่ง และ Callback URL ของระบบปลายทาง)
   > URL เปลี่ยนทุกครั้งที่รัน `npm run tunnel` ใหม่ — ต้องอัปเดต Webhook URL ใน LINE Developers Console (และ URL ใน Auth0 ถ้าใช้) ทุกครั้ง
   > ใช้ ngrok แทนได้: `ngrok http 3000` แล้วตั้ง `PUBLIC_BASE_URL=https://xxxx.ngrok-free.app` เอง
3. ในหน้า **ผู้ดูแลระบบ → บัญชี LINE OA** กด “เพิ่ม LINE OA” (หรือแก้ OA `default`) ใส่ **Channel secret** และ **Channel access token (long-lived)** แล้วกด “ทดสอบ”
4. คัดลอก **Webhook URL** ของ OA นั้น (`https://xxxx.trycloudflare.com/webhooks/line/<id>`) ไปใส่ที่ Messaging API → Webhook URL กด Verify และเปิด **Use webhook**
5. ใน LINE Official Account Manager ปิด **Auto-reply messages** และ **Greeting messages** (ให้ Bot ของระบบตอบแทน)
6. ในหน้า **เจ้าหน้าที่** เลือก “LINE OA ที่ดูแล” ให้เจ้าหน้าที่แต่ละคน — เจ้าหน้าที่เห็นเฉพาะแชต งาน และรายงานของ OA ที่ได้รับ (ผู้ดูแลระบบเห็นทุก OA)

> ระบบเดิมที่ตั้ง `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` ไว้ใน `web/.env` ยังใช้ได้: ตอนเริ่มระบบจะคัดลอกค่าเข้า OA `default` ให้อัตโนมัติ (ถ้ายังว่าง) และ URL เดิม `/webhooks/line` ยังส่งเข้า OA `default`

**หลาย OA** — หมวดเรื่อง ฟอร์ม และระบบปลายทางใช้ร่วมกันทุก OA; แต่ละ OA ตั้งข้อความทักทายและข้อความโอนเจ้าหน้าที่ของตัวเองได้ (ว่าง = ใช้ค่าจาก “ตั้งค่าข้อความ”); ลูกค้าคนเดียวกันที่แชตเข้าหลาย OA จะถูกแยกเป็นคนละรายชื่อ เพราะ LINE userId ต่างกันตาม provider

## เข้าสู่ระบบด้วย Auth0 (ไม่บังคับ)

ใช้คู่กับการเข้าสู่ระบบด้วยอีเมล/รหัสผ่านเดิม — ปุ่ม “เข้าสู่ระบบด้วย Auth0” จะแสดงเมื่อตั้งค่า `AUTH0_*` ครบ

1. ที่ [Auth0 Dashboard](https://manage.auth0.com/) สร้าง Application แบบ **Regular Web Application**
2. ตั้ง **Allowed Callback URLs** = `{PUBLIC_BASE_URL}/api/auth/auth0/callback` และ **Allowed Logout URLs** = `{PUBLIC_BASE_URL}/login` (เช่น `http://localhost:3000/api/auth/auth0/callback`)
3. คัดลอก Domain, Client ID และ Client Secret ไปใส่ `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` ใน `web/.env` แล้วรีสตาร์ต `npm run dev`
4. ในหน้า **เจ้าหน้าที่** เพิ่มเจ้าหน้าที่ด้วย **อีเมลเดียวกับใน Auth0** (เว้นรหัสผ่านว่างได้ถ้าจะให้เข้าด้วย Auth0 อย่างเดียว)

เฉพาะบัญชีที่ผู้ดูแลระบบสร้างไว้เท่านั้นที่เข้าได้ — เข้าด้วย Auth0 ครั้งแรกระบบจับคู่ด้วยอีเมลที่ยืนยันแล้ว แล้วผูกบัญชีกับ Auth0 user id (ขึ้นแท็ก “Auth0” ในหน้าเจ้าหน้าที่) ครั้งต่อไปใช้ user id แม้อีเมลใน Auth0 จะเปลี่ยน; อีเมลที่ไม่มีในระบบหรือบัญชีที่ปิดใช้งานจะเข้าไม่ได้ แนะนำให้ปิด Sign up ของ connection ใน Auth0 ด้วย
สิทธิ์ (ผู้ดูแล/เจ้าหน้าที่) และ LINE OA ที่ดูแลยังกำหนดในหน้าเจ้าหน้าที่เหมือนเดิม; ออกจากระบบจะออกจาก Auth0 ด้วย

## Desktop app (Windows)

แอปสำหรับเจ้าหน้าที่ที่เปิด Agent Console จากเซิร์ฟเวอร์ที่ deploy ไว้ (ไม่ได้รันเซิร์ฟเวอร์ในเครื่อง) สิ่งที่เพิ่มจากการเปิดผ่านเบราว์เซอร์:

- **แจ้งเตือน Windows** เมื่อลูกค้าส่งข้อความใหม่ (ไม่แจ้งถ้ากำลังดูหน้าต่างอยู่) กดที่แจ้งเตือนแล้วจะเปิดแชตนั้น
- **ตัวเลขเรื่องรอรับ** บนไอคอน taskbar และจุดแดงบนไอคอน tray (ตัวเลขเดียวกับ badge “กล่องแชต”) ไอคอน taskbar กะพริบเมื่อมีเรื่องเข้าคิวเพิ่ม
- **System tray**: กดปิดหน้าต่างแล้วแอปยังทำงานต่อใน tray คลิกไอคอนเพื่อเปิด/ซ่อน เมนูมี “เปลี่ยนเซิร์ฟเวอร์…” และ “ออก”
- ลิงก์รูป/ไฟล์ในแชตเปิดในเบราว์เซอร์ปกติ; เข้าสู่ระบบด้วย Auth0 ได้ภายในแอป

เปิดครั้งแรกจะถามแค่ **Server URL** (เช่น `https://hotline.example.com`) แอปจะตรวจกับ `/health` ก่อนบันทึก (เก็บที่ `%APPDATA%\com.hotline.desktop\config.json`) แอปอนุญาตให้เฉพาะหน้าเว็บจาก URL นั้นเรียกคำสั่งแจ้งเตือน/ตัวเลขได้
ฟีเจอร์แจ้งเตือนและตัวเลขต้องใช้เว็บเวอร์ชันที่มี `web/src/lib/desktop.ts` — deploy เว็บใหม่ก่อนแจกแอป

ต้องมี [Rust](https://rustup.rs/) และ Visual Studio Build Tools (workload “Desktop development with C++”)

```bash
npm run dev:desktop
```

สร้างตัวติดตั้ง (ได้ไฟล์ `desktop/src-tauri/target/release/bundle/nsis/Hotline_<version>_x64-setup.exe` ติดตั้งแบบรายผู้ใช้ ไม่ต้องใช้สิทธิ์ admin):

```bash
npm run build:desktop
```

ตั้ง `HOTLINE_SERVER_URL=https://...` ตอน build เพื่อเติม URL เริ่มต้นในหน้าตั้งค่าให้เจ้าหน้าที่ แก้โลโก้ที่ `web/src/app/icon.svg` แล้วรัน `npm run icons -w desktop` เพื่อสร้างไอคอนแอป/badge ใหม่

> ข้อจำกัด: installer ยังไม่ได้ sign (Windows SmartScreen จะเตือนตอนติดตั้งครั้งแรก — กด “More info → Run anyway”); ตอน `dev:desktop` แจ้งเตือนจะขึ้นชื่อ “Windows PowerShell” เพราะยังไม่ได้ติดตั้งแอป

## การทำงานหลัก

- **Bot** — เมนู Quick Reply ตามหมวดเรื่อง → ถามทีละคำถาม (ข้ามคำถามที่ไม่บังคับได้) → สรุปให้ยืนยัน
  - หมวดที่เปิด “Bot สร้างงานอัตโนมัติ” + มีระบบปลายทาง: สร้างและส่งงานทันที แจ้งเลขงานให้ลูกค้า
  - หมวดอื่น: โอนเข้าคิวเจ้าหน้าที่ พร้อมข้อมูลที่เก็บมา
  - คีย์เวิร์ด: `เมนู`, `ติดตามงาน`, `คุยกับเจ้าหน้าที่`, `ยกเลิก`
- **Inbox** — แท็บรอรับเรื่อง/ของฉัน/Bot/ทั้งหมด/ปิดแล้ว, กรองตาม LINE OA, อัปเดตเรียลไทม์, ตอบข้อความ/รูป, ข้อความสำเร็จรูป, ตอบแชตในคิวจะรับเรื่องให้อัตโนมัติ, ผู้ดูแลมอบหมายงานได้, `AUTO_ASSIGN=true` เพื่อกระจายงานให้เจ้าหน้าที่ที่ออนไลน์ ดูแล OA นั้น และงานน้อยที่สุด
- **Jobs** — เลขที่ `JOB-YYYYMM-NNNN`, ไทม์ไลน์สถานะ, ส่งซ้ำเมื่อส่งไม่สำเร็จ
- **ระบบปลายทาง** — หลายระบบ, header เพิ่มเติม, timeout, ทดสอบ ping, สร้าง secret ใหม่
- **แจ้งสถานะ** — การ์ด Flex ใน LINE ทุกครั้งที่สถานะเปลี่ยน (แก้ข้อความได้)
- **รายงาน** — จำนวนแชต/งาน, งานตามหมวด/สถานะ, เวลาตอบครั้งแรกเฉลี่ย

## ทดสอบ

ใช้ Vitest

```bash
npm test -w web
```

```bash
npm run test:e2e -w web
```

e2e เรียก Route Handler โดยตรงด้วย `Request` และใช้ฐานข้อมูล `TEST_DATABASE_URL` (ค่าเริ่มต้น `postgresql://postgres:postgres@localhost:5432/linecc_test`) — จะล้างข้อมูลในฐานนั้นทุกครั้ง

## Production checklist

- ตั้ง `JWT_SECRET` ใหม่ และใช้ HTTPS (console, API และ webhook อยู่ origin เดียวกัน ไม่ต้องตั้ง CORS)
- `npm run build` (next build + bundle `server.ts` เป็น `web/dist/server.js`) แล้วรัน `npm start` — โปรเซสเดียวเสิร์ฟทุกอย่าง ไม่ต้องตั้ง proxy แยก
- `npm run prisma:deploy -w web` ตอน deploy
- ไม่รองรับ serverless (เช่น Vercel) เพราะต้องมี Socket.IO และ queue worker ทำงานตลอด
- ไฟล์สื่ออยู่ที่ `web/uploads/` (เสิร์ฟสาธารณะที่ `/media` ด้วยชื่อไฟล์สุ่ม) — สำรองข้อมูลหรือย้ายไป object storage
- รันได้หลาย instance (คิวใช้ row lock) แต่ Socket.IO ต้องใช้ sticky session หรือ adapter และสถานะออนไลน์ (ใช้กับ `AUTO_ASSIGN`) แยกตาม instance
- บัญชี admin แรก: ตั้ง `ADMIN_EMAIL` / `ADMIN_PASSWORD` ระบบจะสร้างให้ตอนเริ่มเมื่อฐานข้อมูลยังไม่มีผู้ใช้ (ไม่ต้องรัน seed ซึ่งสร้างข้อมูลตัวอย่างด้วย)

## Deploy ด้วย Docker / Coolify

`Dockerfile` ที่ root build ทั้งระบบเป็น image เดียว (พอร์ต 3000) ตอนเริ่ม container จะรัน `prisma migrate deploy` ก่อนแล้วจึงสตาร์ตเซิร์ฟเวอร์ มี `HEALTHCHECK` ที่ `/health` และเก็บไฟล์สื่อที่ `/app/web/uploads` (ต้อง mount volume)

**แบบที่ 1 — Docker Compose (app + Postgres ใน resource เดียว)**

1. Coolify → New Resource → Git repository → Build Pack **Docker Compose**
2. Docker Compose Location: `/docker-compose.coolify.yml`
3. แท็บ Environment Variables: กรอก `ADMIN_EMAIL`, `ADMIN_PASSWORD` (ค่า `SERVICE_PASSWORD_*` สร้างให้อัตโนมัติ, Auth0 เว้นว่างได้)
4. ตั้ง Domain ของ service `app` (เช่น `https://chat.example.com`) — `PUBLIC_BASE_URL` อ้างจาก `SERVICE_URL_APP` จึงเปลี่ยนตาม domain นี้ ตรวจในแท็บ env ว่าเป็น URL https ที่ถูกต้องก่อน deploy
5. Deploy แล้วเข้าสู่ระบบด้วย `ADMIN_EMAIL` → เพิ่ม LINE OA ที่หน้า "บัญชี LINE OA" แล้วนำ Webhook URL ที่แสดงไปตั้งใน LINE Developers

volume `pgdata` และ `uploads` ถูกเก็บถาวร — ตั้ง backup ของ Postgres เองหรือใช้แบบที่ 2

**แบบที่ 2 — Dockerfile + Postgres ที่ Coolify จัดการ (มี backup ในตัว)**

1. สร้าง PostgreSQL 16 ใน Coolify แล้วคัดลอก internal connection URL
2. New Resource → Git repository → Build Pack **Dockerfile**, Ports Exposes `3000`, ตั้ง Domain
3. Persistent Storage: volume mount ที่ `/app/web/uploads`
4. Environment Variables: `DATABASE_URL` (จากข้อ 1), `PUBLIC_BASE_URL` (= domain แบบ https), `JWT_SECRET` (สุ่มยาว ๆ), `ADMIN_EMAIL`, `ADMIN_PASSWORD` และค่าอื่นตาม `web/.env.example` ตามต้องการ
5. Healthcheck: path `/health` port `3000`

ทดสอบ image ในเครื่อง: `docker build -t hotline .`
