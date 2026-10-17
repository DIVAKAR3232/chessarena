import type { ReactNode } from 'react';
import { EmptyState, ErrorState, Pagination, Spinner } from '../ui';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  rowKey: (row: T) => string;
  empty?: string;
  page?: number;
  totalPages?: number;
  onPage?: (p: number) => void;
}

export function DataTable<T>({ columns, rows, loading, error, onRetry, rowKey, empty = 'Nothing here yet', page, totalPages, onPage }: Props<T>) {
  if (loading && !rows) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!rows?.length) return <EmptyState title={empty} />;
  return (
    <>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`px-4 py-2 font-medium ${c.className ?? ''}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-60' : undefined}>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-2.5 align-middle ${c.className ?? ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page && totalPages && onPage ? <Pagination page={page} totalPages={totalPages} onChange={onPage} /> : null}
    </>
  );
}
