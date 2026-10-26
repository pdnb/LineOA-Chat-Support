-- CreateTable
CREATE TABLE "LineChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelSecret" TEXT,
    "accessToken" TEXT,
    "botUserId" TEXT,
    "basicId" TEXT,
    "pictureUrl" TEXT,
    "greeting" TEXT,
    "handoffText" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineChannel_pkey" PRIMARY KEY ("id")
);

-- The single OA used before multi-OA support. Its credentials are copied from
-- LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN on startup (see importEnvCredentials).
-- Prisma stores UTC in "timestamp without time zone", so don't rely on the server's local CURRENT_TIMESTAMP.
INSERT INTO "LineChannel" ("id", "name", "createdAt") VALUES ('default', 'LINE OA หลัก', now() AT TIME ZONE 'UTC');

-- CreateTable
CREATE TABLE "_LineChannelToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LineChannelToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_LineChannelToUser_B_index" ON "_LineChannelToUser"("B");

-- Existing agents keep seeing the existing OA
INSERT INTO "_LineChannelToUser" ("A", "B") SELECT 'default', "id" FROM "User" WHERE "role" = 'AGENT';

-- AlterTable: existing contacts and conversations belong to the default OA
ALTER TABLE "Contact" ADD COLUMN "channelId" TEXT;
UPDATE "Contact" SET "channelId" = 'default';
ALTER TABLE "Contact" ALTER COLUMN "channelId" SET NOT NULL;

ALTER TABLE "Conversation" ADD COLUMN "channelId" TEXT;
UPDATE "Conversation" SET "channelId" = 'default';
ALTER TABLE "Conversation" ALTER COLUMN "channelId" SET NOT NULL;

-- DropIndex
DROP INDEX "Contact_lineUserId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Contact_channelId_lineUserId_key" ON "Contact"("channelId", "lineUserId");

-- CreateIndex
CREATE INDEX "Conversation_channelId_status_lastMessageAt_idx" ON "Conversation"("channelId", "status", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "LineChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "LineChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LineChannelToUser" ADD CONSTRAINT "_LineChannelToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "LineChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LineChannelToUser" ADD CONSTRAINT "_LineChannelToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
