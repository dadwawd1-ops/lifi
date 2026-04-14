import { createServer } from 'node:http'
import { createApp } from './app.js'

const host = '127.0.0.1'
const port = 5174
const app = createApp()

const server = createServer(app)

server.listen(port, host, () => {
  console.log(`ui-app BFF listening at http://${host}:${port}`)
})
