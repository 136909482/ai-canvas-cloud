import pg from 'pg'

export type DbPool = pg.Pool
export type DbClient = pg.PoolClient

export interface PostgresPoolOptions {
  connectionString: string
}

export function createPostgresPool(options: PostgresPoolOptions) {
  return new pg.Pool({
    connectionString: options.connectionString,
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
