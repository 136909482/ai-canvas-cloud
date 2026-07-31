import type http from "node:http";

export const FASTIFY_SERVER_CLOSE = Symbol("fastifyServerClose");

export type FastifyHttpServer = http.Server & {
  [FASTIFY_SERVER_CLOSE]?: () => Promise<void>;
};

export async function closeApiServer(server: http.Server, timeoutMs: number) {
  const closeFastify = (server as FastifyHttpServer)[FASTIFY_SERVER_CLOSE];
  if (!closeFastify) {
    throw new Error("API server is missing its Fastify close hook");
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      closeFastify(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out closing API server")),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
