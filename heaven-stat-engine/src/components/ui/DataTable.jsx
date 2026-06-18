'use client';
import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import MetricTooltip from './MetricTooltip';

/**
 * DataTable — sortable, filterable, paginated table.
 * Columns: [{ header, accessor?, render?, width?, sortable? }]
 */
export default function DataTable({
  columns = [],
  data = [],
  searchPlaceholder = 'Search...',
  searchable = true,
  onRowClick,
  emptyMessage = 'No data',
  pageSize = 50,
  rowClassName,
  stickyHeader = true,
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const val = col.accessor ? row[col.accessor] : '';
        return String(val ?? '').toLowerCase().includes(q);
      })
    );
  }, [data, search, columns]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (accessor) => {
    if (!accessor) return;
    if (sortKey === accessor) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(accessor);
      setSortDir('asc');
    }
    setPage(1);
  };

  const SortIcon = ({ accessor }) => {
    if (sortKey !== accessor) return <ArrowUpDown size={12} className="sort-icon-neutral" />;
    return sortDir === 'asc' ? <ArrowUp size={12} className="sort-icon-active" /> : <ArrowDown size={12} className="sort-icon-active" />;
  };

  return (
    <div className="data-table-container">
      {searchable && (
        <div className="data-table-toolbar">
          <div className="search-input-wrap">
            <Search size={15} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <span className="data-table-count">{filtered.length} records</span>
        </div>
      )}

      <div className="data-table-scroll">
        <table className={`data-table ${stickyHeader ? 'sticky-header' : ''}`}>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={col.accessor || col.key || i}
                  style={{ width: col.width }}
                  className={col.accessor ? 'sortable-th' : ''}
                  onClick={() => col.accessor && handleSort(col.accessor)}
                >
                  <span className="th-content" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {col.header}
                    {col.accessor && <SortIcon accessor={col.accessor} />}
                    {typeof col.header === 'string' && <MetricTooltip metricKey={col.header} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty-row">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paged.map((row, i) => (
                <tr
                  key={row.id || i}
                  className={`data-row ${onRowClick ? 'clickable-row' : ''} ${rowClassName ? rowClassName(row) : ''}`}
                  onClick={() => onRowClick && onRowClick(row)}
                >
                  {columns.map((col, ci) => (
                    <td key={col.accessor || col.key || ci}>
                      {col.render ? col.render(row, i) : (row[col.accessor] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="page-btn" disabled={page === 1} onClick={() => setPage(1)}>«</button>
          <button className="page-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
          <span className="page-info">Page {page} of {totalPages}</span>
          <button className="page-btn" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
          <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
        </div>
      )}
    </div>
  );
}
