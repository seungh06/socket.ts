import EventEmitter from "events";
import http, { ClientRequest, ClientRequestArgs, IncomingMessage } from "http";
import https from "https";
import { createHash, randomBytes } from "crypto";
import { Socket } from "net";
import { Packet } from "./packet";

export class SocketOption {
    versions?: 8 | 13;
    headers?: { [key: string]: string };
    origin?: string;
    handshakeTimeout?: number;
}

export class WebSocket extends EventEmitter {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: URL;
    readonly protocols: string[];
    readonly version: number
    readonly secure: boolean;
    readonly unix: boolean;
    readonly nonce: string;

    private req: ClientRequest;
    private socket?: Socket;

    state = WebSocket.CONNECTING;
    closeCode: number = 1006;
    closeReason: string = '';

    constructor(address: string | URL, protocols?: string | string[], options?: SocketOption) {
        super();

        this.url = typeof address === 'string' ? new URL(address) : address;
        this.protocols = typeof protocols === 'string'
            ? [protocols]
            : typeof protocols === 'undefined' ? [] : protocols;
        this.version = options?.versions || 13;

        this.secure = this.url.protocol === 'wss:';
        this.unix = this.url.protocol === 'ws+unix:';

        this.nonce = randomBytes(16).toString('base64');

        let client: ClientRequestArgs = {
            port: this.url.port || this.secure ? 443 : 80,
            host: this.url.hostname,
            headers: {
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Sec-WebSocket-Version': this.version,
                'Sec-WebSocket-Key': this.nonce,
                ...options?.headers
            },
            path: this.url.pathname + this.url.search,
            timeout: options?.handshakeTimeout
        };

        const protocol_set = new Set();

        if(this.protocols.length > 0 && client.headers) {
            const protocol_regex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

            for(const protocol of this.protocols) {
                if(!protocol_regex.test(protocol) || protocol_set.has(protocol)) {
                    throw new Error('subprotocol cannot be duplicated or invalid.');
                }
                protocol_set.add(protocol);
            }
            client.headers['Sec-WebSocket-Protocol'] = this.protocols.join(',');
        }

        if(options?.origin && client.headers)
            client.headers[this.version === 13 ? 'Sec-WebSocket-Origin' : 'Origin'];

        if(this.url.username || this.url.password)
            client.auth = `${this.url.username}:${this.url.password}`;
        
        if(this.unix) {
            const socket_parts = client.path!!.split(':');
            client.socketPath = socket_parts[0];
            client.path = socket_parts[1];
        }

        this.req = (this.secure ? https : http).get(client);

        if(client.timeout) {
            this.req.on('timeout', () => this.handshake_failed('opening handshake has timed out.'));
        }

        this.req.on('error', error => {
            if(this.req.destroyed) return;

            this.req.destroy();
            this.emit_error_and_close(error);
        })

        this.req.on('response', response => {
            this.emit('http-response', response);
            this.handshake_failed(`unexpected server response: ${response.statusCode}-${response.statusMessage}`);
        })

        this.req.on('upgrade', (response, socket, head) => {
            this.emit('upgrade', response);

            const digest = createHash('sha1')
                .update(this.nonce + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                .digest('base64');

            if(response.headers['sec-websocket-accept'] !== digest) {
                this.handshake_failed('sec-websocket-accept header is not valid.');
                return;
            }

            const server_protocol = response.headers['sec-websocket-protocol'];

            if(server_protocol) {
                if(!protocol_set.size) {
                    this.handshake_failed('nothing was requested, but the server sent a subprotocol.');
                    return;
                } else if(!protocol_set.has(server_protocol)){
                    this.handshake_failed('server sent a invalid subprotocol.');
                    return;
                }
            } else if(protocol_set.size) {
                this.handshake_failed('server sent no subprotocol.');
                return;
            }

            this.set_socket(socket, head);
        })
        this.req.end();
    }

    private handshake_failed(description: string) {
        this.req.destroy();
        this.emit_error_and_close(new Error(description));
    }

    private set_socket(socket: Socket, head: Buffer) {
        socket.setTimeout(0);
        socket.setNoDelay();

        if(head.length > 0) socket.unshift(head);

        socket.on('data', data => this.socket_on_data(data));
        socket.on('close', _ => this.emit_close());
        this.socket = socket;

        this.state = WebSocket.OPEN;
        this.emit('open');
    }

    private socket_on_data(data: Buffer) {
        const packet = new Packet(data);

        switch(packet.opcode) {
            case 0x00:
                console.log('Continuation Frame.');
                break;

            case 0x01:
                this.emit('message', packet.payload);
                break;
            
            case 0x02:
                this.emit('message', packet.payload);
                break;

            case 0x08:
                this.closeCode = packet.close_code || 1006;
                this.closeReason = packet.payload?.toString() || 'Abnormal Closure';

                this.socket?.destroy();
                break;
            
            case 0x09:
                this.pong(packet.payload);
                this.emit('ping', packet.payload);
                break;

            case 0x0A:
                this.emit('pong', packet.payload);
                break;
        }
    }

    private emit_error_and_close(error: Error) {
        this.state = WebSocket.CLOSING;
        this.emit('error', error);
        this.emit_close();
    }
    
    private emit_close() {
        this.state = WebSocket.CLOSED;
        this.emit('close', this.closeCode, this.closeReason);
    }

    send(data: any) {
        if(this.state === WebSocket.CONNECTING) throw new Error('send -> websocket is connecting.');
        
        const is_buf = Buffer.isBuffer(data);
        const opcode = is_buf ? 0x02 : 0x01;
        const payload = is_buf ? data : Buffer.from(data);
        
        const packet = Packet.frame(opcode, payload, true, false, true);
        this.socket?.write(packet);
    }

    ping(data: any) {
        if(this.state === WebSocket.CONNECTING) throw new Error('ping -> websocket is connecting.');
        const payload = Buffer.isBuffer(data) ? data 
            : Buffer.from(typeof data === 'number' ? data.toString() : data);

        if(payload.length > 125) {
            throw new Error('payload for PING(0x09) is longer than 125 bytes.');
        }

        const packet = Packet.frame(0x09, payload, true, false, true);
        this.socket?.write(packet);
    }

    pong(data: any) {
        if(this.state === WebSocket.CONNECTING) throw new Error('pong -> websocket is connecting.');
        const payload = Buffer.isBuffer(data) ? data 
            : Buffer.from(typeof data === 'number' ? data.toString() : data);

        if(payload.length > 125) {
            throw new Error('payload for PONG(0x0a) is longer than 125 bytes.');
        }

        const packet = Packet.frame(0x0a, payload, true, false, true);
        this.socket?.write(packet);
    }

    close(code: number, reason: string) {
        if(this.state === WebSocket.CLOSED) return;

        if(this.state === WebSocket.CONNECTING) 
            return this.handshake_failed('websocket was closed before the connection was established.');

        if(this.state === WebSocket.CLOSING) {
            this.socket?.end();
            return;
        }
        this.state = WebSocket.CLOSING;

        const length = Buffer.byteLength(reason);
        if(length > 123) {
            throw new Error('close reason must be less than 132 bytes.');
        }

        const payload = Buffer.alloc(2 + length);
        payload.writeUInt16BE(code, 0);
        payload.write(reason, 2);

        this.closeCode = code;
        this.closeReason = reason;

        const packet = Packet.frame(0x08, payload, true, false, true);
        this.socket?.write(packet);
    }
}

export declare interface WebSocket {
    on(event: 'open', listener: (this: WebSocket) => void): this;
    on(event: 'message', listener: (this: WebSocket, data: Buffer) => void): this;
    on(event: "close", listener: (this: WebSocket, code: number, reason: Buffer) => void): this;
    on(event: "error", listener: (this: WebSocket, error: Error) => void): this;
    
    on(event: 'ping' | 'pong', listener: (this: WebSocket, data: Buffer) => void): this;
    
    on(event: 'upgrade', listener: (this: WebSocket, request: IncomingMessage) => void): this;
    on(event: 'http-response', listener: (this: WebSocket, request: ClientRequest, response: IncomingMessage) => void): this;
    on(event: string, listener: Function): this;

    removeListener(event: 'open', listener: () => void): this;
    removeListener(event: 'message', listener: (data: Buffer) => void): this;
    removeListener(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    removeListener(event: 'error', listener: (error: Error) => void): this;

    removeListener(event: 'ping' | 'pong', listener: (data: Buffer) => void): this;

    removeListener(event: 'upgrade', listener: (request: IncomingMessage) => void): this;
    removeListener(event: 'http-response', listener: (request: ClientRequest, response: IncomingMessage) => void): this;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
}