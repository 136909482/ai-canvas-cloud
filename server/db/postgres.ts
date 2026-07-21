import pg from 'pg'

export type DbPool = pg.Pool
export type DbClient = pg.PoolClient

export interface PostgresPoolOptions {
  connectionString: string
  schema?: string
}

export function createPostgresPool(options: PostgresPoolOptions) {
  if (options.schema && !/^[a-z_][a-z0-9_]*$/.test(options.schema)) {
    throw new Error('PostgreSQL schema name is invalid')
  }
  return new pg.Pool({
    connectionString: options.connectionString,
    options: options.schema ? `-c search_path=${options.schema}` : undefined,
  })
}

export async function withTransaction<T>(
  pool: DbPool,
  operation: (client: DbClient) => Promise<T>,
) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
