import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPromoCodeCatalog1720000002000 implements MigrationInterface {
  name = "AddPromoCodeCatalog1720000002000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promo_code_catalog" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "codeHash" char(64) NOT NULL,
        "codeSuffix" character varying(8) NOT NULL,
        "rewardAmount" integer NOT NULL DEFAULT 0,
        "isActive" boolean NOT NULL DEFAULT true,
        "redeemedByUserId" uuid,
        "redeemedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promo_code_catalog_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_promo_code_catalog_codeHash" UNIQUE ("codeHash")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promo_code_redemptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "promoCodeId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "rewardAmount" integer NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'accepted',
        "errorMessage" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promo_code_redemptions_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_promo_code_redemptions_promoCodeId" UNIQUE ("promoCodeId")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "paynet_transactions"
      ADD COLUMN IF NOT EXISTS "promoCodeRedemptionId" uuid
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_paynet_transactions_promoCodeRedemptionId"
      ON "paynet_transactions" ("promoCodeRedemptionId")
      WHERE "promoCodeRedemptionId" IS NOT NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_promo_code_redemptions_promo_code'
        ) THEN
          ALTER TABLE "promo_code_redemptions"
          ADD CONSTRAINT "FK_promo_code_redemptions_promo_code"
          FOREIGN KEY ("promoCodeId") REFERENCES "promo_code_catalog"("id")
          ON DELETE RESTRICT ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_promo_code_redemptions_user'
        ) THEN
          ALTER TABLE "promo_code_redemptions"
          ADD CONSTRAINT "FK_promo_code_redemptions_user"
          FOREIGN KEY ("userId") REFERENCES "telegram_users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_paynet_transactions_redemption'
        ) THEN
          ALTER TABLE "paynet_transactions"
          ADD CONSTRAINT "FK_paynet_transactions_redemption"
          FOREIGN KEY ("promoCodeRedemptionId") REFERENCES "promo_code_redemptions"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paynet_transactions" DROP CONSTRAINT IF EXISTS "FK_paynet_transactions_redemption"`);
    await queryRunner.query(`ALTER TABLE "promo_code_redemptions" DROP CONSTRAINT IF EXISTS "FK_promo_code_redemptions_user"`);
    await queryRunner.query(`ALTER TABLE "promo_code_redemptions" DROP CONSTRAINT IF EXISTS "FK_promo_code_redemptions_promo_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_paynet_transactions_promoCodeRedemptionId"`);
    await queryRunner.query(`ALTER TABLE "paynet_transactions" DROP COLUMN IF EXISTS "promoCodeRedemptionId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promo_code_redemptions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promo_code_catalog"`);
  }
}
