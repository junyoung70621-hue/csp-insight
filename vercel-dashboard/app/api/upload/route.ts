import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 브라우저 → (이 서버 라우트) → GAS 웹앱(doPost).
// GAS_UPLOAD_URL 은 서버 전용 env (브라우저에 노출 안 함).
export async function POST(req: NextRequest) {
  const url = process.env.GAS_UPLOAD_URL;
  if (!url) {
    return NextResponse.json({ ok: false, error: 'GAS_UPLOAD_URL 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const sheet = String(form.get('sheet') || '').trim();
    if (!file || !sheet) {
      return NextResponse.json({ ok: false, error: '파일과 시트를 모두 지정하세요.' }, { status: 400 });
    }
    const b64 = Buffer.from(await file.arrayBuffer()).toString('base64');

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet, b64 }),
      redirect: 'follow',
    });
    const text = await resp.text();
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ ok: false, error: 'GAS 응답 파싱 실패', raw: text.slice(0, 400) }, { status: 502 });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
