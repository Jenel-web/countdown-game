/**
 * =============================================================================
 * FILE: test/integration/helpers/testServer.ts
 * RESPONSIBILITY: Boot a REAL Socket.io server — the exact same
 * authMiddleware, RoomManager, and handler registration as src/index.ts —
 * on an OS-assigned free port, for a single test file to connect real
 * socket.io-client instances against.
 *
 * WHY A REAL SERVER INSTEAD OF CALLING HANDLER FUNCTIONS DIRECTLY:
 * We could theoretically call registerRoomHandlers's internal logic
 * without ever opening a real socket — but that would silently skip
 * testing things that only happen at the actual network/protocol layer:
 * whether socket.join() really groups sockets the way we expect,
 * whether io.to(room).emit() really reaches both clients, whether two
 * independent browser-like connections really see events arrive in the
 * order we expect. A real (if ephemeral, in-memory) server is what makes
 * this tier meaningfully different from — and a genuine safety net beyond
 * — the pure-function unit tests.
 * =============================================================================
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import { authMiddleware } from '../../../src/socket/authMiddleware';
import { registerRoomHandlers } from '../../../src/socket/handlers/roomHandlers';
import { registerRoundHandlers } from '../../../src/socket/handlers/roundHandlers';
import { RoomManager } from '../../../src/rooms/RoomManager';
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from '../../../src/types/events';

export interface TestServerHandle {
    io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
    roomManager: RoomManager;
    url: string;
    close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServerHandle> {
    const httpServer = createServer();
    const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
        httpServer,
        { cors: { origin: '*' } }
    );

    io.use(authMiddleware);

    const roomManager = new RoomManager();

    io.on('connection', (socket) => {
        registerRoomHandlers(io, socket, roomManager);
        registerRoundHandlers(io, socket, roomManager);
    });

    // Port 0 tells Node "pick any free port for me" — this is what lets many
    // test files (or repeated test runs) start their own server without ever
    // colliding on a hardcoded port number like 4000.
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));

    const address = httpServer.address();
    if (!address || typeof address === 'string') {
        throw new Error('Test server failed to bind to a port');
    }
    const url = `http://localhost:${address.port}`;

    return {
        io,
        roomManager,
        url,
        close: () =>
            new Promise<void>((resolve, reject) => {
                io.close((err) => (err ? reject(err) : resolve()));
            }),
    };
}