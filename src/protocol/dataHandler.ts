import crypto from 'node:crypto'
import { ProtocolMessage } from './messages'

const HEADER_END_SEQUENCE = '\r\n\r\n'

const findHeaderEndIndex = (data: Buffer): number => {
  const headerEndIndex = data.indexOf(HEADER_END_SEQUENCE)
  return headerEndIndex
}

const findContentLength = (data: Buffer): number | null => {
  const CONTENT_LENGTH_REGEX = /content-length: (\d+)/i
  const result = CONTENT_LENGTH_REGEX.exec(data.toString())
  if (result && result[1]) {
    return parseInt(result[1], 10)
  }
  return null
}

export class DataHandler {
  private buffer: Buffer
  private headerIndex: number | null = null
  private messageLength: number | null = null

  constructor(private readonly onMessage: (message: Buffer) => void | Promise<void>) {
    this.buffer = Buffer.alloc(0)
  }

  public appendData(data: Buffer) {
    this.buffer = Buffer.concat([this.buffer, data])

    let canProcess = true
    while (canProcess) {
      canProcess = this.processBuffer(this.buffer)
    }
  }

  private processBuffer(buffer: Buffer): boolean {
    const headerEndIndex = this.getHeaderIndex(buffer)
    if (headerEndIndex === null) {
      return false
    }

    const messageLength = this.getContentLength(buffer, headerEndIndex)

    const messageStartIndex = headerEndIndex + HEADER_END_SEQUENCE.length
    const isMessageComplete =
      buffer.length >= messageStartIndex + messageLength
    if (!isMessageComplete) {
      return false
    }

    const messageEndIndex = messageStartIndex + messageLength
    const message = buffer.subarray(messageStartIndex, messageEndIndex)

    const remainingBuffer = buffer.subarray(messageEndIndex)

    this.buffer = Buffer.from(remainingBuffer)
    this.headerIndex = null
    this.messageLength = null

    void this.onMessage(Buffer.from(message))
    return true
  }

  private getHeaderIndex(buffer: Buffer): number | null {
    if (this.headerIndex !== null) {
      return this.headerIndex
    }
    const headerEndIndex = findHeaderEndIndex(buffer)
    if (headerEndIndex === -1) {
      return null
    }
    this.headerIndex = headerEndIndex
    return this.headerIndex
  }

  private getContentLength(buffer: Buffer, headerEndIndex: number): number {
    if (this.messageLength !== null) {
      return this.messageLength
    }
    const headers = buffer.subarray(0, headerEndIndex)
    const messageLength = findContentLength(Buffer.from(headers))
    if (messageLength === null) {
      throw new Error('Content-Length header not found')
    }

    this.messageLength = messageLength
    return messageLength
  }
}

export const wrapMessage = (protocolMessage: unknown): Buffer => {
  const message = JSON.stringify(protocolMessage)
  const messageBuffer = Buffer.from(message, 'utf-8')
  const headers = `Content-Length: ${messageBuffer.length}${HEADER_END_SEQUENCE}`
  const headerBuffer = Buffer.from(headers, 'utf-8')
  const msg = Buffer.concat([headerBuffer, messageBuffer])
  return msg
}

export const createProtocolMessage = <T>(
  data: T,
  route: string[]
): { buffer: Buffer; id: string } => {
  const id = crypto.randomUUID()
  const protocolMessage: ProtocolMessage<T> = {
    id,
    route,
    data
  }
  const buffer = wrapMessage(protocolMessage)
  return { buffer, id }
}
