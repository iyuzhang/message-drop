import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { Bonjour } from 'bonjour-service'
import { markUdpBeacon, setDiscoveryMeta, telemetry } from './telemetry.js'

export interface DiscoveryHandle {
  stop: () => void
}

function isDiscoveryVerbose(): boolean {
  const raw = process.env.MESSAGE_DROP_DISCOVERY_VERBOSE
  if (raw === undefined) {
    return false
  }
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export function startLanDiscovery(httpPort: number): DiscoveryHandle {
  const verbose = isDiscoveryVerbose()
  const udpPort = Number(
    process.env.MESSAGE_DROP_DISCOVERY_UDP_PORT || '47810',
  )
  setDiscoveryMeta({ udpPort })

  const bonjour = new Bonjour()
  try {
    bonjour.publish({
      name: `Message Drop`,
      type: 'message-drop',
      port: httpPort,
      txt: { path: '/ws', v: '1' },
    })
    setDiscoveryMeta({ mdnsPublished: true })
    console.log('[discovery] mDNS service message-drop published')
  } catch (e) {
    console.error('[discovery] mDNS publish failed', e)
    setDiscoveryMeta({ mdnsPublished: false })
  }

  const sock = createSocket('udp4')
  const beaconPayload = () =>
    JSON.stringify({
      svc: 'message-drop',
      v: 1,
      http: httpPort,
      wsPath: '/ws',
    })

  sock.on('error', (err) => {
    console.error('[discovery] udp socket error', err)
  })

  sock.bind(0, '0.0.0.0', () => {
    try {
      sock.setBroadcast(true)
    } catch (e) {
      console.error('[discovery] setBroadcast failed', e)
    }
  })

  const sendBeacon = (): void => {
    const msg = Buffer.from(beaconPayload(), 'utf8')
    const hosts = new Set<string>(['255.255.255.255'])
    for (const list of Object.values(networkInterfaces())) {
      if (!list) continue
      for (const addr of list) {
        if (addr.family !== 'IPv4' || addr.internal || !addr.netmask) continue
        const ip = addr.address.split('.').map(Number)
        const mask = addr.netmask.split('.').map(Number)
        if (ip.length !== 4 || mask.length !== 4) continue
        const bcast = ip.map((oct, i) => (oct | (~mask[i]! & 255)) & 255).join('.')
        hosts.add(bcast)
      }
    }
    let pending = hosts.size
    for (const host of hosts) {
      sock.send(msg, udpPort, host, (err) => {
        if (err) {
          console.error('[discovery] udp send error', err)
        } else if (verbose) {
          console.log(`[discovery] udp beacon -> ${host}:${udpPort}`)
        }
        pending--
        if (pending <= 0) markUdpBeacon()
      })
    }
  }

  sendBeacon()
  const timer = setInterval(sendBeacon, 3000)

  return {
    stop: () => {
      clearInterval(timer)
      sock.close()
      bonjour.unpublishAll(() => {
        bonjour.destroy()
      })
      setDiscoveryMeta({ mdnsPublished: false })
      telemetry.discovery.lastUdpBeaconAt = 0
    },
  }
}
