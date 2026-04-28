"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface GuestIdentity {
  guestId: number | null;
  isReturning: boolean;
  isLoading: boolean;
  error: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

let cachedIdentity: { guestId: number; isReturning: boolean } | null = null;

export function useGuestIdentity(): GuestIdentity {
  const [state, setState] = useState<GuestIdentity>({
    guestId: cachedIdentity?.guestId ?? null,
    isReturning: cachedIdentity?.isReturning ?? false,
    isLoading: !cachedIdentity,
    error: null,
  });
  const calledRef = useRef(false);

  const identify = useCallback(async () => {
    if (cachedIdentity || calledRef.current) {
      return;
    }
    calledRef.current = true;

    try {
      const { setOption, getFingerprint } = await import(
        "@thumbmarkjs/thumbmarkjs"
      );
      setOption("exclude", ["canvas", "webgl"]);

      const fp = await getFingerprint(true);

      const resp = await fetch(`${API_URL}/api/public/guest/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fingerprint_hash: fp.hash,
          fingerprint_components: fp.data,
        }),
      });

      if (!resp.ok) {
        throw new Error(`Identify failed: ${resp.status}`);
      }

      const data = (await resp.json()) as { guest_id: number; action: "create" | "cookie_hit" | "reconcile" };
      const identity = {
        guestId: data.guest_id,
        isReturning: data.action !== "create",
      };
      cachedIdentity = identity;
      setState({ ...identity, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Identity check failed",
      }));
    }
  }, []);

  useEffect(() => {
    identify();
  }, [identify]);

  return state;
}
