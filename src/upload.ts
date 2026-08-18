import type { ClockworkExport } from './clockwork';

export type DataSourceKind = 'published' | 'upload';

/**
 * A comparison is only meaningful between two user-selected, single-provider
 * exports. Published sample data must always be replaced by the first upload.
 */
export function shouldCompareUpload(
  current: ClockworkExport | null,
  currentSource: DataSourceKind | null,
  incoming: ClockworkExport,
): boolean {
  return (
    current !== null &&
    currentSource === 'upload' &&
    current.provider !== incoming.provider &&
    current.provider !== 'both' &&
    incoming.provider !== 'both'
  );
}
