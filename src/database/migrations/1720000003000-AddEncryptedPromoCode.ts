import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEncryptedPromoCode1720000003000 implements MigrationInterface {
  name = "AddEncryptedPromoCode1720000003000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "promo_code_catalog"
      ADD COLUMN IF NOT EXISTS "codeEncrypted" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "promo_code_catalog"
      DROP COLUMN IF EXISTS "codeEncrypted"
    `);
  }
}
