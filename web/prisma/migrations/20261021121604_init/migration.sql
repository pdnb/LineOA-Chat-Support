-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('BOT', 'QUEUED', 'ASSIGNED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('CUSTOMER', 'BOT', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "JobEventSource" AS ENUM ('SYSTEM', 'AGENT', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "pictureUrl" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'BOT',
    "assignedToId" TEXT,
    "categoryId" TEXT,
    "botState" JSONB,
    "collected" JSONB,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageText" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "senderType" "SenderType" NOT NULL,
    "senderUserId" TEXT,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "payload" JSONB,
    "lineMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "form" JSONB NOT NULL DEFAULT '[]',
    "integrationId" TEXT,
    "autoCreateJob" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "headers" JSONB,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "categoryId" TEXT,
    "integrationId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "externalRef" TEXT,
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "JobStatus",
    "note" TEXT,
    "source" "JobEventSource" NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCounter" (
    "period" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "JobCounter_pkey" PRIMARY KEY ("period")
);

-- CreateTable
CREATE TABLE "QueueTask" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_lineUserId_key" ON "Contact"("lineUserId");

-- CreateIndex
CREATE INDEX "Conversation_status_lastMessageAt_idx" ON "Conversation"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_contactId_idx" ON "Conversation"("contactId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Job_number_key" ON "Job"("number");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_contactId_idx" ON "Job"("contactId");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_createdAt_idx" ON "JobEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueTask_queue_status_runAt_idx" ON "QueueTask"("queue", "status", "runAt");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
