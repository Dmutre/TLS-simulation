// src/client.ts
import net from 'node:net'
import fs from 'node:fs/promises'
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
  const filePath = args['file'] // optional

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
    const msg = JSON.parse(buffer.toString()) as ProtocolMessage<ServerMessages | MessageResponse>
    console.log('Received message:', msg)

    if ((msg.data as any).type === 'initial_handshake' || (msg.data as any).type === 'ready' || (msg.data as any).type === 'response') {
      await handshake.handleMessage(
        msg.data as ServerMessages,
      )
      const maybe = handshake.handleResponse(
        msg.data as MessageResponse,
      )
      if (maybe) {
        console.log('Response from server:', maybe)
        socket.end()
      }
    }
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

      sendData()
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

const crypto = require('node:crypto')

const guessPortForNode = (node: string): number => {
  const base = 7000
  const offset = node.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  return base + offset
}

main().catch(err => {
  console.error('Client error:', err)
  process.exit(1)
})
