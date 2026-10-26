# Integration API — สำหรับระบบปลายทางที่รับงาน (Job)

ระบบ Hotline จะส่งงานไปยังระบบของคุณผ่าน HTTP POST และรอรับการแจ้งสถานะกลับผ่าน Callback URL
ทั้งสองทิศทางยืนยันตัวตนด้วย **HMAC-SHA256** โดยใช้ `secret` ของ Integration นั้น (ดู/สร้างใหม่ได้ที่หน้า *ระบบปลายทาง*)

```
Hotline ──POST {endpointUrl}──────────────▶ ระบบของคุณ      (สร้างงาน)
Hotline ◀──POST {callbackUrl}────────────── ระบบของคุณ      (แจ้งสถานะ)
                │
                └─▶ แจ้งลูกค้าใน LINE อัตโนมัติ
```

## 1. รับงาน (Hotline → ระบบของคุณ)

`POST {endpointUrl}`

| Header | ค่า |
|---|---|
| `Content-Type` | `application/json` |
| `X-Signature` | `sha256=` + hex(HMAC-SHA256(raw body, secret)) |
| `Idempotency-Key` | `job.id` — ส่งซ้ำได้เมื่อ retry ให้ใช้ค่านี้กันสร้างงานซ้ำ |
| *(อื่น ๆ)* | Header เพิ่มเติมที่ตั้งไว้ใน Integration เช่น `Authorization` |

ตัวอย่าง body:

```json
{
  "event": "job.created",
  "job": {
    "id": "118f7b3b-552e-4920-9473-7bae4ff70599",
    "number": "JOB-202610-0001",
    "title": "แจ้งซ่อม",
    "detail": "เรื่อง: แจ้งซ่อม\n• สถานที่: อาคาร 3 ชั้น 2 ห้อง 204\n• อาการ: แอร์ไม่เย็น",
    "priority": "NORMAL",
    "category": { "code": "repair", "name": "แจ้งซ่อม" },
    "data": { "location": "อาคาร 3 ชั้น 2 ห้อง 204", "detail": "แอร์ไม่เย็น", "phone": "0812345678" },
    "createdAt": "2026-10-21T12:34:56.000Z"
  },
  "customer": {
    "id": "c1d2...",
    "lineUserId": "U4af4980629...",
    "displayName": "สมชาย",
    "phone": "0812345678"
  },
  "channel": { "id": "default", "name": "LINE OA หลัก", "basicId": "@123abcde" },
  "callbackUrl": "https://cc.example.com/webhooks/jobs/<integrationId>/status"
}
```

`priority`: `LOW` | `NORMAL` | `HIGH` | `URGENT` · `job.data` คือคำตอบจากฟอร์มของหมวดเรื่อง (key ตามที่ตั้งในหน้าหมวดเรื่อง)
· `channel` คือ LINE OA ที่ลูกค้าติดต่อเข้ามา (ระบบรองรับหลาย OA; `basicId` เป็น `null` ถ้ายังไม่ได้กดทดสอบ OA ในหน้าแอดมิน) — `customer.lineUserId` ไม่ซ้ำกันเฉพาะภายใน OA/provider เดียวกัน

### การตอบกลับ

- ตอบ **2xx** = รับงานแล้ว → งานเปลี่ยนเป็น `SENT` และลูกค้าได้รับแจ้ง
- ตอบ JSON ได้ (ไม่บังคับ):
  ```json
  { "externalRef": "WO-2026-00123", "status": "ACCEPTED" }
  ```
  `externalRef` = เลขงานในระบบของคุณ (แสดงในหน้างานและค้นหาได้) · `status` = ถ้ารับเรื่องทันทีสามารถส่ง `ACCEPTED`/`IN_PROGRESS` มาได้เลย
- ตอบ non-2xx หรือ timeout → ระบบ **retry** แบบ exponential backoff (ค่าเริ่มต้น 5 ครั้ง: 2s, 4s, 8s, 16s) ถ้ายังไม่สำเร็จงานจะเป็น `FAILED` และเจ้าหน้าที่กด “ส่งงานอีกครั้ง” ได้

### Ping

ปุ่ม “ทดสอบ” จะส่ง `{"event":"ping","sentAt":"..."}` พร้อมลายเซ็นเดียวกัน ให้ตอบ 2xx

## 2. แจ้งสถานะกลับ (ระบบของคุณ → Hotline)

`POST {callbackUrl}` — ใช้ URL จาก `callbackUrl` ใน payload (หรือดูได้ที่หน้า *ระบบปลายทาง*)

| Header | ค่า |
|---|---|
| `Content-Type` | `application/json` |
| `X-Signature` | `sha256=` + hex(HMAC-SHA256(raw body, secret)) |

```json
{
  "jobId": "118f7b3b-552e-4920-9473-7bae4ff70599",
  "status": "IN_PROGRESS",
  "externalRef": "WO-2026-00123",
  "note": "ช่างกำลังเดินทาง",
  "data": { "technician": "สมศักดิ์" }
}
```

- ระบุงานด้วย `jobId` **หรือ** `number`
- `status`: `ACCEPTED` | `IN_PROGRESS` | `DONE` | `REJECTED`
- `note` จะแสดงในไทม์ไลน์งาน และใช้แทน `{note}` ในข้อความแจ้งลูกค้า (เช่น เหตุผลที่ REJECTED)

### ลำดับสถานะที่อนุญาต

```
SENT ──▶ ACCEPTED ──▶ IN_PROGRESS ──▶ DONE
  │          │             │
  └──────────┴─────────────┴──────▶ REJECTED
```

ข้ามขั้นได้ (เช่น `SENT → DONE`) แต่ย้อนกลับไม่ได้ · `DONE`/`REJECTED` เป็นสถานะสุดท้าย

| Response | ความหมาย |
|---|---|
| `200` | สำเร็จ `{ "ok": true, "jobId", "number", "status" }` |
| `200` (สถานะเดิม) | บันทึก note เพิ่มในไทม์ไลน์ ไม่แจ้งลูกค้าซ้ำ |
| `400` | body ไม่ถูกต้อง / status ไม่รองรับ |
| `401` | ลายเซ็นไม่ถูกต้อง |
| `404` | ไม่พบงานของ Integration นี้ |
| `409` | เปลี่ยนสถานะย้อนหลัง/หลังจบงานแล้ว |

ทุกการเปลี่ยนสถานะจะ push การ์ดแจ้งสถานะไปหาลูกค้าใน LINE ตามข้อความที่ตั้งไว้ในหน้า *ตั้งค่าข้อความ*

## 3. ตัวอย่างโค้ด

### ตรวจลายเซ็น (Node.js / Express)

```js
const crypto = require('crypto');
app.post('/jobs', express.raw({ type: 'application/json' }), (req, res) => {
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.HOTLINE_SECRET).update(req.body).digest('hex');
  const given = req.get('X-Signature') || '';
  if (expected.length !== given.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
    return res.status(401).end();
  }
  const { job, customer, callbackUrl } = JSON.parse(req.body);
  // ... สร้างงานในระบบ (กันซ้ำด้วย req.get('Idempotency-Key'))
  res.json({ externalRef: 'WO-123' });
});
```

### ตรวจลายเซ็น (PHP / Laravel)

```php
$expected = 'sha256=' . hash_hmac('sha256', $request->getContent(), config('services.hotline.secret'));
abort_unless(hash_equals($expected, (string) $request->header('X-Signature')), 401);
```

### แจ้งสถานะกลับ (bash)

```bash
BODY='{"jobId":"118f7b3b-...","status":"DONE","note":"ซ่อมเสร็จแล้ว"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')"
curl -X POST "$CALLBACK_URL" -H 'Content-Type: application/json' -H "X-Signature: $SIG" -d "$BODY"
```

> สำคัญ: ต้องคำนวณลายเซ็นจาก **ไบต์เดียวกับที่ส่ง** (อย่า parse แล้ว stringify ใหม่ก่อนตรวจ)
