// Shared by file intake, input validation, and deterministic rule evaluation.
export const measurementUnits = ['°C', 'C', '°F', 'F', 'K', 'm', 'ft', 'km', 'm/s', 'ft/s', 'km/h', 'mph', 'mm/s', 'm/s²', 'g', 'V', 'mV', 'A', 'mA', 'Pa', 'kPa', 'bar', 'psi', '°', 'rad', 's', 'ms', 'events', 'boolean', ''] as const
export type MeasurementUnit = typeof measurementUnits[number]
export const unitConversions: Record<MeasurementUnit, { family: string; scale: number; offset: number }> = {
  C: { family: 'temperature', scale: 1, offset: 0 }, '°C': { family: 'temperature', scale: 1, offset: 0 },
  F: { family: 'temperature', scale: 5 / 9, offset: -160 / 9 }, '°F': { family: 'temperature', scale: 5 / 9, offset: -160 / 9 }, K: { family: 'temperature', scale: 1, offset: -273.15 },
  m: { family: 'length', scale: 1, offset: 0 }, ft: { family: 'length', scale: 0.3048, offset: 0 }, km: { family: 'length', scale: 1000, offset: 0 },
  'm/s': { family: 'speed', scale: 1, offset: 0 }, 'ft/s': { family: 'speed', scale: 0.3048, offset: 0 }, 'km/h': { family: 'speed', scale: 1 / 3.6, offset: 0 }, mph: { family: 'speed', scale: 0.44704, offset: 0 },
  'mm/s': { family: 'vibration', scale: 1, offset: 0 }, 'm/s²': { family: 'acceleration', scale: 1, offset: 0 }, g: { family: 'acceleration', scale: 9.80665, offset: 0 },
  V: { family: 'voltage', scale: 1, offset: 0 }, mV: { family: 'voltage', scale: 0.001, offset: 0 }, A: { family: 'current', scale: 1, offset: 0 }, mA: { family: 'current', scale: 0.001, offset: 0 },
  Pa: { family: 'pressure', scale: 1, offset: 0 }, kPa: { family: 'pressure', scale: 1000, offset: 0 }, bar: { family: 'pressure', scale: 100000, offset: 0 }, psi: { family: 'pressure', scale: 6894.757293, offset: 0 },
  '°': { family: 'angle', scale: 1, offset: 0 }, rad: { family: 'angle', scale: 180 / Math.PI, offset: 0 },
  s: { family: 'time', scale: 1, offset: 0 }, ms: { family: 'time', scale: 0.001, offset: 0 }, events: { family: 'events', scale: 1, offset: 0 }, boolean: { family: 'boolean', scale: 1, offset: 0 }, '': { family: 'none', scale: 1, offset: 0 },
}
export function guessUnit(header: string): MeasurementUnit {
  const raw = /\(([^)]+)\)|\[([^\]]+)\]/.exec(header)?.slice(1).find(Boolean)?.trim()
  const aliases: Record<string, MeasurementUnit> = { degC: '°C', degF: '°F', 'm/s^2': 'm/s²', 'm/s2': 'm/s²', deg: '°', degrees: '°', volts: 'V', meters: 'm', feet: 'ft', sec: 's' }
  return raw && (measurementUnits as readonly string[]).includes(raw) ? raw as MeasurementUnit : raw && aliases[raw] ? aliases[raw] : ''
}
