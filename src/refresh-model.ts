import type { QueryResult, QueryTab } from "./model";
// Reuse existing row references so refreshing never tears down the grid.
export function reconciledResult(
  previous: QueryResult | undefined,
  result: QueryResult,
  keepTiming = false,
): QueryResult {
  const sameColumns =
    previous &&
    JSON.stringify(previous.columns) === JSON.stringify(result.columns);
  const rows = result.rows.map((row, i) =>
    sameColumns && JSON.stringify(previous.rows[i]) === JSON.stringify(row)
      ? previous.rows[i]
      : row,
  );
  const unchanged =
    previous &&
    sameColumns &&
    previous.rows.length === rows.length &&
    rows.every((row, i) => row === previous.rows[i]) &&
    previous.truncated === result.truncated &&
    previous.affectedRows === result.affectedRows;
  if (unchanged && (keepTiming || previous.elapsedMs === result.elapsedMs))
    return previous;
  return {
    ...result,
    rows,
    elapsedMs: keepTiming
      ? (previous?.elapsedMs ?? result.elapsedMs)
      : result.elapsedMs,
  };
}
// Ignore background responses after the user changes query or page.
export function refreshedTab(
  tab: QueryTab,
  result: QueryResult,
  sql: string,
  page: number,
): QueryTab {
  if (tab.sql !== sql || tab.page !== page) return tab;
  const next = reconciledResult(tab.result, result, true);
  if (next === tab.result && !tab.error && !tab.execution) return tab;
  return { ...tab, error: undefined, execution: undefined, result: next };
}
