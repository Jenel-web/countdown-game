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
import {
    MAX_PAYLOAD_BYTES,
    createIpRateLimiter,
    createPacketLimiter,
    createUserConnectionCap,
    type Limit,
    type PacketLimits,
} from '../../../src/socket/rateLimit';
import { registerRematchHandlers } from '../../../src/socket/handlers/rematchHandlers';
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

export interface TestServerOptions {
    /**
     * Connection-attempt limit per IP. Defaults to effectively unlimited, because
     * every test client connects from 127.0.0.1 and a whole test file would
     * otherwise share one production-sized bucket. Rate-limit tests pass a real one.
     */
    ipLimit?: Limit;
    maxSocketsPerUser?: number;
    packetLimits?: PacketLimits;
}

export async function startTestServer(options: TestServerOptions = {}): Promise<TestServerHandle> {
    // Mirrors src/index.ts's GET /health so scripts that probe it behave the same here.
    const httpServer = createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        }
    });
    const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
        httpServer,
        { cors: { origin: '*' }, maxHttpBufferSize: MAX_PAYLOAD_BYTES }
    );

    // Same chain and order as src/index.ts.
    const ipLimiter = createIpRateLimiter({ limit: options.ipLimit ?? { capacity: 1_000_000, refillPerSec: 1_000_000 } });
    io.use(ipLimiter.middleware);
    io.use(authMiddleware);
    io.use(createUserConnectionCap(io, options.maxSocketsPerUser));

    const roomManager = new RoomManager();

    io.on('connection', (socket) => {
        socket.use(createPacketLimiter(socket, options.packetLimits));
        registerRoomHandlers(io, socket, roomManager);
        registerRoundHandlers(io, socket, roomManager);
        registerRematchHandlers(io, socket, roomManager);
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
                ipLimiter.stop();
                io.close((err) => (err ? reject(err) : resolve()));
            }),
    };
}