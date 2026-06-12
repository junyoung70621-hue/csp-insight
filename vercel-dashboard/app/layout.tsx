import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '고객센터 전화접수 현황',
  description: '주간 전화접수 집계 및 AI 분석 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
