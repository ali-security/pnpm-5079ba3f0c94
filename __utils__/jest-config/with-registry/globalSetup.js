const getPort = require('get-port')
const net = require('net')
const { promisify } = require('util')
const kill = promisify(require('tree-kill'))

function canConnect (host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const done = (ok) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

async function waitForRegistry (port, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const results = await Promise.all([
      canConnect('127.0.0.1', port),
      canConnect('::1', port),
    ])
    if (results.every(Boolean)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`The registry mock did not become reachable on both 127.0.0.1 and ::1 at port ${port} within ${timeoutMs}ms`)
}

module.exports = async () => {
  if (!process.env.PNPM_REGISTRY_MOCK_PORT) {
    process.env.PNPM_REGISTRY_MOCK_PORT = (await getPort({ port: getPort.makeRange(7700, 7800) })).toString()
  }
  const { start, prepare } = require('@pnpm/registry-mock')
  prepare()
  const server = start({
    // Verdaccio stopped working properly on Node.js 22.
    // You can test the issue by running:
    //   pnpm --filter=core run test test/install/auth.ts
    useNodeVersion: '20.16.0',
    stdio: 'inherit',
    listen: `[::]:${process.env.PNPM_REGISTRY_MOCK_PORT}`,
  })
  let killed = false
  server.on('error', (err) => {
    console.log(err)
  })
  server.on('close', () => {
    if (!killed) {
      console.log('Error: The registry server was killed!')
      process.exit(1)
    }
  })
  global.killServer = () => {
    killed = true
    return kill(server.pid)
  }
  await waitForRegistry(process.env.PNPM_REGISTRY_MOCK_PORT)
}
