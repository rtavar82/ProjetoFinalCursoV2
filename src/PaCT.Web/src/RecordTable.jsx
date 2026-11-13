import moneyText from './moneyText'
import styles from './RecordTable.module.css'

export default function RecordTable({ caption, columns, rows, rowKey, emptyText }) {
  return <div className={styles.scroll} tabIndex={0} role="region" aria-label={caption}>
    <table className={styles.table}><caption>{caption}</caption>
      <thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.key}>{moneyText(column.render(row))}</td>)}</tr>)}</tbody>
    </table>{rows.length === 0 && <p>{emptyText || 'Não existem registos.'}</p>}
  </div>
}
