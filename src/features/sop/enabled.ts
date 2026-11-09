import "server-only";
import { env } from "@/server/env";
import { errors } from "@/server/errors";

/**
 * Standard operating procedures stay switched off until the lab adopts them (ENABLE_SOPS). Their
 * data and code are kept; only the pages, the navigation tab and the API are withdrawn.
 */
export function sopsEnabled(): boolean {
  return env().ENABLE_SOPS;
}

/** While procedures are off, their API answers as if they did not exist. */
export function assertSopsEnabled() {
  if (!sopsEnabled()) throw errors.notFound("Procedure");
}
