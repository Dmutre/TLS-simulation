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

// Connection manager to maintain persistent connections
class ConnectionManager {
  private connections = new Map<string, net.Socket>()
  private pendingMessages = new Map<string, Array<{
    resolve: (value: ProtocolMessage<any>) => void
    reject: (reason?: any) => void
    messageId: string
  }>>()
  private messageHandlers = new Map<string, DataHandler>()

  getOrCreateConnection(node: string, port: number): net.Socket {
    const key = `${node}:${port}`
    
    if (this.connections.has(key)) {
      const existing = this.connections.get(key)!
      if (!existing.destroyed && existing.writable) {
        return existing
      }
      // Connection is dead, remove it
      this.connections.delete(key)
      this.messageHandlers.delete(key)
    }

    const socket = net.createConnection({ host: 'localhost', port })
    
    // Set up message handler for this connection
    const handler = new DataHandler(buffer => {
      const resp = JSON.parse(buffer.toString()) as ProtocolMessage<any>
      this.handleResponse(key, resp)
    })
    
    socket.on('data', d => handler.appendData(d))
    socket.on('error', err => {
      console.error(`[ConnectionManager] Error on connection ${key}:`, err)
      this.handleConnectionError(key, err)
    })
    socket.on('close', () => {
      console.log(`[ConnectionManager] Connection ${key} closed`)
      this.connections.delete(key)
      this.messageHandlers.delete(key)
    })
    socket.on('end', () => {
      this.connections.delete(key)
      this.messageHandlers.delete(key)
    })

    this.connections.set(key, socket)
    this.messageHandlers.set(key, handler)
    
    return socket
  }

  private handleResponse(connectionKey: string, message: ProtocolMessage<any>) {
    const pending = this.pendingMessages.get(connectionKey) || []
    
    if (pending.length === 0) {
      console.warn(`[ConnectionManager] Received response for ${connectionKey} but no pending messages`)
      return
    }
    
    // Try to find matching pending message by message ID first
    let matchedIndex = -1
    if (message.data && typeof message.data === 'object' && 'type' in message.data) {
      // If it's a "received" message, check the messageId inside
      if (message.data.type === 'received') {
        const received = message.data as MessageReceived<unknown>
        matchedIndex = pending.findIndex(p => p.messageId === received.messageId)
      }
    }
    
    // If not found by messageId, try by route direction (response should have reversed route)
    if (matchedIndex === -1) {
      // For now, use FIFO - take the first pending message
      // This works because messages are sent sequentially
      matchedIndex = 0
    }
    
    if (matchedIndex !== -1) {
      const { resolve } = pending[matchedIndex]
      pending.splice(matchedIndex, 1)
      resolve(message)
    }
    
    if (pending.length === 0) {
      this.pendingMessages.delete(connectionKey)
    } else {
      this.pendingMessages.set(connectionKey, pending)
    }
  }

  private handleConnectionError(connectionKey: string, error: Error) {
    const pending = this.pendingMessages.get(connectionKey) || []
    pending.forEach(({ reject }) => reject(error))
    this.pendingMessages.delete(connectionKey)
    this.connections.delete(connectionKey)
    this.messageHandlers.delete(connectionKey)
  }

  async sendMessage(
    node: string,
    port: number,
    msg: ProtocolMessage<any>
  ): Promise<ProtocolMessage<any>> {
    const key = `${node}:${port}`
    const socket = this.getOrCreateConnection(node, port)
    
    return new Promise((resolve, reject) => {
      if (!this.pendingMessages.has(key)) {
        this.pendingMessages.set(key, [])
      }
      
      this.pendingMessages.get(key)!.push({
        resolve,
        reject,
        messageId: msg.id
      })

      const buf = wrapMessage(msg)
      sendWithPacketLimit(socket, buf)
    })
  }

  closeConnection(node: string, port: number) {
    const key = `${node}:${port}`
    const socket = this.connections.get(key)
    if (socket && !socket.destroyed) {
      socket.end()
    }
    this.connections.delete(key)
    this.messageHandlers.delete(key)
    this.pendingMessages.delete(key)
  }

  closeAll() {
    for (const [key, socket] of this.connections.entries()) {
      if (!socket.destroyed) {
        socket.end()
      }
    }
    this.connections.clear()
    this.messageHandlers.clear()
    this.pendingMessages.clear()
  }
}

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
    args['routeMap'] ?? 'A:B,B:C,C:D,C:E'

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

  const connectionManager = new ConnectionManager()
  const handshakeHandlers = new Map<string, ServerHandShakeHandler>()

  const getOrCreateHandshakeHandler = (route: string[]) => {
    const routeKey = route.join(':')
    if (!handshakeHandlers.has(routeKey)) {
      handshakeHandlers.set(routeKey, new ServerHandShakeHandler({
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
      }))
    }
    return handshakeHandlers.get(routeKey)!
  }

  const server = net.createServer(socket => {
    console.log(
      `[${config.NODE_NAME}] new client`,
      socket.remoteAddress,
      socket.remotePort,
    )

    const messageConsumer = new MessageConsumer()

    const handler = new DataHandler(async messageBuffer => {
      const raw = messageBuffer.toString()
      console.log('Raw message:', raw)
      const msg = JSON.parse(raw) as ProtocolMessage<
        ClientMessages | MessageReceived
      >

      const isFinal = msg.route.at(-1) === config.NODE_NAME
      if (!isFinal) {
        const currentIndex = msg.route.findIndex(n => n === config.NODE_NAME)
        const nextNode = msg.route[currentIndex + 1]
        assertThat(nextNode, 'Next node is undefined in route')

        const nextPort = guessPortForNode(nextNode)
        const resp = await connectionManager.sendMessage(nextNode, nextPort, msg)
        
        sendWithPacketLimit(socket, wrapMessage(resp))
        
        // Check if this is the final response going back to the original client
        // The route is reversed when going back, so if route[0] is the original first node,
        // and we have a final response, we can close the connection
        const originalFirstNode = msg.route[0]
        const isFinalResponse = resp.route.length > 0 && 
                                resp.route[0] === originalFirstNode &&
                                resp.data && 
                                typeof resp.data === 'object' && 
                                'type' in resp.data && 
                                resp.data.type === 'received'
        
        // Only close connection if this is the final response reaching back to the client
        // and we're the last intermediate node (next node in original route was the final destination)
        const wasLastIntermediate = currentIndex === msg.route.length - 2
        if (isFinalResponse && wasLastIntermediate) {
          // Give a small delay to ensure message is sent before closing
          setTimeout(() => {
            connectionManager.closeConnection(nextNode, nextPort)
          }, 200)
        }
        return
      }
      if (msg.data.type === 'received') {
        messageConsumer.consume({
          messageId: msg.data.messageId,
          response: msg.data.response,
          type: 'received',
        })
        return
      }

      const handshakeHandler = getOrCreateHandshakeHandler(msg.route)
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
        
        // If this is the final node and we're sending a response, 
        // we can close the connection after a delay
        const isFinalResponse = (result as any)?.type === 'response'
        if (isFinalResponse) {
          setTimeout(() => {
            socket.end()
          }, 100)
        }
      } else {
        const response = createProtocolMessage(
          result,
          msg.route.toReversed(),
        )
        sendWithPacketLimit(socket, response)
      }
    })

    socket.on('data', data => handler.appendData(data))
    
    socket.on('close', () => {
      console.log(`[${config.NODE_NAME}] client disconnected`)
    })
  })

  server.listen(config.PORT, () => {
    console.log(
      `[${config.NODE_NAME}] listening on port ${config.PORT}`,
    )
  })
  
  // Cleanup on process exit
  process.on('SIGINT', () => {
    connectionManager.closeAll()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    connectionManager.closeAll()
    process.exit(0)
  })
}

const guessPortForNode = (node: string): number => {
  const base = 7000
  const offset = node.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  return base + offset
}

// forwardToNode is now handled by ConnectionManager.sendMessage
// This function is kept for backward compatibility but should not be used
const forwardToNode = async (
  node: string,
  port: number,
  msg: ProtocolMessage<any>,
): Promise<ProtocolMessage<any>> => {
  throw new Error('forwardToNode should not be called directly. Use ConnectionManager instead.')
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
