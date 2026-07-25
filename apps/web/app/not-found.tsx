import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1f2328' }}>404 — Page Not Found</h2>
      <Link href="/" style={{ color: '#0969da', fontSize: 13 }}>← Home</Link>
    </div>
  );
}
