import AsyncLock from 'async-lock'
import crypto from 'node:crypto'
import {
  assertThat,
  createCypheredResponse,
  genSessionKey,
  Message,
  Premaster,
  READY_MESSAGE
} from '../helpers'
import {
  ClientDataMessages,
  ClientMessages,
  MessageResponse,
  SMessageInitialHandShake,
  SMessageReady
} from './messages'

export class ServerHandShakeHandler {
  private readonly handleRequest: (
    request: ClientDataMessages['request']
  ) => Promise<ClientDataMessages['response']>
  private readonly privateKey: string
  private readonly certificate: string
  private readonly lock: AsyncLock = new AsyncLock()

  private state:
    | 'initial_handshake'
    | 'premaster_secret'
    | 'ready'
    | 'ready_complete'

  private clientRandom: string | null = null
  private serverRandom: string | null = null
  private sessionSecret: ArrayBuffer | null = null

  constructor(opts: {
    handleRequest: ServerHandShakeHandler['handleRequest']
    privateKey: string
    certificate: string
  }) {
    this.state = 'initial_handshake'
    this.handleRequest = opts.handleRequest
    this.privateKey = opts.privateKey
    this.certificate = opts.certificate
  }

  async handleMessage(message: ClientMessages): Promise<SMessageInitialHandShake | SMessageReady | MessageResponse | void> {
    const { state } = this
    const handlers = {
      initial_handshake: (m: ClientMessages) =>
        this.lock.acquire('handshake', async () => {
          return await this.handleInitialHandShake(m)
        }),
      premaster_secret: (m: ClientMessages) =>
        this.lock.acquire('handshake', async () => {
          return await this.handlePremasterSecret(m)
        }),
      ready: (m: ClientMessages) =>
        this.lock.acquire('handshake', async () => {
          return await this.handleReady(m)
        }),
      ready_complete: (m: ClientMessages) =>
        this.handleReadyComplete(m)
    } as const

    const handler = handlers[state]
    return await handler(message)
  }

  private async handleInitialHandShake(
    message: ClientMessages
  ): Promise<SMessageInitialHandShake> {
    assertThat(
      message.type === 'initial_handshake',
      `Expected initial_handshake message`
    )

    const clientRandom = message.random
    this.clientRandom = clientRandom

    const serverRandom = crypto.randomBytes(32).toString('hex')
    this.serverRandom = serverRandom
    this.state = 'premaster_secret'

    const initialMsg: SMessageInitialHandShake = {
      type: 'initial_handshake',
      random: serverRandom,
      sslCertificate: this.certificate
    }
    return initialMsg
  }

  private async handlePremasterSecret(
    message: ClientMessages
  ): Promise<SMessageReady> {
    assertThat(message.type === 'premaster', `Expected premaster message`)

    const premaster = Premaster.decrypt({
      premaster: message.premaster,
      privateKey: this.privateKey
    })

    const key = await genSessionKey({
      premasterSecret: premaster,
      clientRandom: this.getClientRandom(),
      serverRandom: this.getServerRandom()
    })
    this.sessionSecret = key
    this.state = 'ready'

    const readyMsg: SMessageReady = {
      type: 'ready',
      payload: Message.encrypt({
        sessionKey: Buffer.from(new Uint8Array(this.getSessionKey())),
        message: READY_MESSAGE
      })
    }
    return readyMsg
  }

  private async handleReady(message: ClientMessages): Promise<void> {
    assertThat(message.type === 'ready', `Expected ready message`)

    const payload = Message.decrypt({
      message: message.payload,
      sessionKey: this.getSessionKey()
    })
    assertThat(payload === READY_MESSAGE, `Expected ready payload message`)

    this.state = 'ready_complete'
  }

  private async handleReadyComplete(
    request: ClientMessages
  ): Promise<MessageResponse> {
    assertThat(
      request.type === 'data',
      `Expected data message in ready_complete state`
    )

    const decrypted = Message.decrypt({
      message: request.payload,
      sessionKey: this.getSessionKey()
    })
    const parsed = JSON.parse(decrypted) as ClientDataMessages['request']
    const response = await this.handleRequest(parsed)
    const cyphered = createCypheredResponse(this.getSessionKey(), response)
    return cyphered
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

  private getSessionKey(): NonNullable<typeof this.sessionSecret> {
    const key = this.sessionSecret
    assertThat(key, 'sessionSecret not set')
    return key!
  }
}
