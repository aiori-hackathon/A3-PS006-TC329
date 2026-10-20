/** Socket.io lifecycle hook: stream → store, with REST snapshot resync and polling fallback. */

"use client";

import { useEffect, useRef } from "react";
import { getLabSocket, onLabEvents } from "@/lib/lab-socket";
import { api } from "@/lib/lab-api";
import { useLabStore } from "@/store/lab-store";

export function useLabSocket(): void {
  const applySnapshot = useLabStore((s) => s.applySnapshot);
  const applyEvents = useLabStore((s) => s.applyEvents);
  const setConnected = useLabStore((s) => s.setConnected);
  const resyncRef = useRef(0);

  useEffect(() => {
    const socket = getLabSocket();

    const resync = async () => {
      try {
        applySnapshot(await api.state());
      } catch {
        /* the next poll or reconnect retries */
      }
    };

    const onConnect = () => {
      setConnected(true);
      void resync();
    };
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    const off = onLabEvents((events) => {
      applyEvents(events);
      const now = Date.now();
      if (now - resyncRef.current > 5000) {
        // Occasional authoritative resync (also recovers any dropped batches).
        resyncRef.current = now;
        void resync();
      }
    });

    // Initial paint never waits for the socket.
    void resync();

    // Fallback polling while disconnected (or the bridge is down entirely).
    const poll = setInterval(() => {
      const { connected } = useLabStore.getState();
      if (!connected) void resync();
    }, 1500);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      off();
      clearInterval(poll);
    };
  }, [applySnapshot, applyEvents, setConnected]);
}
