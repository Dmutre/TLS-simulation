import net from 'node:net'
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

const guessPortForNode = (node: string): number => {
  const base = 7000
  const offset = node.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  return base + offset
}

interface NodeResponse {
  node: string
  response: any
  error?: string
}

const sendMessageToNode = async (
  from: string,
  to: string,
  route: string[],
  message: string,
  caHost: string,
  caPort: number,
  action: 'echo' | 'chat' | 'broadcast' = 'echo'
): Promise<NodeResponse> => {
  return new Promise((resolve, reject) => {
    const firstNode = route[0]
    const firstPort = guessPortForNode(firstNode)
    
    const socket = net.createConnection({
      host: 'localhost',
      port: firstPort,
    })

    let createEncryptedRequest: ((msg: ClientDataMessages['request']) => MessageRequest) | null = null
    let responseReceived = false

    const handler = new DataHandler(async buffer => {
      const msg = JSON.parse(buffer.toString()) as ProtocolMessage<
        ServerMessages | MessageResponse | MessageReceived<MessageResponse | undefined>
      >

      const data: any = msg.data

      if (data.type === 'initial_handshake' || data.type === 'ready' || data.type === 'premaster_ack') {
        await handshake.handleMessage(data as ServerMessages)
        return
      }

      if (data.type === 'response') {
        const maybe = handshake.handleResponse(data as MessageResponse)
        if (maybe) {
          responseReceived = true
          clearTimeout(timeout)
          resolve({
            node: to,
            response: maybe
          })
          setTimeout(() => {
            socket.end()
          }, 100)
        }
        return
      }

      if (data.type === 'received') {
        const received = data as MessageReceived<MessageResponse | undefined>
        if (received.response) {
          if ((received.response as any).type === 'response') {
            const maybe = handshake.handleResponse(received.response as MessageResponse)
            if (maybe) {
              responseReceived = true
              clearTimeout(timeout)
              resolve({
                node: to,
                response: maybe
              })
              setTimeout(() => {
                socket.end()
              }, 100)
            }
          } else {
            responseReceived = true
            clearTimeout(timeout)
            resolve({
              node: to,
              response: received.response
            })
            setTimeout(() => {
              socket.end()
            }, 100)
          }
        } else {
          console.warn(`[Broadcast] Received ACK without response from ${to}`)
        }
        return
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
        void sendData()
      },
    })

    socket.on('data', d => handler.appendData(d))
    
    socket.on('error', err => {
      clearTimeout(timeout)
      if (!responseReceived) {
        responseReceived = true
        const errorMsg = (err as any).code === 'ECONNREFUSED' 
          ? `Connection refused - node ${to} is not running on port ${guessPortForNode(to)}`
          : (err as any).code === 'ECONNRESET'
          ? `Connection reset - node ${to} closed the connection`
          : err.message
        resolve({
          node: to,
          response: null,
          error: errorMsg
        })
      }
    })

    socket.on('close', () => {
      if (!responseReceived) {
        responseReceived = true
        clearTimeout(timeout)
        resolve({
          node: to,
          response: null,
          error: 'Connection closed before response'
        })
      }
    })

    const timeout = setTimeout(() => {
      if (!responseReceived) {
        responseReceived = true
        socket.destroy()
        resolve({
          node: to,
          response: null,
          error: `Timeout waiting for response from ${to} (10s)`
        })
      }
    }, 15000) // 15 second timeout (increased for multi-hop routes)

    handshake.initiateHandShake().catch(err => {
      clearTimeout(timeout)
      if (!responseReceived) {
        responseReceived = true
        resolve({
          node: to,
          response: null,
          error: `Handshake failed: ${err.message}`
        })
      }
    })

    async function sendData() {
      if (!createEncryptedRequest) return

      const payload: ClientDataMessages['request'] = {
        action,
        message,
      } as any

      const encryptedReq = createEncryptedRequest(payload)
      const protocolMsg: ProtocolMessage<MessageRequest> = {
        id: crypto.randomUUID(),
        route,
        data: encryptedReq,
      }
      const buf = wrapMessage(protocolMsg)
      sendWithPacketLimit(socket, buf)
    }
  })
}

const main = async () => {
  const args = parseArgs()
  const from = args['from'] ?? 'A'
  const routeMap = args['routeMap'] ?? 'A:B,B:C,C:D,C:E'
  const caHost = args['caHost'] ?? 'localhost'
  const caPort = Number(args['caPort'] ?? 9000)
  const message = args['message'] ?? 'Broadcast message'
  const action = (args['action'] as 'echo' | 'chat' | 'broadcast') ?? 'echo'

  const graph = createMap(routeMap)
  
  const allNodes = graph.getAllReachableNodes(from)
  const allGraphNodes = graph.getAllNodes()
  
  const validNodes = allNodes.filter(node => allGraphNodes.includes(node))
  
  if (validNodes.length !== allNodes.length) {
    const invalidNodes = allNodes.filter(node => !allGraphNodes.includes(node))
    console.warn(`[Broadcast] Warning: Found nodes not in graph: ${invalidNodes.join(', ')}`)
  }
  
  console.log(`[Broadcast] Starting from node ${from}`)
  console.log(`[Broadcast] Route map: ${routeMap}`)
  console.log(`[Broadcast] Nodes in graph: ${allGraphNodes.join(', ')}`)
  console.log(`[Broadcast] Reachable nodes: ${validNodes.join(', ')}`)
  console.log(`[Broadcast] Sending message: "${message}"`)
  console.log('')

  const responses: NodeResponse[] = []
  const unavailableNodes = new Set<string>()

  for (const targetNode of validNodes) {
    if (unavailableNodes.has(targetNode)) {
      console.warn(`[Broadcast] Node ${targetNode} is marked as unavailable, skipping`)
      continue
    }

    const route = graph.findRoute(from, targetNode, unavailableNodes)
    if (!route) {
      console.warn(`[Broadcast] No route found to node ${targetNode} (possibly due to unavailable intermediate nodes), skipping`)
      responses.push({
        node: targetNode,
        response: null,
        error: 'No route found (unavailable nodes in path)'
      })
      continue
    }
    
    const allGraphNodes = graph.getAllNodes()
    if (!allGraphNodes.includes(targetNode)) {
      console.warn(`[Broadcast] Node ${targetNode} not in graph, skipping`)
      responses.push({
        node: targetNode,
        response: null,
        error: 'Node not in graph'
      })
      continue
    }

    console.log(`[Broadcast] Sending to ${targetNode} via route: ${route.join(' -> ')}`)
    
    try {
      const response = await sendMessageToNode(
        from,
        targetNode,
        route,
        message,
        caHost,
        caPort,
        action
      )
      
      if (response.error) {
        const isCriticalError = response.error.includes('Connection refused') || 
                                response.error.includes('ECONNREFUSED') ||
                                response.error.includes('not running') ||
                                response.error.includes('Failed to forward') ||
                                response.error.includes('Connection error')
        
        if (isCriticalError) {
          unavailableNodes.add(targetNode)
          console.warn(`[Broadcast] Node ${targetNode} is unavailable, marking for exclusion`)
          
          if (response.error.includes('Failed to forward')) {
            const match = response.error.match(/Failed to forward to (\w+):/)
            if (match && match[1]) {
              const failedNode = match[1]
              unavailableNodes.add(failedNode)
              console.warn(`[Broadcast] Intermediate node ${failedNode} is also unavailable, marking for exclusion`)
            }
          }
        }
      }
      
      responses.push(response)
      console.log(`[Broadcast] Response from ${targetNode}:`, response.error || JSON.stringify(response.response, null, 2))
      console.log('')
    } catch (err: any) {
      const isCriticalError = err.message?.includes('Connection refused') || 
                              err.message?.includes('ECONNREFUSED') ||
                              err.code === 'ECONNREFUSED'
      
      if (isCriticalError) {
        unavailableNodes.add(targetNode)
        console.warn(`[Broadcast] Node ${targetNode} is unavailable, marking for exclusion`)
      }
      
      console.error(`[Broadcast] Error sending to ${targetNode}:`, err.message)
      responses.push({
        node: targetNode,
        response: null,
        error: err.message
      })
      console.log('')
    }
  }

  console.log('='.repeat(50))
  console.log('Broadcast Summary:')
  console.log('='.repeat(50))
  console.log(`Total nodes: ${validNodes.length}`)
  console.log(`Successful: ${responses.filter(r => !r.error).length}`)
  console.log(`Failed: ${responses.filter(r => r.error).length}`)
  if (unavailableNodes.size > 0) {
    console.log(`Unavailable nodes (excluded from graph): ${Array.from(unavailableNodes).join(', ')}`)
  }
  console.log('')
  console.log('Responses:')
  for (const resp of responses) {
    if (resp.error) {
      console.log(`  ${resp.node}: ERROR - ${resp.error}`)
    } else {
      console.log(`  ${resp.node}:`, JSON.stringify(resp.response, null, 2))
    }
  }
}

main().catch(err => {
  console.error('Broadcast client error:', err)
  process.exit(1)
})

