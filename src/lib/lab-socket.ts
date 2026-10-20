/** Socket.io lifecycle for the live lab stream over standard /socket.io gateway. */

"use client";

import { io, type Socket } from "socket.io-client";
import type { LabEvent } from "./lab-types";

let socket: Socket | null = null;

export function getLabSocket(): Socket {
  if (socket) return socket;
  socket = io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 8000,
  });
  return socket;
}

export function onLabEvents(handler: (events: LabEvent[]) => void): () => void {
  const s = getLabSocket();
  const listener = (msg: { events: LabEvent[] }) => {
    if (msg && Array.isArray(msg.events)) handler(msg.events);
  };
  s.on("lab", listener);
  return () => {
    s.off("lab", listener);
  };
}
