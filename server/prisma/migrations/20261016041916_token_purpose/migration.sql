-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('RESET_PASSWORD', 'VERIFY_EMAIL');

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "purpose" "TokenPurpose" NOT NULL DEFAULT 'RESET_PASSWORD';
