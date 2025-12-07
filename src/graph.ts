import { assertThat } from './helpers'

class Graph {
  private nodes = new Map<string, Node>()

  addNode(value: string) {
    if (!this.nodes.has(value)) {
      this.nodes.set(value, new Node(value))
    }
  }

  addEdge(from: string, to: string) {
    const f = this.nodes.get(from)
    const t = this.nodes.get(to)
    assertThat(f && t, 'Both nodes must exist to add edge')
    f!.addNeighbour(t!)
    t!.addNeighbour(f!)
  }

  findRoute(from: string, to: string, excludeNodes: Set<string> = new Set()): string[] | null {
    const start = this.nodes.get(from)
    const end = this.nodes.get(to)
    assertThat(start && end, 'Both nodes must exist to find route')

    if (excludeNodes.has(from) || excludeNodes.has(to)) {
      return null
    }

    const visited = new Set<string>()
    const queue: Array<{ node: Node; path: string[] }> = [
      { node: start!, path: [start!.value] },
    ]

    while (queue.length > 0) {
      const { node, path } = queue.shift()!
      if (node.value === end!.value) return path
      visited.add(node.value)
      for (const n of node) {
        if (!visited.has(n.value) && !excludeNodes.has(n.value)) {
          queue.push({ node: n, path: [...path, n.value] })
        }
      }
    }
    return null
  }

  getAllNodes(): string[] {
    return Array.from(this.nodes.keys())
  }

  getAllReachableNodes(from: string): string[] {
    const start = this.nodes.get(from)
    assertThat(start, `Node ${from} does not exist`)

    const visited = new Set<string>()
    const queue: Node[] = [start!]

    while (queue.length > 0) {
      const node = queue.shift()!
      if (visited.has(node.value)) continue
      visited.add(node.value)
      
      for (const n of node) {
        if (!visited.has(n.value)) {
          queue.push(n)
        }
      }
    }

    return Array.from(visited)
  }
}

class Node {
  private neighbours: Node[] = []
  constructor(public readonly value: string) {}
  addNeighbour(n: Node) {
    this.neighbours.push(n)
  }
  [Symbol.iterator]() {
    return this.neighbours.values()
  }
}

export const createMap = (routeMap: string) => {
  const graph = new Graph()
  const connections = routeMap.split(',').map(c => c.split(':'))
  for (const [from, to] of connections) {
    assertThat(from && to, `Invalid connection ${from}:${to}`)
    graph.addNode(from)
    graph.addNode(to)
    graph.addEdge(from, to)
  }
  return graph
}
