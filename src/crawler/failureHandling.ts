export function shouldKeepBrowserOpenOnFailure(value: string | undefined): boolean {
  return value !== '0' && value !== 'false';
}
