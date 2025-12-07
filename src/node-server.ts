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
      this.connections.delete(key)
      this.messageHandlers.delete(key)
    }

    const socket = net.createConnection({ host: 'localhost', port })
    
    const handler = new DataHandler(buffer => {
      const resp = JSON.parse(buffer.toString()) as ProtocolMessage<any>
      this.handleResponse(key, resp)
    })
    
    socket.on('data', d => handler.appendData(d))
    socket.on('error', err => {
      const errorCode = (err as any).code
      if (errorCode === 'ECONNREFUSED') {
        console.error(`[ConnectionManager] Connection refused to ${key} - node is not running`)
      } else {
        console.error(`[ConnectionManager] Error on connection ${key}:`, err)
      }
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
    
    let matchedIndex = -1
    if (message.data && typeof message.data === 'object' && 'type' in message.data) {
      if (message.data.type === 'received') {
        const received = message.data as MessageReceived<unknown>
        matchedIndex = pending.findIndex(p => p.messageId === received.messageId)
      }
    }
    
    if (matchedIndex === -1) {
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
    
    return new Promise((resolve, reject) => {
      let socket: net.Socket
      try {
        socket = this.getOrCreateConnection(node, port)
      } catch (err: any) {
        reject(new Error(`Failed to connect to ${node}:${port} - ${err.message}`))
        return
      }
      
      const connectionErrorHandler = (err: Error) => {
        const errorCode = (err as any).code
        if (errorCode === 'ECONNREFUSED') {
          reject(new Error(`Connection refused to ${node}:${port} - node is not running`))
        } else {
          reject(new Error(`Connection error to ${node}:${port} - ${err.message}`))
        }
      }
      
      socket.once('error', connectionErrorHandler)
      
      if (!this.pendingMessages.has(key)) {
        this.pendingMessages.set(key, [])
      }
      
      this.pendingMessages.get(key)!.push({
        resolve: (value) => {
          socket.removeListener('error', connectionErrorHandler)
          resolve(value)
        },
        reject: (reason) => {
          socket.removeListener('error', connectionErrorHandler)
          reject(reason)
        },
        messageId: msg.id
      })

      const buf = wrapMessage(msg)
      try {
        sendWithPacketLimit(socket, buf)
      } catch (err: any) {
        socket.removeListener('error', connectionErrorHandler)
        reject(new Error(`Failed to send message to ${node}:${port} - ${err.message}`))
      }
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
            case 'broadcast':
              return await handleBroadcast(req.message, graph, connectionManager, config.NODE_NAME)
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
        try {
          const resp = await connectionManager.sendMessage(nextNode, nextPort, msg)
          
          sendWithPacketLimit(socket, wrapMessage(resp))
          
          const originalFirstNode = msg.route[0]
          const isFinalResponse = resp.route.length > 0 && 
                                  resp.route[0] === originalFirstNode &&
                                  resp.data && 
                                  typeof resp.data === 'object' && 
                                  'type' in resp.data && 
                                  resp.data.type === 'received'
          
          const wasLastIntermediate = currentIndex === msg.route.length - 2
          if (isFinalResponse && wasLastIntermediate) {
            setTimeout(() => {
              connectionManager.closeConnection(nextNode, nextPort)
            }, 200)
          }
        } catch (err: any) {
          console.error(`[${config.NODE_NAME}] Error forwarding to ${nextNode}:`, err.message)
          const errorResponse: MessageReceived<{ error: string }> = {
            type: 'received',
            messageId: msg.id,
            response: { error: `Failed to forward to ${nextNode}: ${err.message}` }
          }
          const errorMsg = createProtocolMessage(errorResponse, msg.route.toReversed())
          sendWithPacketLimit(socket, errorMsg)
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
        try {
          sendWithPacketLimit(socket, response)
          
          const isFinalResponse = (result as any)?.type === 'response'
          if (isFinalResponse) {
            const closeSocket = () => {
              setTimeout(() => {
                if (!socket.destroyed && socket.writable) {
                  socket.end()
                }
              }, 200)
            }
            
            if (socket.writableLength === 0) {
              closeSocket()
            } else {
              socket.once('drain', closeSocket)
              setTimeout(closeSocket, 500)
            }
          }
        } catch (err) {
          console.error(`[${config.NODE_NAME}] Error sending response:`, err)
        }
      } else {
        const response = createProtocolMessage(
          result,
          msg.route.toReversed(),
        )
        try {
          sendWithPacketLimit(socket, response)
        } catch (err) {
          console.error(`[${config.NODE_NAME}] Error sending response:`, err)
        }
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
  
  process.on('SIGINT', () => {
    connectionManager.closeAll()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    connectionManager.closeAll()
    process.exit(0)
  })
}

const handleBroadcast = async (
  message: string,
  graph: ReturnType<typeof createMap>,
  connectionManager: ConnectionManager,
  currentNode: string
): Promise<{ responses: Array<{ node: string; response: any }> }> => {
  const allNodes = graph.getAllReachableNodes(currentNode)
  const targetNodes = allNodes.filter(node => node !== currentNode)
  
  console.log(`[${currentNode}] Broadcasting to nodes:`, targetNodes)
  
  const responses: Array<{ node: string; response: any }> = []
  
  responses.push({
    node: currentNode,
    response: { ok: true, message: `[${currentNode}] Received broadcast: ${message}` }
  })
  
  return { responses }
}

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
