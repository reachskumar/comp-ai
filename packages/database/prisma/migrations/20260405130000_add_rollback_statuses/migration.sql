-- Add rollback status values to WriteBackBatchStatus enum
ALTER TYPE "WriteBackBatchStatus" ADD VALUE IF NOT EXISTS 'ROLLING_BACK';
ALTER TYPE "WriteBackBatchStatus" ADD VALUE IF NOT EXISTS 'ROLLBACK_FAILED';

-- Add rolled back status to WriteBackRecordStatus enum
ALTER TYPE "WriteBackRecordStatus" ADD VALUE IF NOT EXISTS 'ROLLED_BACK';
