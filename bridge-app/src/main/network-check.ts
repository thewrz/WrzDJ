/**
 * Detects multiple network interfaces sharing the same subnet.
 *
 * When two interfaces (e.g. a bridge + WiFi) have IPs on the same subnet,
 * UDP broadcast-based DJ protocols (StageLinQ, Pioneer PRO DJ LINK) can
 * announce on one IP but route TCP through the other, causing connection
 * failures. This module surfaces a warning at bridge start.
 */
import os from 'os';
import type { NetworkInterfaceInfo } from 'os';

export interface SubnetConflict {
  readonly subnet: string;
  readonly interfaces: readonly { readonly name: string; readonly address: string }[];
}

/**
 * Calculate the network address from an IP and netmask.
 * Returns a "subnet/prefix" string like "192.168.1.0/24".
 */
function calculateSubnet(address: string, netmask: string): string {
  const ipParts = address.split('.').map(Number);
  const maskParts = netmask.split('.').map(Number);

  const networkParts = ipParts.map((octet, i) => octet & maskParts[i]);
  const networkAddr = networkParts.join('.');

  // Count prefix bits from netmask
  const prefixLen = maskParts.reduce((bits, octet) => {
    let n = octet;
    while (n > 0) {
      bits += n & 1;
      n >>= 1;
    }
    return bits;
  }, 0);

  return `${networkAddr}/${prefixLen}`;
}

/**
 * Pure detection function that takes interface data directly.
 * Useful for testing without mocking os.networkInterfaces().
 */
export function detectSubnetConflictsFrom(
  interfaces: Record<string, NetworkInterfaceInfo[]>,
): SubnetConflict[] {
  const subnetMap = new Map<string, { name: string; address: string }[]>();

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;

      const subnet = calculateSubnet(addr.address, addr.netmask);
      const existing = subnetMap.get(subnet) ?? [];
      existing.push({ name, address: addr.address });
      subnetMap.set(subnet, existing);
    }
  }

  return Array.from(subnetMap.entries())
    .filter(([, ifaces]) => ifaces.length > 1)
    .map(([subnet, ifaces]) => ({ subnet, interfaces: ifaces }));
}

/**
 * Detect subnet conflicts using live system network interfaces.
 */
export function detectSubnetConflicts(): SubnetConflict[] {
  const interfaces = os.networkInterfaces();
  // os.networkInterfaces() values can be undefined per type def
  const cleaned: Record<string, NetworkInterfaceInfo[]> = {};
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (addrs) cleaned[name] = addrs;
  }
  return detectSubnetConflictsFrom(cleaned);
}

/**
 * Format subnet conflicts into human-readable warning lines.
 */
export function formatConflictWarnings(conflicts: SubnetConflict[]): string[] {
  return conflicts.map((conflict) => {
    const ifaceList = conflict.interfaces
      .map((iface) => `${iface.name} (${iface.address})`)
      .join(', ');
    return `Multiple interfaces on subnet ${conflict.subnet}: ${ifaceList}. This may cause DJ equipment connection failures — consider disabling one interface.`;
  });
}
