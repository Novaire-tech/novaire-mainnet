import React from 'react';

export interface Column<T> {
  header: string;
  accessor: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (row: T, index: number) => string;
  emptyState?: React.ReactNode;
}

export function DataTable<T>({ data, columns, keyExtractor, emptyState }: DataTableProps<T>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            {columns.map((col, index) => (
              <th 
                key={index} 
                className={`py-4 px-2 text-xs font-medium text-[#F5F5F2]/60 font-sans ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                style={{ width: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && emptyState ? (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-[#F5F5F2]/60 font-sans">
                {emptyState}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr 
                key={keyExtractor(row, rowIndex)} 
                className="border-b border-white/10 hover:bg-white/5 transition-colors group"
              >
                {columns.map((col, colIndex) => (
                  <td 
                    key={colIndex} 
                    className={`py-4 px-2 text-sm text-white font-sans ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                  >
                    {col.accessor(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
