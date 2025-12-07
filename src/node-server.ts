// src/node-server.ts
import net from 'node:net'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  assertThat,
  MessageConsumer,
  SECRETS_PATH,
  sendWithPacketLimit,
  parseArgs,
} from './helpers'
import { DataHandler, wrapMessage } from './protocol/dataHandler'
import {
  ClientMessages,
  MessageReceived,
  ProtocolMessage,
} from './protocol/messages'
import { ServerHandShakeHandler } from './protocol/handshakeServer'
import { createMap } from './graph'
import { v4 as uuid } from 'uuid'

type NodeConfig = {
  NODE_NAME: string
  PORT: number
  PRIVATE_KEY: string
  CERTIFICATE: string
  CA_HOST: string
  CA_PORT: number
  ROUTE_MAP: string
}

const loadConfig = async (): Promise<NodeConfig> => {
  const args = parseArgs()
  const NODE_NAME = args['name'] ?? 'A'
  const PORT = Number(args['port'] ?? 7000)
  const CA_HOST = args['caHost'] ?? 'localhost'
  const CA_PORT = Number(args['caPort'] ?? 9000)
  const ROUTE_MAP =
    args['routeMap'] ?? 'A:B,B:C,C:D,C:E' // можна задати ззовні

  const keysPath = path.join(SECRETS_PATH, `node_${NODE_NAME}`)
  const privateKeyPath = path.join(keysPath, `${NODE_NAME}.key`)
  const certificatePath = path.join(keysPath, `${NODE_NAME}.crt`)

  const PRIVATE_KEY = await fs.readFile(privateKeyPath, 'utf-8')
  const CERTIFICATE = await fs.readFile(certificatePath, 'utf-8')

  return {
    NODE_NAME,
    PORT,
    PRIVATE_KEY,
    CERTIFICATE,
    CA_HOST,
    CA_PORT,
    ROUTE_MAP,
  }
}

const main = async () => {
  const config = await loadConfig()
  const graph = createMap(config.ROUTE_MAP)

  const server = net.createServer(socket => {
    console.log(
      `[${config.NODE_NAME}] new client`,
      socket.remoteAddress,
      socket.remotePort,
    )

    const messageConsumer = new MessageConsumer()
    const handshakeHandler = new ServerHandShakeHandler({
      privateKey: config.PRIVATE_KEY,
      certificate: config.CERTIFICATE,
      handleRequest: async (req: any) => {
        switch (req.action) {
          case 'echo':
            return { echoedMessage: `[${config.NODE_NAME}] ${req.message}` }
          case 'chat':
            console.log(
              `[${config.NODE_NAME}] chat message:`,
              req.message,
            )
            return { ok: true }
          default:
            console.log(
              `[${config.NODE_NAME}] unknown action`,
              req.action,
            )
            return { error: 'Unknown action', ok: false }
        }
      },
    })

    const handler = new DataHandler(async messageBuffer => {
      const raw = messageBuffer.toString()
      console.log('Raw message:', raw)
      const msg = JSON.parse(raw) as ProtocolMessage<
        ClientMessages | MessageReceived
      >

      const isFinal = msg.route.at(-1) === config.NODE_NAME
      if (!isFinal) {
        // >>> проміжна нода — форвардимо
        const currentIndex = msg.route.findIndex(n => n === config.NODE_NAME)
        const nextNode = msg.route[currentIndex + 1]
        assertThat(nextNode, 'Next node is undefined in route')

        const nextPort = guessPortForNode(nextNode) // для простоти: мапа node->port
        const resp = await forwardToNode(nextNode, nextPort, msg)
        sendWithPacketLimit(socket, wrapMessage(resp))
        return
      }

      // >>> це кінцева нода
      if (msg.data.type === 'received') {
        messageConsumer.consume({
          messageId: msg.data.messageId,
          response: msg.data.response,
          type: 'received',
        })
        return
      }

      const result = await handshakeHandler.handleMessage(
        msg.data as ClientMessages,
      )

      if (!result || (result as any).type === 'response') {
        const echo: MessageReceived<unknown> = {
          type: 'received',
          messageId: msg.id,
          response: result,
        }
        const response = createProtocolMessage(
          echo,
          msg.route.toReversed(),
        )
        sendWithPacketLimit(socket, response)
      } else {
        const response = createProtocolMessage(
          result,
          msg.route.toReversed(),
        )
        sendWithPacketLimit(socket, response)
      }
    })

    socket.on('data', data => handler.appendData(data))
  })

  server.listen(config.PORT, () => {
    console.log(
      `[${config.NODE_NAME}] listening on port ${config.PORT}`,
    )
  })
}

// Допоміжна штука – дуже проста "мапа" node->port.
// В РГР можеш зробити це краще (через конфіг, env, JSON-файл, тощо).
const guessPortForNode = (node: string): number => {
  const base = 7000
  const offset = node.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  return base + offset
}

const forwardToNode = async (
  node: string,
  port: number,
  msg: ProtocolMessage<any>,
): Promise<ProtocolMessage<any>> => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: 'localhost', port })
    const handler = new DataHandler(buffer => {
      const resp = JSON.parse(buffer.toString()) as ProtocolMessage<any>
      resolve(resp)
      socket.end()
    })
    socket.on('data', d => handler.appendData(d))
    socket.on('error', reject)

    const buf = wrapMessage(msg)
    sendWithPacketLimit(socket, buf)
  })
}

const createProtocolMessage = <T>(
  data: T,
  route: string[],
): Buffer => {
  const protocolMessage: ProtocolMessage<T> = {
    id: uuid(),
    route,
    data,
  }
  return wrapMessage(protocolMessage)
}

main().catch(err => {
  console.error('Node server error:', err)
  process.exit(1)
})
