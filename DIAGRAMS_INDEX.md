# Diagrams and Documentation Index

This document provides an overview of all available diagrams and documentation for the TLS Topology RGR project.

## Documentation Files

### 1. [ARCHITECTURE.md](./ARCHITECTURE.md)
**System Architecture and Component Design**

Contains diagrams describing:
- **System Architecture**: High-level overview of all components and their relationships
- **Component Architecture**: Detailed breakdown of code modules and dependencies
- **Data Flow Architecture**: How data moves through the system
- **Security Architecture**: Certificate chain, encryption, and security mechanisms
- **Node Role Architecture**: State diagrams for different node types

**Key Diagrams:**
- System architecture with CA, nodes, and client
- Component relationships and dependencies
- Security flow from certificates to encrypted data
- Node state machines

### 2. [INFRASTRUCTURE.md](./INFRASTRUCTURE.md)
**Infrastructure Setup and Deployment**

Contains diagrams describing:
- **Network Topology**: Physical/logical network structure
- **Infrastructure Components**: Process and file system layout
- **Port Allocation**: Complete port mapping table
- **Connection Flow**: Infrastructure-level connection sequences
- **YAML Infrastructure Description**: Structured YAML for infrastructure tools
- **Deployment Architecture**: Build and runtime environment
- **Network Constraints**: Packet fragmentation and reassembly

**Key Diagrams:**
- Network topology graph (A->B->C, C->D, C->E)
- Port allocation and process mapping
- Infrastructure component relationships
- Packet fragmentation flow

### 3. [PROTOCOL_FLOW.md](./PROTOCOL_FLOW.md)
**Protocol Flows and Message Exchange**

Contains diagrams describing:
- **Complete TLS Handshake Flow**: Step-by-step handshake sequence
- **Data Exchange Flow**: Encrypted data transmission
- **Message Routing Flow**: How messages are routed through nodes
- **Packet Fragmentation and Reassembly**: Detailed fragmentation process
- **State Machines**: Client and server handshake state diagrams
- **Protocol Message Structure**: Message format and encryption layers
- **YAML Protocol Description**: Structured protocol specification

**Key Diagrams:**
- Complete handshake sequence diagram
- Data encryption and routing flow
- Client/server state machines
- Message structure and format

## Quick Reference

### For Understanding System Design
→ Start with **[ARCHITECTURE.md](./ARCHITECTURE.md)**
- See how components interact
- Understand security architecture
- Learn about node roles

### For Deployment and Setup
→ Start with **[INFRASTRUCTURE.md](./INFRASTRUCTURE.md)**
- Understand network topology
- See port allocations
- Learn about deployment process

### For Protocol Implementation
→ Start with **[PROTOCOL_FLOW.md](./PROTOCOL_FLOW.md)**
- Understand handshake process
- See message flows
- Learn about state machines

## Diagram Types Used

### Mermaid Diagrams
All diagrams use [Mermaid](https://mermaid.js.org/) syntax, which is supported by:
- GitHub (renders automatically in markdown)
- GitLab
- Many markdown viewers
- VS Code (with Mermaid extension)
- Documentation tools (Docusaurus, MkDocs, etc.)

### Diagram Categories

1. **Graph Diagrams** (`graph TB`, `graph LR`)
   - System architecture
   - Network topology
   - Component relationships

2. **Sequence Diagrams** (`sequenceDiagram`)
   - Handshake flows
   - Message exchanges
   - Protocol interactions

3. **Flowcharts** (`flowchart TD`)
   - Data flow
   - Routing logic
   - Processing steps

4. **State Diagrams** (`stateDiagram-v2`)
   - Handshake state machines
   - Node role states

5. **YAML Descriptions**
   - Structured data for infrastructure tools
   - Protocol specifications
   - Configuration templates

## Using These Diagrams

### In Documentation
The diagrams can be directly included in documentation by referencing the markdown files or copying the Mermaid code blocks.

### In Presentations
1. Export Mermaid diagrams to images using:
   - [Mermaid Live Editor](https://mermaid.live/)
   - VS Code Mermaid extension
   - Command-line tools (`@mermaid-js/mermaid-cli`)

2. Use the YAML descriptions with infrastructure diagram tools:
   - Terraform
   - Kubernetes diagrams
   - Architecture diagram generators

### In Code Comments
Key diagrams can be referenced in code comments:
```typescript
/**
 * Handles TLS handshake as described in PROTOCOL_FLOW.md
 * See "Complete TLS Handshake Flow" diagram
 */
```

## Diagram Maintenance

When updating the codebase:
1. **Architecture changes** → Update `ARCHITECTURE.md`
2. **Infrastructure changes** → Update `INFRASTRUCTURE.md`
3. **Protocol changes** → Update `PROTOCOL_FLOW.md`
4. **New features** → Add diagrams to relevant files

## Tools for Viewing/Editing

- **VS Code**: Install "Markdown Preview Mermaid Support" extension
- **Online**: [Mermaid Live Editor](https://mermaid.live/)
- **CLI**: `npm install -g @mermaid-js/mermaid-cli`
- **GitHub/GitLab**: Automatic rendering in markdown files

## Export Options

To export diagrams as images:
```bash
# Install Mermaid CLI
npm install -g @mermaid-js/mermaid-cli

# Export a diagram
mmdc -i ARCHITECTURE.md -o architecture.png
```

Or use the Mermaid Live Editor to copy/paste diagram code and export as PNG/SVG.

