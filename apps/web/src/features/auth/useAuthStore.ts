import { create } from "zustand";
import type {
  AuthSessionResponse,
  AuthSuccessResponse,
} from "@ai-canvas-cloud/contracts";
import {
  fetchAuthSession,
  loginAuth,
  logoutAuth,
  registerAuth,
  type LoginAuthInput,
  type RegisterAuthInput,
} from "./api";

export type AuthStatus = "checking" | "authenticated" | "anonymous";

interface AuthStore {
  status: AuthStatus;
  session: AuthSessionResponse | null;
  error: string | null;
  checkSession: (options?: { silent?: boolean }) => Promise<void>;
  login: (input: LoginAuthInput) => Promise<void>;
  register: (input: RegisterAuthInput) => Promise<void>;
  logout: () => Promise<void>;
}

function toSession(response: AuthSuccessResponse): AuthSessionResponse {
  return {
    user: response.user,
    workspace: response.workspace,
  };
}

let sessionCheckInFlight: Promise<void> | null = null;
let authenticatedRuntimeCleanup: () => void = () => undefined;

export function registerAuthenticatedRuntimeCleanup(cleanup: () => void) {
  authenticatedRuntimeCleanup = cleanup;
}

export function clearAuthenticatedRuntime() {
  authenticatedRuntimeCleanup();
}

export const useAuthStore = create<AuthStore>()((set, get) => ({
  status: "checking",
  session: null,
  error: null,

  checkSession: (options) => {
    if (sessionCheckInFlight) {
      return sessionCheckInFlight;
    }

    const silent = options?.silent ?? false;

    const check = (async () => {
      if (!silent) {
        set({ status: "checking", error: null });
      } else {
        set({ error: null });
      }

      try {
        const session = await fetchAuthSession();
        if (
          get().session?.user.id &&
          get().session?.user.id !== session.user.id
        ) {
          clearAuthenticatedRuntime();
        }
        set({ status: "authenticated", session, error: null });
      } catch (error) {
        clearAuthenticatedRuntime();
        set({
          status: "anonymous",
          session: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    sessionCheckInFlight = check;
    void check.finally(() => {
      if (sessionCheckInFlight === check) {
        sessionCheckInFlight = null;
      }
    });
    return check;
  },

  login: async (input) => {
    const response = await loginAuth(input);
    clearAuthenticatedRuntime();
    set({ status: "authenticated", session: toSession(response), error: null });
  },

  register: async (input) => {
    const response = await registerAuth(input);
    clearAuthenticatedRuntime();
    set({ status: "authenticated", session: toSession(response), error: null });
  },

  logout: async () => {
    await logoutAuth().catch(() => undefined);
    clearAuthenticatedRuntime();
    set({ status: "anonymous", session: null, error: null });
  },
}));
