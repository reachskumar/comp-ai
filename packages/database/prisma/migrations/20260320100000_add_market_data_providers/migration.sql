-- AlterEnum: Add named market data providers
ALTER TYPE "MarketDataProvider" ADD VALUE IF NOT EXISTS 'RADFORD';
ALTER TYPE "MarketDataProvider" ADD VALUE IF NOT EXISTS 'MERCER';
ALTER TYPE "MarketDataProvider" ADD VALUE IF NOT EXISTS 'WTW';
ALTER TYPE "MarketDataProvider" ADD VALUE IF NOT EXISTS 'AON';
ALTER TYPE "MarketDataProvider" ADD VALUE IF NOT EXISTS 'KORN_FERRY';
ALTER TYPE "MarketDataProvider" ADD VALUE IF NOT EXISTS 'PAYSCALE';
ALTER TYPE "MarketDataProvider" ADD VALUE IF NOT EXISTS 'SALARY_COM';
ALTER TYPE "MarketDataProvider" ADD VALUE IF NOT EXISTS 'COMP_ANALYST';
ALTER TYPE "MarketDataProvider" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- AlterTable: Add sourceId and surveyDate to salary_bands
ALTER TABLE "salary_bands" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
ALTER TABLE "salary_bands" ADD COLUMN IF NOT EXISTS "surveyDate" TIMESTAMP(3);

-- AlterTable: Add survey metadata to market_data_sources
ALTER TABLE "market_data_sources" ADD COLUMN IF NOT EXISTS "surveyDate" TIMESTAMP(3);
ALTER TABLE "market_data_sources" ADD COLUMN IF NOT EXISTS "ageingRate" DECIMAL(5,4);
ALTER TABLE "market_data_sources" ADD COLUMN IF NOT EXISTS "blendWeight" DECIMAL(5,2);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "salary_bands_sourceId_idx" ON "salary_bands"("sourceId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'salary_bands_sourceId_fkey'
  ) THEN
    ALTER TABLE "salary_bands"
      ADD CONSTRAINT "salary_bands_sourceId_fkey"
      FOREIGN KEY ("sourceId") REFERENCES "market_data_sources"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

