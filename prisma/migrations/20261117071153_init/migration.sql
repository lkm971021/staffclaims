-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STAFF', 'FINANCE', 'DIRECTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'PENDING_FINANCE', 'RETURNED', 'PENDING_DIRECTOR', 'CLARIFICATION', 'APPROVED_FOR_PAYMENT', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "LineStatus" AS ENUM ('PENDING', 'VERIFIED', 'QUERIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocKind" AS ENUM ('ORIGINAL', 'ENHANCED', 'COMBINED_PDF', 'CLAIM_SUPPORTING_PDF', 'CLAIM_SUMMARY', 'ADDITIONAL', 'PAYMENT_PROOF', 'APPROVAL_RECORD');

-- CreateEnum
CREATE TYPE "DriveStatus" AS ENUM ('NOT_QUEUED', 'PENDING', 'UPLOADED', 'FAILED');

-- CreateEnum
CREATE TYPE "ArchiveStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'ARCHIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "DupRule" AS ENUM ('FILE_HASH', 'IMAGE_SIMILAR', 'SUPPLIER_INVOICE_NO', 'SUPPLIER_DATE_AMOUNT');

-- CreateEnum
CREATE TYPE "DupDecision" AS ENUM ('OPEN', 'NOT_DUPLICATE', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brn" TEXT,
    "tin" TEXT,
    "sstNo" TEXT,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "driveRootId" TEXT,
    "isHolding" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "isAll" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nickName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "nric" TEXT,
    "tin" TEXT,
    "department" TEXT,
    "position" TEXT,
    "branchId" TEXT,
    "roles" "Role"[] DEFAULT ARRAY['STAFF']::"Role"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "googleSub" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamDelegation" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "glAccountCode" TEXT,
    "glAccountName" TEXT,
    "requiresReceipt" BOOLEAN NOT NULL DEFAULT true,
    "requiresLocation" BOOLEAN NOT NULL DEFAULT false,
    "requiresPurpose" BOOLEAN NOT NULL DEFAULT true,
    "einvoiceApplicable" BOOLEAN NOT NULL DEFAULT true,
    "specialApproval" BOOLEAN NOT NULL DEFAULT false,
    "warnAboveSen" INTEGER,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "guidance" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RefCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RefCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "submittedById" TEXT,
    "claimYear" INTEGER NOT NULL,
    "claimMonth" INTEGER NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "advanceSen" INTEGER NOT NULL DEFAULT 0,
    "reimbursementMethod" TEXT,
    "staffRemarks" TEXT,
    "financeRemarks" TEXT,
    "directorRemarks" TEXT,
    "isDirectorOwnClaim" BOOLEAN NOT NULL DEFAULT false,
    "parentClaimId" TEXT,
    "firstSubmittedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "financeVerifiedAt" TIMESTAMP(3),
    "financeVerifiedById" TEXT,
    "directorDecidedAt" TIMESTAMP(3),
    "directorDecidedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "archiveStatus" "ArchiveStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "driveFolderId" TEXT,
    "driveFolderUrl" TEXT,
    "sheetSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "expenseDate" DATE NOT NULL,
    "categoryId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "businessPurpose" TEXT,
    "location" TEXT,
    "receiptNo" TEXT,
    "amountSen" INTEGER NOT NULL,
    "staffPaymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "docIsReceipt" BOOLEAN NOT NULL DEFAULT true,
    "docIsEinvoice" BOOLEAN NOT NULL DEFAULT false,
    "supplierTin" TEXT,
    "supplierBrn" TEXT,
    "supplierSst" TEXT,
    "invoiceNo" TEXT,
    "invoiceDate" DATE,
    "einvoiceUuid" TEXT,
    "einvoiceStatus" TEXT,
    "remarks" TEXT,
    "finStatus" "LineStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAmountSen" INTEGER,
    "finComment" TEXT,
    "finCheckedById" TEXT,
    "finCheckedAt" TIMESTAMP(3),
    "hardcopyReceivedAt" TIMESTAMP(3),
    "hardcopyReceivedBy" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "lineId" TEXT,
    "kind" "DocKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "derivedFromId" TEXT,
    "pageOrder" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "phash" TEXT,
    "storageKey" TEXT NOT NULL,
    "driveFileId" TEXT,
    "driveStatus" "DriveStatus" NOT NULL DEFAULT 'NOT_QUEUED',
    "driveError" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrResult" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "supplier" TEXT,
    "supplierBrn" TEXT,
    "supplierTin" TEXT,
    "supplierSst" TEXT,
    "receiptNo" TEXT,
    "docDate" DATE,
    "subtotalSen" INTEGER,
    "taxSen" INTEGER,
    "totalSen" INTEGER,
    "currency" TEXT,
    "description" TEXT,
    "legible" BOOLEAN,
    "confidence" DOUBLE PRECISION,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateFlag" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "matchedLineId" TEXT NOT NULL,
    "rule" "DupRule" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "detail" TEXT,
    "decision" "DupDecision" NOT NULL DEFAULT 'OPEN',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimVersion" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "totalSen" INTEGER NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvent" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "fromStatus" "ClaimStatus",
    "toStatus" "ClaimStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "remarks" TEXT,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentBatch" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentDate" DATE,
    "method" TEXT,
    "bankRef" TEXT,
    "remarks" TEXT,
    "proofDocKey" TEXT,
    "proofDocName" TEXT,
    "proofDriveFileId" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "amountSen" INTEGER NOT NULL,
    "paymentRef" TEXT,

    CONSTRAINT "PaymentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "claimId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveFolder" (
    "path" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveFolder_pkey" PRIMARY KEY ("path")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GoogleCredential" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "email" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectedById" TEXT NOT NULL,

    CONSTRAINT "GoogleCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeNo_key" ON "User"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "TeamDelegation_leaderId_memberId_key" ON "TeamDelegation"("leaderId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_ref_key" ON "Claim"("ref");

-- CreateIndex
CREATE INDEX "Claim_claimantId_claimYear_claimMonth_idx" ON "Claim"("claimantId", "claimYear", "claimMonth");

-- CreateIndex
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

-- CreateIndex
CREATE INDEX "Claim_claimYear_claimMonth_idx" ON "Claim"("claimYear", "claimMonth");

-- CreateIndex
CREATE INDEX "ClaimLine_supplier_receiptNo_idx" ON "ClaimLine"("supplier", "receiptNo");

-- CreateIndex
CREATE INDEX "ClaimLine_expenseDate_amountSen_idx" ON "ClaimLine"("expenseDate", "amountSen");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimLine_claimId_lineNo_key" ON "ClaimLine"("claimId", "lineNo");

-- CreateIndex
CREATE INDEX "Document_sha256_idx" ON "Document"("sha256");

-- CreateIndex
CREATE INDEX "Document_claimId_kind_idx" ON "Document"("claimId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateFlag_lineId_matchedLineId_rule_key" ON "DuplicateFlag"("lineId", "matchedLineId", "rule");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimVersion_claimId_version_key" ON "ClaimVersion"("claimId", "version");

-- CreateIndex
CREATE INDEX "WorkflowEvent_claimId_at_idx" ON "WorkflowEvent"("claimId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentBatch_ref_key" ON "PaymentBatch"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentItem_claimId_key" ON "PaymentItem"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_dedupeKey_key" ON "SyncJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "SyncJob_status_runAfter_idx" ON "SyncJob"("status", "runAfter");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamDelegation" ADD CONSTRAINT "TeamDelegation_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamDelegation" ADD CONSTRAINT "TeamDelegation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_parentClaimId_fkey" FOREIGN KEY ("parentClaimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ClaimLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrResult" ADD CONSTRAINT "OcrResult_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateFlag" ADD CONSTRAINT "DuplicateFlag_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ClaimLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateFlag" ADD CONSTRAINT "DuplicateFlag_matchedLineId_fkey" FOREIGN KEY ("matchedLineId") REFERENCES "ClaimLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimVersion" ADD CONSTRAINT "ClaimVersion_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ClaimLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentBatch" ADD CONSTRAINT "PaymentBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentItem" ADD CONSTRAINT "PaymentItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PaymentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentItem" ADD CONSTRAINT "PaymentItem_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
