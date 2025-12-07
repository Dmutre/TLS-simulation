import crypto from 'node:crypto'
import net from 'node:net'
import {
  assertThat,
  createCypheredRequest,
  genSessionKey,
  Message,
  Premaster,
  READY_MESSAGE,
  sendWithPacketLimit
} from '../helpers'
import {
  ClientDataMessages,
  ClientMessages,
  MessageRequest,
  MessageResponse,
  ServerMessages
} from './messages'
import { DataHandler, wrapMessage } from './dataHandler'

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

async function verifyCertificateViaCa(opts: {
  caHost: string
  caPort: number
  certificatePem: string
  host: string
}) {
  const { caHost, caPort, certificatePem, host } = opts

  const socket = net.createConnection({ host: caHost, port: caPort })

  const respPromise = new Promise<VerifyCertResponse>((resolve, reject) => {
    const handler = new DataHandler(buffer => {
      const msg = JSON.parse(buffer.toString()) as VerifyCertResponse
      resolve(msg)
      socket.end()
    })
    socket.on('data', d => handler.appendData(d))
    socket.on('error', reject)
  })

  const req: VerifyCertRequest = {
    type: 'verify_cert',
    certificatePem,
    host
  }
  const buf = wrapMessage(req)
  sendWithPacketLimit(socket, buf)

  const resp = await respPromise
  if (!resp.valid) {
    throw new Error(resp.error ?? 'Certificate is not valid according to CA')
  }
}

export class ClientHandShakeHandler {
  private readonly writeMessage: (data: ClientMessages) => Promise<void>
  private readonly onReady: (
    createMessage: (msg: ClientDataMessages['request']) => MessageRequest
  ) => void
  private readonly caHost: string
  private readonly caPort: number
  private readonly serverHost: string
  private state: 'initiate_handshake' | 'premaster_sent' | 'ready' | 'ready_complete'

  private clientRandom: string | null = null
  private serverRandom: string | null = null
  private sslCertificate: string | null = null
  private premasterSecret: string | null = null
  private sessionSecret: ArrayBuffer | null = null

  constructor(opts: {
    writeMessage: ClientHandShakeHandler['writeMessage']
    onReady: ClientHandShakeHandler['onReady']
    caHost: string
    caPort: number
    serverHost: string
  }) {
    this.state = 'initiate_handshake'
    this.writeMessage = opts.writeMessage
    this.onReady = opts.onReady
    this.caHost = opts.caHost
    this.caPort = opts.caPort
    this.serverHost = opts.serverHost
  }

  async handleMessage(message: ServerMessages) {
    const handlers: Record<
      ClientHandShakeHandler['state'],
      (message: ServerMessages) => Promise<void> | void
    > = {
      initiate_handshake: this.handleInitiateHandShake.bind(this),
      premaster_sent: this.handlePremasterAck.bind(this),
      ready: this.handleReady.bind(this),
      ready_complete: this.handleReadyComplete.bind(this)
    }
    const handler = handlers[this.state]
    return await handler(message)
  }

  handleResponse(response: MessageResponse | undefined) {
    if (this.state !== 'ready_complete' || !response) {
      return
    }
    const payload = Message.decrypt({
      message: response.payload,
      sessionKey: this.getSessionKey()
    })
    const res = JSON.parse(payload) as ClientDataMessages['response']
    return res
  }

  async initiateHandShake() {
    const clientRandom = crypto.randomBytes(32).toString('hex')
    this.clientRandom = clientRandom

    await this.writeMessage({
      type: 'initial_handshake',
      random: clientRandom
    })
  }

  private async handleInitiateHandShake(message: ServerMessages) {
    assertThat(
      message.type === 'initial_handshake',
      `Expected initial_handshake message`
    )

    const { random, sslCertificate } = message

    this.serverRandom = random

    await verifyCertificateViaCa({
      certificatePem: sslCertificate,
      caHost: this.caHost,
      caPort: this.caPort,
      host: this.serverHost
    })
    this.sslCertificate = sslCertificate

    const { encrypted: premaster, decrypted: premasterSecret } =
      Premaster.encrypt({ sslCertificate })
    this.premasterSecret = premasterSecret
    
    const premasterMsg = {
      type: 'premaster' as const,
      premaster
    }

    await this.writeMessage(premasterMsg)
    this.state = 'premaster_sent'
  }

  private async handlePremasterAck(message: ServerMessages) {
    assertThat(
      message.type === 'premaster_ack',
      `Expected premaster_ack message`
    )

    const key = await genSessionKey({
      premasterSecret: this.getPremasterSecret(),
      clientRandom: this.getClientRandom(),
      serverRandom: this.getServerRandom()
    })
    this.sessionSecret = key

    this.state = 'ready'
    const readyMsg = {
      type: 'ready' as const,
      payload: Message.encrypt({
        sessionKey: Buffer.from(new Uint8Array(this.getSessionKey())),
        message: READY_MESSAGE
      })
    }
    await this.writeMessage(readyMsg)
  }

  private handleReady(message: ServerMessages) {
    assertThat(message.type === 'ready', `Expected ready message`)

    const payload = Message.decrypt({
      message: message.payload,
      sessionKey: this.getSessionKey()
    })
    assertThat(payload === READY_MESSAGE, `Expected ready payload message`)

    this.state = 'ready_complete'

    this.onReady(msg => createCypheredRequest(this.getSessionKey(), msg))
  }

  private handleReadyComplete(_message: ServerMessages) {
  }

  private getClientRandom(): string {
    const random = this.clientRandom
    assertThat(random, 'clientRandom not set')
    return random!
  }

  private getServerRandom(): string {
    const random = this.serverRandom
    assertThat(random, 'serverRandom not set')
    return random!
  }

  private getPremasterSecret(): string {
    const secret = this.premasterSecret
    assertThat(secret, 'premasterSecret not set')
    return secret
  }

  private getSessionKey(): NonNullable<typeof this.sessionSecret> {
    const key = this.sessionSecret
    assertThat(key, 'sessionSecret not set')
    return key!
  }
}
