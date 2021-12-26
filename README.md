## 🔗 socket.ts
> Websocket client implementation for **node.js** using **typescript** 🔥

### 🕹 Install
```
 $ yarn add socket.ts
 $ npm install socket.ts
```
> Or move all files in the repository to the **socket.ts** folder.

### 📬 Socket
```WebSocket``` class create connections and send and receive data.

**Default**
```TypeScript
 const socket = new WebSocket(url: string | URL, protocols?: string | string[], options?: SocketOptions)
```

**Events**
```TypeScript
 socket.on('open', () => void)
 socket.on('message', (message: Buffer) => void)
 socket.on('close', (code: number, reason: string) => void)
 socket.on('error', (error: Error) => void)
 
 socket.on('ping', (payload: Buffer) => void)
 socket.on('pong', (payload: Buffer) => void)
 
 socket.on('upgrade', (error: Error) => void) // http connection is upgraded to socket.
 socket.on('http-response', (error: Error) => void) // server sent http response, not upgrade.
```

**State**
```TypeScript
 - socket.state
 
 | WebSocket.CONNECTING = 0
 | WebSocket.OPEN = 1
 | WebSocket.CLOSING = 2
 | WebSocket.CLOSED = 3
```

### 💾 Send

Socket send data to server. if type of data is ```buffer```, binary packet will be sent.
```TypeScript
 socket.send(data: any)
```

**💡 Ping & Pong**
```TypeScript
 socket.ping(data: any)
 socket.pong(data: any)
```

**🔌 Close**
```TypeScript
 socket.close(code: number, reason: string)
```

### 📃 Options
This is an interface where you can specify options to be used when creating and using sockets.

```TypeScript
 version?: 8 | 13
 headers?: { [key: string]: string }
 origin?: string
 handshakeTimeout?: number
```

### 📦 Packet
Analyzes received packets or creates packets. this class is used internally only by the websocket class.

**Default**
```TypeScript
 const packet = new Packet(data: Buffer)
```
> use in socket.ts like [this](https://github.com/seungh06/socket.ts/blob/4f575eb575692561f91a5eaefada69808fbf0bde/src/socket.ts#L158).

**Create**
```TypeScript
 const packet = Packet.frame(opcode: number, payload: Buffer, fin?: boolean, rsv1?: boolean, mask?: boolean)
```
> use in socket.ts like [this](https://github.com/seungh06/socket.ts/blob/4f575eb575692561f91a5eaefada69808fbf0bde/src/socket.ts#L210).

## 📋 License
Distributed under the MIT License. See ```LICENSE``` for more information.

**© 2021 seungh, All rights reserved.**
