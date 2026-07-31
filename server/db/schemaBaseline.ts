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

  return sql
    .replace("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;", "")
    .replace("CREATE SCHEMA admin;", `CREATE SCHEMA "${adminSchema}";`)
    .replace(
      "SELECT pg_catalog.set_config('search_path', '', false);",
      `SET search_path TO "${publicSchema}", public;`,
    )
    .replaceAll("admin.", `"${adminSchema}".`)
    .replaceAll("public.", `"${publicSchema}".`);
}
