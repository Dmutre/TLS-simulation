/**
 * Helper messages
 */

export type MessageReceived<TResponse = void> = {
  type: 'received'
  messageId: string
  response: TResponse
}

export type ProtocolMessage<T = unknown> = {
  id: string
  route: string[]
  data: T
}

/**
 * Handshake messages
 */

export type CMessageInitialHandShake = {
  type: 'initial_handshake'
  random: string
}

export type CMessagePremaster = {
  type: 'premaster'
  premaster: string
}

export type SMessageInitialHandShake = {
  type: 'initial_handshake'
  random: string
  sslCertificate: string
}

type MessageReady = {
  type: 'ready'
  payload: string
}

export type SMessageReady = MessageReady
export type CMessageReady = MessageReady

export type MessageRequest = {
  type: 'data'
  payload: string
}

export type MessageResponse = {
  type: 'response'
  payload: string
}

export type ClientMessages =
  | CMessageInitialHandShake
  | CMessagePremaster
  | CMessageReady
  | MessageRequest

export type ServerMessages =
  | SMessageInitialHandShake
  | SMessageReady
  | MessageResponse

/**
 * Data messages (app-level)
 */

export type ClientDataMessageEcho = {
  type: 'echo'
  request: {
    action: 'echo'
    message: string
  }
  response: {
    echoedMessage: string
  }
}

export type ClientDataMessageChat = {
  type: 'chat'
  request: {
    action: 'chat'
    message: string
  }
  response: {
    ok: boolean
  }
}

export type ClientDataMessages =
  | ClientDataMessageEcho
  | ClientDataMessageChat
