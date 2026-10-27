/** The runtime and configurator accept the same positive decimal pool limit. */
export function isValidPoolMax(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}
