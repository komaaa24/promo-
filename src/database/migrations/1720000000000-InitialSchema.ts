import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1720000000000 implements MigrationInterface {
  name = "InitialSchema1720000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "telegram_users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "telegramId" bigint NOT NULL,
        "language" character varying(16) NOT NULL DEFAULT 'uz',
        "fullName" character varying(160),
        "phone" character varying(32),
        "address" character varying(255),
        "selectedRegion" character varying(120),
        "step" character varying(32) NOT NULL DEFAULT 'ASK_FULL_NAME',
        "username" character varying(64),
        "firstName" character varying(120),
        "lastName" character varying(120),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_telegram_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_telegram_users_telegramId" UNIQUE ("telegramId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promo_codes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(80) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "userId" uuid NOT NULL,
        CONSTRAINT "PK_promo_codes_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_promo_codes_code" ON "promo_codes" ("code")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_promo_codes_user'
        ) THEN
          ALTER TABLE "promo_codes"
          ADD CONSTRAINT "FK_promo_codes_user"
          FOREIGN KEY ("userId") REFERENCES "telegram_users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "promo_codes" DROP CONSTRAINT IF EXISTS "FK_promo_codes_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promo_codes_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promo_codes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "telegram_users"`);
  }
}
