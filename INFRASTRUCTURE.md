# Infrastructure and Deployment

This document describes the infrastructure setup, network topology, and deployment architecture.

## Network Topology

```mermaid
graph TB
    subgraph "Network Topology: A:B,B:C,C:D,C:E"
        A[Node A<br/>localhost:7000<br/>Entry Node]
        B[Node B<br/>localhost:7001<br/>Router]
        C[Node C<br/>localhost:7002<br/>Router Hub]
        D[Node D<br/>localhost:7003<br/>End Node]
        E[Node E<br/>localhost:7004<br/>End Node]
        
        A <-->|Bidirectional| B
        B <-->|Bidirectional| C
        C <-->|Bidirectional| D
        C <-->|Bidirectional| E
    end
    
    subgraph "Client Access"
        Client[Client Application<br/>Connects to Node A]
        Client -->|TCP:7000| A
    end
    
    subgraph "CA Service"
        CA[CA Server<br/>localhost:9000]
        Client -.->|Verify Cert| CA
    end
```

## Infrastructure Components

```mermaid
graph LR
    subgraph "Process Layer"
        P1[Process 1<br/>CA Server<br/>Port 9000]
        P2[Process 2<br/>Node A<br/>Port 7000]
        P3[Process 3<br/>Node B<br/>Port 7001]
        P4[Process 4<br/>Node C<br/>Port 7002]
        P5[Process 5<br/>Node D<br/>Port 7003]
        P6[Process 6<br/>Node E<br/>Port 7004]
        P7[Process 7<br/>Client]
    end
    
    subgraph "File System"
        FS1[secrets/rootCA.crt<br/>Root Certificate]
        FS2[secrets/node_A/<br/>A.key, A.crt]
        FS3[secrets/node_B/<br/>B.key, B.crt]
        FS4[secrets/node_C/<br/>C.key, C.crt]
        FS5[secrets/node_D/<br/>D.key, D.crt]
        FS6[secrets/node_E/<br/>E.key, E.crt]
    end
    
    P1 -->|Reads| FS1
    P2 -->|Reads| FS2
    P3 -->|Reads| FS3
    P4 -->|Reads| FS4
    P5 -->|Reads| FS5
    P6 -->|Reads| FS6
```

## Port Allocation

| Component | Port | Protocol | Description |
|-----------|------|----------|-------------|
| CA Server | 9000 | TCP | Certificate Authority service |
| Node A | 7000 | TCP | Entry point node |
| Node B | 7001 | TCP | Intermediate router |
| Node C | 7002 | TCP | Router hub (connects to D and E) |
| Node D | 7003 | TCP | End node |
| Node E | 7004 | TCP | End node |

## Connection Flow Infrastructure

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant NodeA as Node A<br/>(7000)
    participant NodeB as Node B<br/>(7001)
    participant NodeC as Node C<br/>(7002)
    participant NodeE as Node E<br/>(7004)
    participant CA as CA Server<br/>(9000)
    
    Note over Client,NodeE: Infrastructure Setup Phase
    Client->>NodeA: TCP Connection (localhost:7000)
    NodeA->>NodeB: TCP Connection (localhost:7001)
    NodeB->>NodeC: TCP Connection (localhost:7002)
    NodeC->>NodeE: TCP Connection (localhost:7004)
    
    Note over Client,CA: Certificate Verification
    Client->>CA: TCP Connection (localhost:9000)
    Client->>CA: verify_cert request
    CA-->>Client: verify_result
    
    Note over Client,NodeE: Data Routing
    Client->>NodeA: Encrypted Data
    NodeA->>NodeB: Forward (via persistent connection)
    NodeB->>NodeC: Forward (via persistent connection)
    NodeC->>NodeE: Forward (via persistent connection)
    NodeE-->>NodeC: Encrypted Response
    NodeC-->>NodeB: Forward Response
    NodeB-->>NodeA: Forward Response
    NodeA-->>Client: Forward Response
```

## YAML Infrastructure Description

For tools that support YAML-based infrastructure diagrams, here's a structured description:

```yaml
infrastructure:
  name: "TLS Topology RGR"
  version: "1.0"
  
  components:
    - name: "CA Server"
      type: "service"
      port: 9000
      protocol: "TCP"
      resources:
        - type: "file"
          path: "secrets/rootCA.crt"
          purpose: "Root certificate authority"
        - type: "file"
          path: "secrets/rootCA.key"
          purpose: "Root private key"
      responsibilities:
        - "Certificate verification"
        - "Certificate validation"
        - "Hostname verification"
    
    - name: "Node A"
      type: "node"
      port: 7000
      protocol: "TCP"
      role: "entry_point"
      resources:
        - type: "file"
          path: "secrets/node_A/A.key"
          purpose: "Private key"
        - type: "file"
          path: "secrets/node_A/A.crt"
          purpose: "Certificate"
      connections:
        - target: "Node B"
          port: 7001
          type: "bidirectional"
    
    - name: "Node B"
      type: "node"
      port: 7001
      protocol: "TCP"
      role: "router"
      resources:
        - type: "file"
          path: "secrets/node_B/B.key"
          purpose: "Private key"
        - type: "file"
          path: "secrets/node_B/B.crt"
          purpose: "Certificate"
      connections:
        - target: "Node A"
          port: 7000
          type: "bidirectional"
        - target: "Node C"
          port: 7002
          type: "bidirectional"
    
    - name: "Node C"
      type: "node"
      port: 7002
      protocol: "TCP"
      role: "router_hub"
      resources:
        - type: "file"
          path: "secrets/node_C/C.key"
          purpose: "Private key"
        - type: "file"
          path: "secrets/node_C/C.crt"
          purpose: "Certificate"
      connections:
        - target: "Node B"
          port: 7001
          type: "bidirectional"
        - target: "Node D"
          port: 7003
          type: "bidirectional"
        - target: "Node E"
          port: 7004
          type: "bidirectional"
    
    - name: "Node D"
      type: "node"
      port: 7003
      protocol: "TCP"
      role: "end_node"
      resources:
        - type: "file"
          path: "secrets/node_D/D.key"
          purpose: "Private key"
        - type: "file"
          path: "secrets/node_D/D.crt"
          purpose: "Certificate"
      connections:
        - target: "Node C"
          port: 7002
          type: "bidirectional"
    
    - name: "Node E"
      type: "node"
      port: 7004
      protocol: "TCP"
      role: "end_node"
      resources:
        - type: "file"
          path: "secrets/node_E/E.key"
          purpose: "Private key"
        - type: "file"
          path: "secrets/node_E/E.crt"
          purpose: "Certificate"
      connections:
        - target: "Node C"
          port: 7002
          type: "bidirectional"

  topology:
    description: "Graph-based routing topology"
    route_map: "A:B,B:C,C:D,C:E"
    algorithm: "BFS (Breadth-First Search)"
    routing:
      method: "source_routing"
      route_inclusion: "in_message_header"
    
  constraints:
    packet_size:
      max_bytes: 64
      purpose: "Simulate slow radio channel"
      implementation: "sendWithPacketLimit()"
    
  security:
    certificate_chain:
      root: "Root CA"
      nodes: "All nodes signed by Root CA"
    encryption:
      handshake: "RSA-OAEP"
      data: "AES-256-GCM"
      key_derivation: "HKDF"
```

## Deployment Architecture

```mermaid
graph TB
    subgraph "Development Environment"
        DevMachine[Development Machine<br/>Windows/Linux]
        NodeJS[Node.js Runtime<br/>v18+]
        OpenSSL[OpenSSL<br/>Certificate Generation]
    end
    
    subgraph "Build & Deploy"
        Scripts[PowerShell Scripts<br/>generate-certs.ps1]
        TypeScript[TypeScript Source<br/>src/]
        Compiled[JavaScript<br/>Compiled Output]
    end
    
    subgraph "Runtime Environment"
        Processes[Multiple Node Processes]
        CAProcess[CA Server Process]
        NodeProcesses[Node Server Processes<br/>A, B, C, D, E]
        ClientProcess[Client Process]
    end
    
    DevMachine --> NodeJS
    DevMachine --> OpenSSL
    OpenSSL --> Scripts
    Scripts --> TypeScript
    TypeScript --> Compiled
    Compiled --> Processes
    Processes --> CAProcess
    Processes --> NodeProcesses
    Processes --> ClientProcess
```

## Network Constraints and Limitations

```mermaid
graph LR
    subgraph "Packet Constraints"
        LargeMessage[Large Message<br/>Any Size]
        Splitter[Packet Splitter<br/>64-byte chunks]
        Chunk1[Chunk 1<br/>64 bytes]
        Chunk2[Chunk 2<br/>64 bytes]
        ChunkN[Chunk N<br/>≤64 bytes]
    end
    
    subgraph "Reassembly"
        Buffer[DataHandler Buffer]
        HeaderParser[Header Parser<br/>Content-Length]
        Reassembler[Message Reassembler]
        CompleteMessage[Complete Message]
    end
    
    LargeMessage --> Splitter
    Splitter --> Chunk1
    Splitter --> Chunk2
    Splitter --> ChunkN
    
    Chunk1 --> Buffer
    Chunk2 --> Buffer
    ChunkN --> Buffer
    Buffer --> HeaderParser
    HeaderParser --> Reassembler
    Reassembler --> CompleteMessage
```

## Infrastructure Text Description (for YAML tools)

```
Infrastructure Components:
- CA Server (Port 9000): Central certificate authority
  - Validates node certificates
  - Verifies certificate chain
  - Checks hostname matching
  
- Node Servers (Ports 7000-7004): Distributed network nodes
  - Each node runs as separate process
  - Maintains persistent connections to neighbors
  - Routes messages based on route header
  - Handles TLS handshake for final destination
  
- Client Application: Initiates connections
  - Connects to entry node (Node A)
  - Performs TLS handshake through route
  - Sends encrypted data
  - Receives encrypted responses

Network Topology:
- Graph structure: A->B->C, C->D, C->E
- Bidirectional edges (full duplex)
- Route finding via BFS algorithm
- Source routing (route in message header)

Constraints:
- Packet size limit: 64 bytes (simulates slow radio)
- Message fragmentation and reassembly
- Content-Length based message parsing
```

