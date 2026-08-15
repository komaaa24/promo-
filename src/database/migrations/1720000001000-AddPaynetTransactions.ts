import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaynetTransactions1720000001000 implements MigrationInterface {
  name = "AddPaynetTransactions1720000001000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "telegram_users"
      ADD COLUMN IF NOT EXISTS "paynetDraftPhone" character varying(32)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paynet_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "providerUuid" character varying(36),
        "providerId" integer,
        "phone" character varying(32) NOT NULL,
        "amount" integer NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'local_pending',
        "providerPayload" jsonb,
        "callbackPayload" jsonb,
        "errorMessage" text,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paynet_transactions_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_paynet_transactions_providerUuid"
      ON "paynet_transactions" ("providerUuid")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_paynet_transactions_providerId"
      ON "paynet_transactions" ("providerId")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_paynet_transactions_user'
        ) THEN
          ALTER TABLE "paynet_transactions"
          ADD CONSTRAINT "FK_paynet_transactions_user"
          FOREIGN KEY ("userId") REFERENCES "telegram_users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paynet_transactions" DROP CONSTRAINT IF EXISTS "FK_paynet_transactions_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_paynet_transactions_providerId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_paynet_transactions_providerUuid"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paynet_transactions"`);
    await queryRunner.query(`ALTER TABLE "telegram_users" DROP COLUMN IF EXISTS "paynetDraftPhone"`);
  }
}
