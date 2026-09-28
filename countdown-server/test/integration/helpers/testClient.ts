/**
 * =============================================================================
 * FILE: test/integration/helpers/testClient.ts
 * RESPONSIBILITY: Small conveniences for the integration tests — creating an
 * authenticated socket.io-client connection, and turning "wait for this
 * event to fire" into an awaitable Promise instead of nested callbacks.
 * =============================================================================
 */

import { io as ioClient, type Socket } from 'socket.io-client';
import type {
    ClientToServerEvents,
    ServerToClientEvents,
} from '../../../src/types/events';

export type TestClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Connects a test client, authenticated as the given fake userId. Recall
 * from mockAdminClient.ts: in tests, the "token" IS the userId — our fake
 * auth.getUser() just echoes it back as the authenticated user, so we
 * don't need real JWTs anywhere in this test tier.
 */
export function createTestClient(serverUrl: string, userId: string): TestClientSocket {
    return ioClient(serverUrl, {
        auth: { token: userId },
        transports: ['websocket'],
        forceNew: true,
    });
}

/**
 * Resolves with the next payload emitted for `eventName` on `socket`, or
 * rejects if it doesn't arrive within `timeoutMs`. Without a timeout, a
 * bug that causes an event to never fire would hang the test suite
 * forever instead of failing loudly and quickly.
 */
export function waitForEvent<T = unknown>(
    socket: TestClientSocket,
    eventName: string,
    timeoutMs = 2000
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for "${eventName}" after ${timeoutMs}ms`));
        }, timeoutMs);

        (socket as any).once(eventName, (payload: T) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

/** Waits until a socket has actually finished connecting. */
export function waitForConnect(socket: TestClientSocket, timeoutMs = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for connection')), timeoutMs);
        socket.on('connect', () => {
            clearTimeout(timer);
            resolve();
        });
        socket.on('connect_error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}