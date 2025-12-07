# Protocol Flow and Message Exchange

This document describes the detailed protocol flows, message sequences, and handshake procedures.

## Complete TLS Handshake Flow

```mermaid
sequenceDiagram
    participant Client
    participant NodeA as Node A<br/>(Router)
    participant NodeB as Node B<br/>(Router)
    participant NodeE as Node E<br/>(Target Server)
    participant CA as CA Server
    
    Note over Client,NodeE: Phase 1: Initial Handshake
    Client->>Client: Generate clientRandom (32 bytes)
    Client->>NodeA: ProtocolMessage<br/>{type: initial_handshake, random}
    NodeA->>NodeB: Forward (route: [A,B,E])
    NodeB->>NodeE: Forward (route: [A,B,E])
    
    NodeE->>NodeE: Generate serverRandom (32 bytes)
    NodeE->>NodeE: Load certificate (E.crt)
    NodeE->>NodeB: ProtocolMessage<br/>{type: initial_handshake,<br/>random, sslCertificate}
    NodeB->>NodeA: Forward (route: [E,B,A])
    NodeA->>Client: Forward (route: [E,B,A])
    
    Note over Client,CA: Phase 2: Certificate Verification
    Client->>CA: verify_cert(certificatePem, host="E")
    CA->>CA: Verify signature with rootCA
    CA->>CA: Check validity period
    CA->>CA: Verify hostname (CN="E")
    CA-->>Client: verify_result(valid=true)
    
    Note over Client,NodeE: Phase 3: Premaster Secret Exchange
    Client->>Client: Generate premasterSecret (48 bytes)
    Client->>Client: Encrypt with RSA-OAEP<br/>(using E.crt public key)
    Client->>NodeA: ProtocolMessage<br/>{type: premaster, premaster}
    NodeA->>NodeB: Forward
    NodeB->>NodeE: Forward
    
    NodeE->>NodeE: Decrypt premasterSecret<br/>(using E.key private key)
    NodeE->>NodeB: ProtocolMessage<br/>{type: premaster_ack}
    NodeB->>NodeA: Forward
    NodeA->>Client: Forward
    
    Note over Client,NodeE: Phase 4: Session Key Generation
    Client->>Client: genSessionKey(premasterSecret,<br/>clientRandom, serverRandom)<br/>HKDF derivation
    NodeE->>NodeE: genSessionKey(premasterSecret,<br/>clientRandom, serverRandom)<br/>HKDF derivation
    
    Note over Client,NodeE: Phase 5: Ready Exchange
    Client->>Client: Encrypt READY_MESSAGE<br/>(AES-256-GCM, sessionKey)
    Client->>NodeA: ProtocolMessage<br/>{type: ready, payload}
    NodeA->>NodeB: Forward
    NodeB->>NodeE: Forward
    
    NodeE->>NodeE: Decrypt and verify READY_MESSAGE
    NodeE->>NodeE: Encrypt READY_MESSAGE<br/>(AES-256-GCM, sessionKey)
    NodeE->>NodeB: ProtocolMessage<br/>{type: ready, payload}
    NodeB->>NodeA: Forward
    NodeA->>Client: Forward
    
    Client->>Client: Decrypt and verify READY_MESSAGE
    Note over Client,NodeE: Handshake Complete!
```

## Data Exchange Flow

```mermaid
sequenceDiagram
    participant Client
    participant NodeA as Node A
    participant NodeB as Node B
    participant NodeE as Node E<br/>(Target)
    
    Note over Client,NodeE: Encrypted Data Transmission
    Client->>Client: Create request<br/>{action: "echo", message: "Hello"}
    Client->>Client: Encrypt with AES-256-GCM<br/>(sessionKey)
    Client->>NodeA: ProtocolMessage<br/>{type: data, payload: encrypted}
    NodeA->>NodeA: Check route: [A,B,E]
    NodeA->>NodeA: Not final node, forward
    NodeA->>NodeB: Forward message
    
    NodeB->>NodeB: Check route: [A,B,E]
    NodeB->>NodeB: Not final node, forward
    NodeB->>NodeE: Forward message
    
    NodeE->>NodeE: Check route: [A,B,E]
    NodeE->>NodeE: Final node! Process request
    NodeE->>NodeE: Decrypt payload<br/>(AES-256-GCM, sessionKey)
    NodeE->>NodeE: Parse: {action: "echo", message: "Hello"}
    NodeE->>NodeE: Handle: echo request
    NodeE->>NodeE: Create response<br/>{echoedMessage: "[E] Hello"}
    NodeE->>NodeE: Encrypt response<br/>(AES-256-GCM, sessionKey)
    NodeE->>NodeB: ProtocolMessage<br/>{type: response, payload: encrypted}<br/>route: [E,B,A]
    
    NodeB->>NodeA: Forward response
    NodeA->>Client: Forward response
    
    Client->>Client: Decrypt response<br/>(AES-256-GCM, sessionKey)
    Client->>Client: Parse: {echoedMessage: "[E] Hello"}
    Client->>Client: Display result
```

## Message Routing Flow

```mermaid
flowchart TD
    Start([Message Received]) --> CheckRoute{Check route array}
    CheckRoute -->|route[last] == thisNode| IsFinal[This is final node]
    CheckRoute -->|route[last] != thisNode| IsRouter[This is router]
    
    IsFinal --> ProcessMessage[Process Message]
    ProcessMessage --> Handshake{Message Type?}
    Handshake -->|Handshake| HandleHandshake[Handle TLS Handshake]
    Handshake -->|Data| DecryptData[Decrypt with Session Key]
    DecryptData --> ExecuteAction[Execute Action<br/>echo/chat/file]
    ExecuteAction --> EncryptResponse[Encrypt Response]
    EncryptResponse --> ReverseRoute[Reverse Route Array]
    ReverseRoute --> SendBack[Send Back]
    
    IsRouter --> FindPosition[Find position in route]
    FindPosition --> GetNext[Get next node]
    GetNext --> CheckConnection{Connection exists?}
    CheckConnection -->|No| CreateConn[Create TCP Connection]
    CheckConnection -->|Yes| UseConn[Use Existing Connection]
    CreateConn --> UseConn
    UseConn --> Forward[Forward Message]
    Forward --> WaitResponse[Wait for Response]
    WaitResponse --> ForwardResponse[Forward Response Back]
    
    SendBack --> End([End])
    ForwardResponse --> End
```

## Packet Fragmentation and Reassembly

```mermaid
sequenceDiagram
    participant Sender
    participant Network as Network Layer<br/>(64-byte limit)
    participant Receiver
    
    Note over Sender,Receiver: Large Message Transmission
    Sender->>Sender: Create ProtocolMessage<br/>(e.g., 200 bytes)
    Sender->>Sender: wrapMessage()<br/>Add Content-Length header
    Sender->>Network: Chunk 1 (64 bytes)
    Sender->>Network: Chunk 2 (64 bytes)
    Sender->>Network: Chunk 3 (64 bytes)
    Sender->>Network: Chunk 4 (8 bytes)
    
    Network->>Receiver: Fragment 1 (64 bytes)
    Receiver->>Receiver: Append to buffer
    Receiver->>Receiver: Check for header end
    
    Network->>Receiver: Fragment 2 (64 bytes)
    Receiver->>Receiver: Append to buffer
    Receiver->>Receiver: Parse Content-Length: 200
    
    Network->>Receiver: Fragment 3 (64 bytes)
    Receiver->>Receiver: Append to buffer
    Receiver->>Receiver: Check: 64+64+64 = 192 < 200
    
    Network->>Receiver: Fragment 4 (8 bytes)
    Receiver->>Receiver: Append to buffer
    Receiver->>Receiver: Check: 192+8 = 200 ✓
    Receiver->>Receiver: Extract complete message
    Receiver->>Receiver: Process message
    Receiver->>Receiver: Clear buffer
```

## State Machine: Client Handshake

```mermaid
stateDiagram-v2
    [*] --> initiate_handshake: Client starts
    
    initiate_handshake: Generate clientRandom<br/>Send initial_handshake
    initiate_handshake --> premaster_sent: Receive server<br/>certificate & random
    
    premaster_sent: Verify cert with CA<br/>Encrypt premaster<br/>Send premaster
    premaster_sent --> ready: Receive premaster_ack<br/>Generate session key
    
    ready: Encrypt READY_MESSAGE<br/>Send ready
    ready --> ready_complete: Receive server ready<br/>Verify READY_MESSAGE
    
    ready_complete: Handshake complete<br/>Can send encrypted data
    ready_complete --> ready_complete: Send/receive data
    
    ready_complete --> [*]: Connection closed
```

## State Machine: Server Handshake

```mermaid
stateDiagram-v2
    [*] --> initial_handshake: Server listening
    
    initial_handshake: Receive client random<br/>Generate server random<br/>Send certificate
    initial_handshake --> premaster_secret: Receive initial_handshake
    
    premaster_secret: Receive premaster<br/>Decrypt premaster<br/>Generate session key<br/>Send premaster_ack
    premaster_secret --> waiting_for_client_ready: Premaster decrypted
    
    waiting_for_client_ready: Wait for client ready
    waiting_for_client_ready --> ready_complete: Receive client ready<br/>Verify READY_MESSAGE<br/>Send server ready
    
    ready_complete: Handshake complete<br/>Can process encrypted data
    ready_complete --> ready_complete: Process requests/responses
    
    ready_complete --> [*]: Connection closed
```

## Protocol Message Structure

```mermaid
graph TB
    subgraph "ProtocolMessage Structure"
        PM[ProtocolMessage]
        ID[id: UUID]
        Route[route: string[]]
        Data[data: T]
    end
    
    subgraph "Handshake Messages"
        InitHS[initial_handshake<br/>random: string]
        Premaster[premaster<br/>premaster: string]
        PremasterAck[premaster_ack]
        Ready[ready<br/>payload: string]
    end
    
    subgraph "Data Messages"
        DataMsg[data<br/>payload: string]
        Response[response<br/>payload: string]
    end
    
    subgraph "Encryption"
        Encrypted[Encrypted Payload<br/>AES-256-GCM]
        Base64[Base64 Encoded]
    end
    
    PM --> ID
    PM --> Route
    PM --> Data
    
    Data --> InitHS
    Data --> Premaster
    Data --> PremasterAck
    Data --> Ready
    Data --> DataMsg
    Data --> Response
    
    DataMsg --> Encrypted
    Response --> Encrypted
    Ready --> Encrypted
    Encrypted --> Base64
```

## YAML Protocol Description

For protocol documentation tools that use YAML:

```yaml
protocol:
  name: "TLS Topology RGR Protocol"
  version: "1.0"
  
  message_format:
    wrapper: "ProtocolMessage"
    fields:
      - name: "id"
        type: "string"
        format: "UUID"
        required: true
        description: "Unique message identifier"
      
      - name: "route"
        type: "array<string>"
        required: true
        description: "Source routing path through nodes"
        example: ["A", "B", "C", "E"]
      
      - name: "data"
        type: "object"
        required: true
        description: "Message payload (type-specific)"
  
  handshake_messages:
    - name: "initial_handshake"
      direction: "client_to_server"
      fields:
        - name: "type"
          value: "initial_handshake"
        - name: "random"
          type: "string"
          format: "hex"
          length: 64
          description: "32-byte random value (hex encoded)"
    
    - name: "initial_handshake"
      direction: "server_to_client"
      fields:
        - name: "type"
          value: "initial_handshake"
        - name: "random"
          type: "string"
          format: "hex"
          length: 64
        - name: "sslCertificate"
          type: "string"
          format: "PEM"
    
    - name: "premaster"
      direction: "client_to_server"
      fields:
        - name: "type"
          value: "premaster"
        - name: "premaster"
          type: "string"
          format: "base64"
          description: "RSA-OAEP encrypted premaster secret"
    
    - name: "premaster_ack"
      direction: "server_to_client"
      fields:
        - name: "type"
          value: "premaster_ack"
    
    - name: "ready"
      direction: "bidirectional"
      fields:
        - name: "type"
          value: "ready"
        - name: "payload"
          type: "string"
          format: "base64"
          description: "AES-256-GCM encrypted READY_MESSAGE"
  
  data_messages:
    - name: "data"
      direction: "client_to_server"
      fields:
        - name: "type"
          value: "data"
        - name: "payload"
          type: "string"
          format: "base64"
          description: "AES-256-GCM encrypted request"
          inner_structure:
            - name: "action"
              type: "string"
              values: ["echo", "chat"]
            - name: "message"
              type: "string"
    
    - name: "response"
      direction: "server_to_client"
      fields:
        - name: "type"
          value: "response"
        - name: "payload"
          type: "string"
          format: "base64"
          description: "AES-256-GCM encrypted response"
  
  transport:
    protocol: "TCP"
    encoding: "UTF-8"
    framing:
      method: "Content-Length header"
      header_format: "Content-Length: {length}\r\n\r\n"
      body: "JSON-encoded ProtocolMessage"
    
    fragmentation:
      max_packet_size: 64
      method: "chunking"
      reassembly: "Content-Length based"
  
  security:
    certificate_verification:
      method: "CA server verification"
      endpoint: "CA server (port 9000)"
      request:
        type: "verify_cert"
        fields:
          - name: "certificatePem"
            type: "string"
          - name: "host"
            type: "string"
      response:
        type: "verify_result"
        fields:
          - name: "valid"
            type: "boolean"
          - name: "error"
            type: "string"
            optional: true
    
    encryption:
      handshake:
        algorithm: "RSA-OAEP"
        key_size: 2048
        padding: "OAEP"
      
      data:
        algorithm: "AES-256-GCM"
        key_derivation: "HKDF"
        inputs:
          - "premasterSecret"
          - "clientRandom"
          - "serverRandom"
```

