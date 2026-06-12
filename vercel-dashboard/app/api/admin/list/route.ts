import { NextRequest, NextResponse } from 'next/server';
import { getL1Rows, getL2Rows } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export async function POST(req: NextRequest) {
  const { password, tab, page } = await req.json().catch(() => ({}));
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }
  const p = Math.max(0, parseInt(String(page ?? 0), 10) || 0);
  const offset = p * PAGE_SIZE;
  try {
    let rows;
    if (tab === 'l1') rows = await getL1Rows(PAGE_SIZE, offset);
    else if (tab === '2차미출동') rows = await getL2Rows('2차미출동', PAGE_SIZE, offset);
    else if (tab === '현장인계') rows = await getL2Rows('현장인계', PAGE_SIZE, offset);
    else rows = await getL2Rows(null, PAGE_SIZE, offset);
    return NextResponse.json({ ok: true, rows, page: p, size: PAGE_SIZE });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
