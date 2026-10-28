-- AlterTable
ALTER TABLE "LineChannel" ADD COLUMN     "csatEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "csatRatedAt" TIMESTAMP(3),
ADD COLUMN     "csatRating" INTEGER,
ADD COLUMN     "csatSentAt" TIMESTAMP(3),
ADD COLUMN     "firstResponderId" TEXT,
ADD COLUMN     "resolvedById" TEXT,
ADD COLUMN     "slaAlertedAt" TIMESTAMP(3),
ADD COLUMN     "waitingSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CannedReply" (
    "id" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "channelId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CannedReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CannedReply_channelId_shortcut_idx" ON "CannedReply"("channelId", "shortcut");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Contact_tags_idx" ON "Contact" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "Conversation_status_slaAlertedAt_idx" ON "Conversation"("status", "slaAlertedAt");

-- CreateIndex
CREATE INDEX "QueueTask_status_updatedAt_idx" ON "QueueTask"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "CannedReply" ADD CONSTRAINT "CannedReply_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "LineChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Canned replies move from the `canned.replies` setting to their own table.
-- Installs that never saved the setting get the old built-in defaults.
INSERT INTO "CannedReply" ("id", "shortcut", "text", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, d.shortcut, d.text, d.ord, now()
FROM (VALUES
  ('hello', 'สวัสดีค่ะ เจ้าหน้าที่ยินดีให้บริการค่ะ', 1),
  ('phone', 'รบกวนขอเบอร์โทรศัพท์สำหรับติดต่อกลับด้วยค่ะ', 2),
  ('open', 'รับทราบค่ะ เดี๋ยวเจ้าหน้าที่จะเปิดเรื่องให้นะคะ', 3),
  ('thanks', 'ขอบคุณที่ติดต่อเรานะคะ', 4)
) AS d(shortcut, text, ord)
WHERE NOT EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'canned.replies');

INSERT INTO "CannedReply" ("id", "shortcut", "text", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, 'r' || t.ord, t.value, t.ord, now()
FROM "Setting" s, jsonb_array_elements_text(s."value") WITH ORDINALITY AS t(value, ord)
WHERE s."key" = 'canned.replies' AND jsonb_typeof(s."value") = 'array' AND btrim(t.value) <> '';

DELETE FROM "Setting" WHERE "key" = 'canned.replies';

-- Backfill the new conversation columns for reports and SLA.
UPDATE "Conversation" SET "waitingSince" = "queuedAt" WHERE "status" = 'QUEUED';
UPDATE "Conversation" SET "resolvedById" = "assignedToId" WHERE "status" = 'RESOLVED';
UPDATE "Conversation" c SET "firstResponderId" = m."senderUserId"
FROM (
  SELECT DISTINCT ON ("conversationId") "conversationId", "senderUserId"
  FROM "Message" WHERE "senderType" = 'AGENT' AND "senderUserId" IS NOT NULL
  ORDER BY "conversationId", "createdAt"
) m
WHERE m."conversationId" = c."id" AND c."firstResponseAt" IS NOT NULL;
