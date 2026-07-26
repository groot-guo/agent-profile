import Link from 'next/link';
import { C, FS, SP } from './theme';

export default function NotFound() {
  return (
    <div style={{ padding: 64, textAlign: 'center' }}>
      <div style={{ fontSize: 32, fontWeight: 700, color: C.mute }} className="tnum">
        404
      </div>
      <p style={{ fontSize: FS.base, color: C.sub, margin: `${SP.sm}px 0 ${SP.lg}px` }}>
        页面不存在
      </p>
      <Link href="/" style={{ color: C.link, fontSize: FS.sm, textDecoration: 'none' }}>
        ← 返回会话列表
      </Link>
    </div>
  );
}
