import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import {
  ClientDataMessages,
  MessageReceived,
  MessageRequest,
  MessageResponse
} from './protocol/messages'

export const getPort = (): number => {
  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 8080
  return port
}

export const isRunningInDocker = (): boolean => {
  const isDocker = process.env['DOCKER'] === 'true'
  return isDocker
}

export const getNeighbourHosts = (): string => {
  const neighbours = process.env['NEIGHBOURS']
  assertThat(neighbours, 'NEIGHBOURS environment variable is not set')
  return neighbours
}

export const getHostName = (): string => {
  const hostName = isRunningInDocker()
    ? process.env['HOSTNAME']
    : 'localhost'
  assertThat(hostName, 'HOSTNAME environment variable is not set')
  return hostName
}

export const getNodeName = (): string => {
  return process.env['NODE_NAME'] || 'A'
}

export const SECRETS_PATH = path.join(__dirname, '..', 'secrets')

export const getRootCaCert = async (): Promise<string> => {
  // За замовчуванням root CA лежить у secrets/rootCA.crt
  const certificatePath = path.join(SECRETS_PATH, 'rootCA.crt')
  const certificate = await fs.readFile(certificatePath, 'utf-8')
  return certificate
}

export function assertThat(
  condition: any,
  message: string = 'Assertion failed'
): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

// ----- Promise helper -----

type Resolver<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: any) => void
}

const createPromiseWithResolvers = <T>(): Resolver<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: any) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ----- MessageConsumer -----

export class MessageConsumer {
  private messages: Partial<Record<string, Resolver<unknown>>> = {}

  consume({ messageId, response }: MessageReceived<unknown>) {
    this.messages[messageId]?.resolve(response)
    delete this.messages[messageId]
  }

  async waitForConsumed<T>(id: string): Promise<T> {
    if (!this.messages[id]) {
      this.messages[id] = createPromiseWithResolvers<unknown>()
    }
    return (await this.messages[id]!.promise) as T
  }
}

// ----- Premaster / Session key -----

export const Premaster = {
  encrypt: ({ sslCertificate }: { sslCertificate: string }) => {
    const publicKey = crypto.createPublicKey(sslCertificate)
    const premasterSecret = crypto.randomBytes(48) // як у real TLS
    const encryptedPremaster = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      premasterSecret
    )
    return {
      encrypted: encryptedPremaster.toString('base64'),
      decrypted: premasterSecret.toString('hex')
    }
  },
  decrypt: ({
    premaster,
    privateKey
  }: {
    premaster: string
    privateKey: string
  }) => {
    const premasterEncrypted = Buffer.from(premaster, 'base64')
    const decrypted = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      premasterEncrypted
    )

    return decrypted.toString('hex')
  }
}

export const genSessionKey = async ({
  premasterSecret,
  clientRandom,
  serverRandom
}: {
  premasterSecret: string
  clientRandom: string
  serverRandom: string
}) => {
  const salt = Buffer.concat([
    Buffer.from(clientRandom, 'hex'),
    Buffer.from(serverRandom, 'hex')
  ])
  const infoLabel = 'tls13 derived'
  const len = 32

  // Тут обіцяємо ArrayBufferLike, щоб не сварився TS на resolve(...)
  const { promise, resolve, reject } = createPromiseWithResolvers<ArrayBufferLike>()

  crypto.hkdf(
    'sha256',
    Buffer.from(premasterSecret, 'hex'),
    salt,
    Buffer.from(infoLabel),
    len,
    (err, derivedKey) => {
      if (err) {
        reject(err)
        return
      }

      // derivedKey у тайпінгах може бути ArrayBuffer / Buffer / ArrayBufferView -> нормалізуємо
      const view = new Uint8Array(derivedKey as ArrayBufferLike)
      resolve(view.buffer) // тип: ArrayBufferLike, TS ок
    }
  )

  const result = await promise
  // А назовні повертаємо як ArrayBuffer, бо нам SharedArrayBuffer не потрібен
  return result as ArrayBuffer
}


// ----- Symmetric encryption (AES-256-GCM) -----

export const Message = {
  encrypt: ({
    message,
    sessionKey
  }: {
    message: string
    sessionKey: Buffer
  }) => {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv)

    const encrypted = Buffer.concat([
      cipher.update(message, 'utf8'),
      cipher.final()
    ])

    const authTag = cipher.getAuthTag()

    return Buffer.concat([iv, authTag, encrypted]).toString('base64')
  },
  decrypt: ({
    sessionKey,
    message
  }: {
    sessionKey: ArrayBuffer
    message: string
  }) => {
    const data = Buffer.from(message, 'base64')

    const iv = data.subarray(0, 12)
    const authTag = data.subarray(12, 28)
    const ciphertext = data.subarray(28)

    const key = Buffer.from(new Uint8Array(sessionKey))
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ])

    return decrypted.toString('utf8')
  }
}

export const createCypheredRequest = (
  key: ArrayBuffer,
  msg: ClientDataMessages['request']
): MessageRequest => {
  const message = JSON.stringify(msg)
  const sessionKey = Buffer.from(new Uint8Array(key))
  const encrypted = Message.encrypt({
    message,
    sessionKey
  })
  const request: MessageRequest = {
    type: 'data',
    payload: encrypted
  }
  return request
}

export const createCypheredResponse = (
  key: ArrayBuffer,
  msg: ClientDataMessages['response']
): MessageResponse => {
  const message = JSON.stringify(msg)
  const sessionKey = Buffer.from(new Uint8Array(key))
  const encrypted = Message.encrypt({
    message,
    sessionKey
  })
  const response: MessageResponse = {
    type: 'response',
    payload: encrypted
  }
  return response
}

export const READY_MESSAGE = 'ready'

// ----- Certificate verification -----

export const verifyCertificate = ({
  certificatePem,
  rootCaPem,
  host
}: {
  certificatePem: string
  rootCaPem: string
  host: string
}) => {
  const now = new Date()

  const rootCert = new crypto.X509Certificate(rootCaPem)
  assertThat(new Date(rootCert.validFrom) <= now, 'Root CA not yet valid')
  assertThat(new Date(rootCert.validTo) >= now, 'Root CA expired')

  const serverCert = new crypto.X509Certificate(certificatePem)
  assertThat(
    new Date(serverCert.validFrom) <= now,
    'Certificate not yet valid'
  )
  assertThat(new Date(serverCert.validTo) >= now, 'Certificate expired')

  const isMatching = serverCert.checkHost(host)
  assertThat(isMatching, 'Certificate host mismatch')

  const isSigned = serverCert.verify(rootCert.publicKey)
  assertThat(isSigned, 'Certificate signature invalid')
}

export const verifyCertificateSafe = ({
  certificatePem,
  rootCaPem,
  host
}: {
  certificatePem: string
  rootCaPem: string
  host: string
}): boolean => {
  try {
    verifyCertificate({ certificatePem, rootCaPem, host })
    return true
  } catch (_) {
    return false
  }
}

// ----- Misc helpers -----

export const sleep = ({ ms }: { ms: number }) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Обмеження розміру "радіо"-пакету
export const MAX_PACKET_SIZE = 64

export const sendWithPacketLimit = (socket: net.Socket, buffer: Buffer) => {
  for (let offset = 0; offset < buffer.length; offset += MAX_PACKET_SIZE) {
    const chunk = buffer.subarray(offset, offset + MAX_PACKET_SIZE)
    socket.write(chunk)
  }
}

// Дуже простий парсер CLI аргументів типу --key value
export const parseArgs = (): Record<string, string> => {
  const args = process.argv.slice(2)
  const res: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const value = args[i + 1]
      res[key] = value
      i++
    }
  }
  return res
}
