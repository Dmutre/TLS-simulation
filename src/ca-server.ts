import net from 'node:net'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DataHandler, wrapMessage } from './protocol/dataHandler'
import { verifyCertificateSafe, SECRETS_PATH, parseArgs } from './helpers'

type VerifyCertRequest = {
  type: 'verify_cert'
  certificatePem: string
  host: string
}

type VerifyCertResponse = {
  type: 'verify_result'
  valid: boolean
  error?: string
}

const main = async () => {
  const args = parseArgs()
  const port = Number(args['port'] ?? 9000)

  // rootCA лежить у secrets/rootCA.crt (можеш змінити шлях)
  const rootCaPath = path.join(SECRETS_PATH, 'rootCA.crt')
  console.log('CA: loading root CA from', rootCaPath)
  console.log('SECRETS_PATH:', SECRETS_PATH)
  const rootCaPem = await fs.readFile(rootCaPath, 'utf-8')

  const server = net.createServer(socket => {
    console.log('CA: new client connected')

    const handler = new DataHandler(async (messageBuffer: Buffer) => {
      const msg = JSON.parse(messageBuffer.toString()) as VerifyCertRequest
      if (msg.type !== 'verify_cert') {
        const resp: VerifyCertResponse = {
          type: 'verify_result',
          valid: false,
          error: 'Unknown message type'
        }
        return sendWithResponse(socket, resp)
      }

      let valid = false
      let error: string | undefined
      try {
        valid = verifyCertificateSafe({
          certificatePem: msg.certificatePem,
          rootCaPem,
          host: msg.host
        })
      } catch (e: any) {
        error = e?.message ?? String(e)
      }

      const resp: VerifyCertResponse = { type: 'verify_result', valid, error }
      sendWithResponse(socket, resp)
    })

    socket.on('data', data => handler.appendData(data))
  })

  server.listen(port, () =>
    console.log(`CA server listening on port ${port}`)
  )
}

const sendWithResponse = (socket: net.Socket, resp: VerifyCertResponse) => {
  const buffer = wrapMessage(resp)
  // Тут теж симулюємо slow radio
  const { sendWithPacketLimit } = require('./helpers') as typeof import('./helpers')
  sendWithPacketLimit(socket, buffer)
}

main().catch(err => {
  console.error('CA server error:', err)
  process.exit(1)
})
