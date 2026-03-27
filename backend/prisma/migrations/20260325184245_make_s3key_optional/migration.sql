-- DropIndex
DROP INDEX "Recording_s3Key_key";

-- AlterTable
ALTER TABLE "Recording" ALTER COLUMN "s3Key" DROP NOT NULL,
ALTER COLUMN "s3Url" SET DEFAULT '';
