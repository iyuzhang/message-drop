export interface DiscoveryTelemetry {
  mdnsPublished: boolean
  mdnsType: string
  udpPort: number
  lastUdpBeaconAt: number
}

const discovery: DiscoveryTelemetry = {
  mdnsPublished: false,
  mdnsType: 'message-drop',
  udpPort: 47810,
  lastUdpBeaconAt: 0,
}

export const telemetry = {
  wsConnections: 0,
  discovery,
}

export function getTelemetry(): typeof telemetry {
  return telemetry
}

export function setDiscoveryMeta(partial: Partial<DiscoveryTelemetry>): void {
  Object.assign(telemetry.discovery, partial)
}

export function markUdpBeacon(): void {
  telemetry.discovery.lastUdpBeaconAt = Date.now()
}
