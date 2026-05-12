// social/socketServer.js

import { attachTextHandlers } from "./socketTextHandlers.js";
import logger from "../config/logger.js";
// Voice chat fully removed

/**
 * Register socket handlers when the io server is created
 */
export default function socketServer(io) {
  io.on("connection", (socket) => {
    // Attach text chat handlers only
    attachTextHandlers(io, socket);

    logger.debug("Socket connected: %s", socket.id);

    socket.on("disconnect", () => {
      logger.debug("Socket disconnected: %s", socket.id);
    });
  });
}
