const POSTGRES_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function assertSchemaIdentifier(value: string) {
  if (!POSTGRES_IDENTIFIER.test(value)) {
    throw new Error(`Invalid PostgreSQL schema identifier: ${value}`);
  }
}

export function isolateCurrentSchemaSql(
  sql: string,
  publicSchema: string,
  adminSchema = `${publicSchema}_admin`,
) {
  assertSchemaIdentifier(publicSchema);
  assertSchemaIdentifier(adminSchema);

  const isolatedSql = sql
    .replace("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;", "")
    .replace("CREATE SCHEMA admin;", `CREATE SCHEMA "${adminSchema}";`)
    .replace(
      "SELECT pg_catalog.set_config('search_path', '', false);",
      `SET search_path TO "${publicSchema}", public;`,
    )
    .replaceAll("admin.", `"${adminSchema}".`)
    .replaceAll("public.", `"${publicSchema}".`);

  // Integration schemas are created from the immutable 0001 baseline. Keep
  // them compatible with the current asset accounting columns without
  // rewriting that historical migration.
  return `${isolatedSql}\nALTER TABLE "${publicSchema}".assets ADD COLUMN IF NOT EXISTS quota_released_at timestamp with time zone;`;
}
