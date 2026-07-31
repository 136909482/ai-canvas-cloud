import type http from "node:http";

export const ADMIN_FASTIFY_SERVER_CLOSE = Symbol("adminFastifyServerClose");

export type AdminFastifyHttpServer = http.Server & {
  [ADMIN_FASTIFY_SERVER_CLOSE]?: () => Promise<void>;
};

export async function closeAdminApiServer(
  server: http.Server,
  timeoutMs: number,
) {
  const closeFastify = (server as AdminFastifyHttpServer)[
    ADMIN_FASTIFY_SERVER_CLOSE
  ];
  if (!closeFastify) {
    throw new Error("Admin API server is missing its Fastify close hook");
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      closeFastify(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out closing Admin API server")),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
