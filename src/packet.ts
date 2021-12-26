export class Packet {
    static readonly GET_HEADER = 0;
    static readonly GET_PAYLOAD_LENGTH_16 = 1;
    static readonly GET_PAYLOAD_LENGTH_64 = 2;
    static readonly GET_MASK_KEY = 3;
    static readonly GET_PAYLOAD = 4;
    static readonly COMPLETE = 5;

    private state = Packet.GET_HEADER;
    private data: Buffer;
    private size: number;

    fin?: boolean;
    rsv1?: boolean;
    opcode?: number;
    mask?: boolean;

    payload?: Buffer;
    payload_length?: number;
    mask_key?: Buffer;
    close_code?: number;

    constructor(data: Buffer) {
        this.data = data;
        this.size = data.length;

        if(this.size < 2) return;
        const buf = this.consume(2);

        this.fin = (buf[0] & 0x80) === 0x80;
        this.rsv1 = (buf[0] & 0x40) === 0x40;
        this.opcode = buf[0] & 0x0f;
        this.mask = (buf[1] & 0x80) === 0x80;
        this.payload_length = buf[1] & 0x7f;

        if (this.opcode >= 0x08) {
            if (this.payload_length > 125) {
                throw new Error('control frames must be less than 125 bytes.');
            }
            if (!this.fin) {
                throw new Error('control frames must not be fragmented.');
            }
        }

        if (this.payload_length === 126) {
            this.state = Packet.GET_PAYLOAD_LENGTH_16;
        }
        else if (this.payload_length === 127) {
            this.state = Packet.GET_PAYLOAD_LENGTH_64;
        }
        else {
            this.state = Packet.GET_MASK_KEY;
        }

        if(this.state === Packet.GET_PAYLOAD_LENGTH_16) {
            if (this.size < 2) return;

            this.payload_length = this.consume(2).readUInt16BE(0)
            this.state = Packet.GET_MASK_KEY;
        } else if(this.state === Packet.GET_PAYLOAD_LENGTH_64) {
            if (this.size < 8) return;

            const buf = this.consume(8);
            this.payload_length = buf.readUInt32BE(0) * Math.pow(2, 32) + buf.readUInt32BE(4);
            this.state = Packet.GET_MASK_KEY;
        }

        if(this.state === Packet.GET_MASK_KEY) {
            if(this.mask) {
                if (this.size < 4) return;
                this.mask_key = this.consume(4);
            }
            this.state = Packet.GET_PAYLOAD;
        }

        if(this.state === Packet.GET_PAYLOAD) {
            if(this.payload_length === 0) {
                this.payload = Buffer.allocUnsafe(0);
                this.state = Packet.COMPLETE;
                return;
            }

            if(this.size < this.payload_length) return;
            this.payload = this.consume(this.payload_length);

            if(this.mask && this.mask_key && (this.mask_key[0] | this.mask_key[1] | this.mask_key[2] | this.mask_key[3]) !== 0) {
                for(let idx = 0; idx < this.payload.length; idx ++) {
                    this.payload[idx] ^= this.mask_key[idx & 3];
                }
            }

            if(this.opcode === 0x08) {
                if(this.payload_length === 1) {
                    throw new Error('close frame length is not valid.');
                }

                if(this.payload_length >= 2) {
                    this.close_code = this.payload.readUInt16BE(0);
                    this.payload = this.payload.slice(2);
                }
            }

            this.state = Packet.COMPLETE;
        }
    }

    private consume(n: number) {
        this.size -=n;

        if (n === this.data.length) return this.data;

        if(n < this.data.length) {
            const buffer = this.data;
            this.data = buffer.slice(n);

            return buffer.slice(0, n);
        }

        const dest = Buffer.allocUnsafe(n);

        do {
            const buffer = this.data;
            const offset = dest.length - n;

            if(n >= buffer.length) {
                dest.set(this.data, offset);
            } else {
                dest.set(new Uint8Array(buffer.buffer, buffer.byteOffset, n), offset);
                this.data = buffer.slice(n);
            }
        } while(n > 0);

        return dest;
    }

    static frame(opcode: number, payload: Buffer, fin?: boolean, rsv1?: boolean, mask?: boolean) {
        const size = payload.length;

        const dest = Buffer.alloc(2 + (size < 126 ? 0 : (size < 65536 ? 2 : 8)) + (mask ? 4 : 0));
        dest[0] = (fin ? 128 : 0) + opcode;
        dest[1] = mask ? 128 : 0;

        let offset = 2;
        if(size < 126) {
            dest[1] += size;
        } else if(size < 65536) {
            dest[1] += 126;
            dest.writeUInt16BE(size, 2);
            offset += 2;
        } else {
            dest[1] += 127;
            dest.writeUInt32BE(Math.floor(size / Math.pow(2, 32)), 2);
            dest.writeUInt32BE(size % Math.pow(2, 32), 6);
            offset += 8;
        }

        if(mask) {
            const mask_key = Buffer.alloc(4);
            for(let idx = 0; idx < 4; idx++) {
                dest[offset + idx] = mask_key[idx] = Math.floor(Math.random() * 256);
            }
            for(let idx = 0; idx < size; idx++) {
                payload[idx] ^= mask_key[idx % 4];
            }
            offset += 4;
        }
        return Buffer.concat([dest, payload], dest.length + size);
    }
}