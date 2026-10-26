import { Alert } from 'antd';

export function ErrorAlert({ error, style }: { error: unknown; style?: React.CSSProperties }) {
  if (!error) return null;
  return (
    <Alert
      type="error"
      showIcon
      title={error instanceof Error ? error.message : String(error)}
      style={{ marginBottom: 16, ...style }}
    />
  );
}
