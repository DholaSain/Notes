## Creating custom uniquie sequentiol ids

setup the prisma model
```prisma
model Category {
  id         String  @id @default(uuid())
  public_code String @unique @default(dbgenerated()) @db.VarChar(32)
  // other fields

  @@map("categories")
}
```

### Run the following command 
```zsh
npx prisma migrate dev --name public-code --create-only
```

### Add the following sql into the migration file

```sql
-- Add column (nullable for backfill)
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "public_code" VARCHAR(32);

-- Dedicated sequence for categories
CREATE SEQUENCE IF NOT EXISTS categories_public_code_seq;

-- Backfill existing rows BEFORE NOT NULL
UPDATE "categories"
SET "public_code" = 'CT' || nextval('categories_public_code_seq')::text
WHERE "public_code" IS NULL;

-- Enforce NOT NULL
ALTER TABLE "categories" ALTER COLUMN "public_code" SET NOT NULL;

-- Optional: format check (CT + digits)
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS categories_public_code_format;
ALTER TABLE "categories"
  ADD CONSTRAINT categories_public_code_format
  CHECK ("public_code" ~ '^CT[0-9]+$');

-- Unique index (safe after backfill; also fine before because NULLs are allowed)
DROP INDEX IF EXISTS categories_public_code_key;
CREATE UNIQUE INDEX categories_public_code_key ON "categories"("public_code");

-- Trigger for future inserts/updates (uses the function created in your earlier migration)
DROP TRIGGER IF EXISTS categories_public_code_trg ON "categories";
CREATE TRIGGER categories_public_code_trg
BEFORE INSERT OR UPDATE ON "categories"
FOR EACH ROW EXECUTE FUNCTION set_public_code('categories_public_code_seq', 'CT');
```

### Run
```zsh
npx prisma migrate dev
```
