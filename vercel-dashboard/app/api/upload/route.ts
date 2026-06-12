import { NextRequest, NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';
import Papa from 'papaparse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Plan B: 서버(서비스계정) → Google Sheets API 로 시트에 직접 append.
//   필요한 환경변수: SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY
//   대상 탭 화이트리스트
const ALLOWED = new Set(['1차필터', '2차필터']);

/** base64 → 텍스트 (UTF-8, 깨지면 EUC-KR 재시도 — 국내 CSV 대비) */
function decodeCsv(buf: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('euc-kr').decode(buf); } catch { return utf8; }
}

async function getSheetsToken(): Promise<string> {
  const client_email = process.env.GOOGLE_CLIENT_EMAIL as string;
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const auth = new GoogleAuth({
    credentials: { client_email, private_key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const tok = await client.getAccessToken();
  const token = typeof tok === 'string' ? tok : tok?.token;
  if (!token) throw new Error('서비스계정 토큰 발급 실패');
  return token;
}

export async function POST(req: NextRequest) {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return NextResponse.json(
      { ok: false, error: '서버 환경변수(SHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY) 미설정' },
      { status: 500 });
  }
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const sheet = String(form.get('sheet') || '').trim();
    if (!file || !ALLOWED.has(sheet)) {
      return NextResponse.json({ ok: false, error: '파일/시트를 확인하세요.' }, { status: 400 });
    }

    const csvText = decodeCsv(Buffer.from(await file.arrayBuffer())).trim();
    const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
    const rows = (parsed.data as unknown as string[][]) || [];
    if (rows.length < 2) {
      return NextResponse.json({ ok: false, error: '빈 CSV 또는 헤더만 있습니다.' }, { status: 400 });
    }

    const token = await getSheetsToken();
    const auth = { Authorization: `Bearer ${token}` };
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
    const tab = encodeURIComponent(sheet);

    // 시트 헤더 행 읽기 (열 매핑 기준)
    const hr = await fetch(`${base}/values/${tab}!1:1`, { headers: auth });
    const hj = await hr.json();
    if (!hr.ok) {
      return NextResponse.json({ ok: false, error: '시트 헤더 읽기 실패: ' + JSON.stringify(hj).slice(0, 300) }, { status: 502 });
    }
    const sheetHeaders: string[] = (hj.values?.[0] || []).map((s: any) => String(s).trim());
    const nCols = sheetHeaders.length || rows[0].length;

    // CSV 헤더 → 시트 열 매핑(이름 기준), 없으면 -1
    const csvHeaders = rows[0].map((s) => String(s).trim());
    const colMap = csvHeaders.map((h) => sheetHeaders.indexOf(h));

    const values: string[][] = [];
    for (let r = 1; r < rows.length; r++) {
      const arr = new Array(nCols).fill('');
      for (let c = 0; c < csvHeaders.length; c++) {
        const sc = colMap[c];
        if (sc >= 0) arr[sc] = rows[r][c] ?? '';
      }
      values.push(arr);
    }

    // 시트 맨 아래에 추가
    const ap = await fetch(
      `${base}/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
    const aj = await ap.json();
    if (!ap.ok) {
      return NextResponse.json({ ok: false, error: 'append 실패: ' + JSON.stringify(aj).slice(0, 300) }, { status: 502 });
    }

    return NextResponse.json({ ok: true, sheet, added: values.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
