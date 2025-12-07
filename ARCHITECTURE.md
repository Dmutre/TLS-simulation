# Architecture Overview

This document describes the high-level architecture of the TLS Topology RGR project.

## System Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        Client[Client Application]
    end
    
    subgraph "CA Infrastructure"
        CA[CA Server<br/>Port 9000<br/>Certificate Authority]
        RootCA[(Root CA Certificate)]
    end
    
    subgraph "Network Topology"
        NodeA[Node A<br/>Port 7000<br/>Entry Point]
        NodeB[Node B<br/>Port 7001<br/>Router]
        NodeC[Node C<br/>Port 7002<br/>Router]
        NodeD[Node D<br/>Port 7003<br/>End Node]
        NodeE[Node E<br/>Port 7004<br/>End Node]
    end
    
    subgraph "Certificate Storage"
        CertA[Node A Certificate]
        CertB[Node B Certificate]
        CertC[Node C Certificate]
        CertD[Node D Certificate]
        CertE[Node E Certificate]
    end
    
    Client -->|TCP Connection| NodeA
    Client -.->|Certificate Verification| CA
    CA -->|Reads| RootCA
    
    NodeA <-->|Route: A->B| NodeB
    NodeB <-->|Route: B->C| NodeC
    NodeC <-->|Route: C->D| NodeD
    NodeC <-->|Route: C->E| NodeE
    
    NodeA -->|Loads| CertA
    NodeB -->|Loads| CertB
    NodeC -->|Loads| CertC
    NodeD -->|Loads| CertD
    NodeE -->|Loads| CertE
    
    RootCA -.->|Signs| CertA
    RootCA -.->|Signs| CertB
    RootCA -.->|Signs| CertC
    RootCA -.->|Signs| CertD
    RootCA -.->|Signs| CertE
```

## Component Architecture

```mermaid
graph LR
    subgraph "Client Components"
        ClientMain[client.ts<br/>Main Entry Point]
        ClientHS[handshakeClient.ts<br/>TLS Handshake Client]
        GraphClient[graph.ts<br/>Route Finding]
    end
    
    subgraph "Server Components"
        NodeServer[node-server.ts<br/>Node Server]
        ServerHS[handshakeServer.ts<br/>TLS Handshake Server]
        ConnMgr[ConnectionManager<br/>Persistent Connections]
    end
    
    subgraph "Protocol Layer"
        Messages[messages.ts<br/>Message Types]
        DataHandler[dataHandler.ts<br/>Packet Assembly]
    end
    
    subgraph "CA Components"
        CAServer[ca-server.ts<br/>Certificate Authority]
        CertVerify[Certificate Verification]
    end
    
    subgraph "Shared Utilities"
        Helpers[helpers.ts<br/>Crypto & Utilities]
        GraphUtil[graph.ts<br/>Graph Algorithms]
    end
    
    ClientMain --> ClientHS
    ClientMain --> GraphClient
    ClientHS --> Messages
    ClientHS --> Helpers
    
    NodeServer --> ServerHS
    NodeServer --> ConnMgr
    ServerHS --> Messages
    ServerHS --> Helpers
    
    ClientHS -.->|verify_cert| CAServer
    CAServer --> CertVerify
    CertVerify --> Helpers
    
    ClientMain --> DataHandler
    NodeServer --> DataHandler
    DataHandler --> Messages
```

## Data Flow Architecture

```mermaid
flowchart TD
    Start([Client Initiates Connection]) --> FindRoute[Find Route via Graph]
    FindRoute --> ConnectTCP[Connect to First Node]
    ConnectTCP --> InitHandshake[Send Initial Handshake]
    
    InitHandshake --> Forward1[Node A: Forward to Node B]
    Forward1 --> Forward2[Node B: Forward to Node C]
    Forward2 --> Forward3[Node C: Forward to Target]
    
    Forward3 --> ServerResponse[Target Node: Send Certificate]
    ServerResponse --> VerifyCA[Client: Verify with CA]
    VerifyCA -->|Valid| SendPremaster[Send Encrypted Premaster]
    VerifyCA -->|Invalid| Error([Error: Certificate Invalid])
    
    SendPremaster --> GenSessionKey[Generate Session Key]
    GenSessionKey --> ExchangeReady[Exchange Ready Messages]
    ExchangeReady --> EncryptData[Encrypt Data with Session Key]
    
    EncryptData --> SendData[Send Encrypted Data]
    SendData --> RouteBack[Route Back Through Nodes]
    RouteBack --> DecryptResponse[Decrypt Response]
    DecryptResponse --> End([Connection Complete])
```

## Security Architecture

```mermaid
graph TB
    subgraph "Certificate Chain"
        RootCA[Root CA<br/>Private Key: rootCA.key<br/>Certificate: rootCA.crt]
        NodeCerts[Node Certificates<br/>Signed by Root CA]
    end
    
    subgraph "Handshake Security"
        ClientRandom[Client Random<br/>32 bytes hex]
        ServerRandom[Server Random<br/>32 bytes hex]
        Premaster[Premaster Secret<br/>RSA-OAEP Encrypted]
        SessionKey[Session Key<br/>HKDF Derived]
    end
    
    subgraph "Data Encryption"
        AESGCM[AES-256-GCM<br/>Symmetric Encryption]
        EncryptedData[Encrypted Payload]
    end
    
    subgraph "Packet Limitation"
        PacketLimit[64-byte Chunks<br/>Simulates Slow Radio]
        FragmentedData[Fragmented Packets]
    end
    
    RootCA -->|Signs| NodeCerts
    ClientRandom -->|Combined| SessionKey
    ServerRandom -->|Combined| SessionKey
    Premaster -->|Decrypted| SessionKey
    SessionKey -->|Derives| AESGCM
    AESGCM -->|Encrypts| EncryptedData
    EncryptedData -->|Split into| PacketLimit
    PacketLimit -->|Creates| FragmentedData
```

## Node Role Architecture

```mermaid
stateDiagram-v2
    [*] --> EntryNode: Client Connects
    EntryNode --> RouterNode: Forward Message
    RouterNode --> RouterNode: Intermediate Routing
    RouterNode --> EndNode: Final Hop
    EndNode --> RouterNode: Response Back
    RouterNode --> EntryNode: Route Response
    EntryNode --> [*]: Client Receives
    
    state EntryNode {
        [*] --> AcceptConnection
        AcceptConnection --> CheckRoute
        CheckRoute --> ForwardOrProcess
    }
    
    state RouterNode {
        [*] --> ReceiveMessage
        ReceiveMessage --> FindNextHop
        FindNextHop --> ForwardMessage
        ForwardMessage --> WaitResponse
        WaitResponse --> ForwardResponse
    }
    
    state EndNode {
        [*] --> ReceiveMessage
        ReceiveMessage --> ProcessHandshake
        ProcessHandshake --> HandleRequest
        HandleRequest --> EncryptResponse
        EncryptResponse --> SendResponse
    }
```

