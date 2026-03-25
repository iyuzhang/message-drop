import {
  resolveMessageDropServerConfigFromEnv,
  startMessageDropServer,
} from './start-server.js'

startMessageDropServer(resolveMessageDropServerConfigFromEnv())
