"use client";

import { useEffect } from "react";
import { setNonce } from "get-nonce";

/**
 * Radix (through react-remove-scroll) injects a small <style> element when a dialog locks page
 * scroll. Our CSP only allows style elements that carry the per-request nonce, so that library has
 * to be told the nonce. Without this the scroll lock silently fails in production.
 */
export function NonceBridge({ nonce }: { nonce: string | undefined }) {
  useEffect(() => {
    if (nonce) setNonce(nonce);
  }, [nonce]);
  return null;
}
