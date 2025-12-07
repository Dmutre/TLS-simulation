import net from 'node:net'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import {
  parseArgs,
  sendWithPacketLimit,
} from './helpers'
import {
  DataHandler,
  wrapMessage,
} from './protocol/dataHandler'
import {
  ClientMessages,
  MessageRequest,
  MessageResponse,
  ProtocolMessage,
  ClientDataMessages,
  ServerMessages,
  MessageReceived,
} from './protocol/messages'
import { ClientHandShakeHandler } from './protocol/handshakeClient'
import { createMap } from './graph'

const main = async () => {
  const args = parseArgs()
  const from = args['from'] ?? 'A'
  const to = args['to'] ?? 'E'
  const routeMap =
    args['routeMap'] ?? 'A:B,B:C,C:D,C:E'
  const caHost = args['caHost'] ?? 'localhost'
  const caPort = Number(args['caPort'] ?? 9000)
  const message = args['message'] ?? 'Hello from client'
  const filePath = args['file']

  const graph = createMap(routeMap)
  const route = graph.findRoute(from, to)!
  if (!route) {
    console.error('Route not found from', from, 'to', to)
    process.exit(1)
  }
  console.log('Route:', route.join(' -> '))

  const firstNode = route[0]
  const firstPort = guessPortForNode(firstNode)

  const socket = net.createConnection({
    host: 'localhost',
    port: firstPort,
  })

  let createEncryptedRequest: ((msg: ClientDataMessages['request']) => MessageRequest) | null = null

  const handler = new DataHandler(async buffer => {
    const msg = JSON.parse(buffer.toString()) as ProtocolMessage<
      ServerMessages | MessageResponse | MessageReceived<MessageResponse | undefined>
    >
    console.log('Received message:', msg)

    const data: any = msg.data

    if (data.type === 'initial_handshake' || data.type === 'ready' || data.type === 'premaster_ack') {
      await handshake.handleMessage(data as ServerMessages)
      return
    }

    if (data.type === 'response') {
      const maybe = handshake.handleResponse(data as MessageResponse)
      if (maybe) {
        console.log('Response from server:', maybe)
        // Close connection after receiving final response
        setTimeout(() => {
          socket.end()
        }, 100)
      }
      return
    }

    if (data.type === 'received') {
      const received = data as MessageReceived<MessageResponse | undefined>
      if (received.response && (received.response as any).type === 'response') {
        const maybe = handshake.handleResponse(received.response as MessageResponse)
        if (maybe) {
          console.log('Response from server:', maybe)
          // Close connection after receiving final response
          setTimeout(() => {
            socket.end()
          }, 100)
        }
      } else {
        console.log('Received ACK without response')
      }
      return
    }

    console.log('Unknown message type on client:', data.type)
  })

  const handshake = new ClientHandShakeHandler({
    caHost,
    caPort,
    serverHost: to,
    writeMessage: async (data: ClientMessages) => {
      const protocolMsg: ProtocolMessage<ClientMessages> = {
        id: crypto.randomUUID(),
        route,
        data,
      }
      const buf = wrapMessage(protocolMsg)
      sendWithPacketLimit(socket, buf)
    },
    onReady: creator => {
      createEncryptedRequest = creator
      console.log('Handshake complete, sending data...')

      void sendData()
    },
  })

  socket.on('data', d => handler.appendData(d))

  await handshake.initiateHandShake()

  async function sendData() {
    if (!createEncryptedRequest) return

    let payload: ClientDataMessages['request']

    if (filePath) {
      const data = await fs.readFile(filePath, 'utf-8')
      payload = {
        action: 'chat',
        message: `[FILE ${filePath}]\n${data}`,
      } as any
    } else {
      payload = { action: 'echo', message } as any
    }

    const encryptedReq = createEncryptedRequest(payload)
    const protocolMsg: ProtocolMessage<MessageRequest> = {
      id: crypto.randomUUID(),
      route,
      data: encryptedReq,
    }
    const buf = wrapMessage(protocolMsg)
    sendWithPacketLimit(socket, buf)
  }
}

const guessPortForNode = (node: string): number => {
  const base = 7000
  const offset = node.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  return base + offset
}

main().catch(err => {
  console.error('Client error:', err)
  process.exit(1)
})
