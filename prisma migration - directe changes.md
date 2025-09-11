1. Double-check your schema.prisma
Make sure you’ve updated the field to 1 024 in your datamodel:

```ts
model hevo_cheetah_tasks {
  // … other fields …
- description String? @db.VarChar(512)
+ description String? @db.VarChar(1024)
  // … other fields …
}
```
2. Create a new migration folder by hand
Pick a timestamped name, e.g. 20250527_increase-task-description-length

In your project, make this directory:

```bash
mkdir -p prisma/migrations/20250527_increase-task-description-length
```
Inside it, create two files:

a) migration.sql with:

```sql
-- bump description column to varchar(1024)
ALTER TABLE "hevo_cheetah_tasks"
  ALTER COLUMN "description" TYPE varchar(1024);
```
b) schema.prisma by copying your root schema.prisma into this folder.
This snapshot tells Prisma “after this migration, the schema looks exactly like our current datamodel.”

3. Tell Prisma the migration is already applied
Now run:

```bash
npx prisma migrate resolve --applied 20250527_increase-task-description-length
```
This will insert that migration into Prisma’s _prisma_migrations table without touching your data.

4. Verify “no drift” and clean status
Finally:

```bash
npx prisma migrate status
```
You should see:
No drift reported

Your new “increase-task-description-length” migration marked Applied
