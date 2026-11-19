/** Sitios de banca y pagos: Hanzo nunca actúa en ellos ni lee su contenido sin que lo pidas. */
export function isBlockedHost(host: string): boolean {
  return /(bank|banco|paypal|stripe|binance|coinbase|wise\.com|pichincha|produbanco|bolivariano|payphone|datafast|kushki|(^|\.)pay\.|checkout)/i.test(host);
}
