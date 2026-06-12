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

// 설정 점검용(쓰기 없음): env / 서비스계정 인증 / 시트 공유 여부 확인
export async function GET() {
  const sheetId = process.env.SHEET_ID;
  const has = {
    SHEET_ID: !!sheetId,
    GOOGLE_CLIENT_EMAIL: !!process.env.GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
  };
  if (!has.SHEET_ID || !has.GOOGLE_CLIENT_EMAIL || !has.GOOGLE_PRIVATE_KEY) {
    return NextResponse.json({ ok: false, error: '환경변수 미설정', has }, { status: 500 });
  }
  try {
    const token = await getSheetsToken();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
    const tabs: Record<string, unknown> = {};
    for (const tab of ['1차필터', '2차필터']) {
      const r = await fetch(`${base}/values/${encodeURIComponent(tab)}!1:1`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      tabs[tab] = r.ok ? { headerCols: (j.values?.[0] || []).length } : { error: j.error?.message || 'fail' };
    }
    return NextResponse.json({ ok: true, tabs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
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

    const buf = Buffer.from(await file.arrayBuffer());
    const name = (file.name || '').toLowerCase();
    let rows: string[][];
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      // xlsx → 첫 시트를 행 배열로 (날짜 등은 표시값 그대로)
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][];
    } else {
      const csvText = decodeCsv(buf).trim();
      rows = (Papa.parse<string[]>(csvText, { skipEmptyLines: true }).data as unknown as string[][]) || [];
    }
    rows = rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
    if (rows.length < 2) {
      return NextResponse.json({ ok: false, error: '빈 파일 또는 헤더만 있습니다.' }, { status: 400 });
    }

    const token = await getSheetsToken();
    const auth = { Authorization: `Bearer ${token}` };
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
    const tab = encodeURIComponent(sheet);

    // 시트 전체 읽기 (헤더 + 기존행) — 중복 판정용
    const gr = await fetch(`${base}/values/${tab}`, { headers: auth });
    const gj = await gr.json();
    if (!gr.ok) {
      return NextResponse.json({ ok: false, error: '시트 읽기 실패: ' + JSON.stringify(gj).slice(0, 300) }, { status: 502 });
    }
    const existing: any[][] = gj.values || [];
    const sheetHeaders: string[] = (existing[0] || []).map((s: any) => String(s).trim());
    const nCols = sheetHeaders.length || rows[0].length;

    // CSV 헤더 → 시트 열 매핑(이름 기준), 없으면 -1
    const csvHeaders = rows[0].map((s) => String(s).trim());
    const colMap = csvHeaders.map((h) => sheetHeaders.indexOf(h));
    // 중복키 산정에 쓸 시트 컬럼 인덱스(= CSV가 채우는 컬럼만, 수식열 A~D 등은 제외)
    const keyIdx = Array.from(new Set(colMap.filter((i) => i >= 0))).sort((a, b) => a - b);
    const norm = (v: any) => String(v ?? '').trim();
    const keyOf = (arr: any[]) => keyIdx.map((ci) => norm(arr[ci])).join('');

    // 기존 행들의 키 Set
    const seen = new Set<string>();
    for (let r = 1; r < existing.length; r++) {
      if (keyIdx.length) seen.add(keyOf(existing[r]));
    }

    // 신규 행만 추림 (파일 내부 중복도 제거)
    const values: string[][] = [];
    let skipped = 0;
    for (let r = 1; r < rows.length; r++) {
      const arr = new Array(nCols).fill('');
      for (let c = 0; c < csvHeaders.length; c++) {
        const sc = colMap[c];
        if (sc >= 0) arr[sc] = rows[r][c] ?? '';
      }
      const key = keyOf(arr);
      if (keyIdx.length && seen.has(key)) { skipped++; continue; }
      seen.add(key);
      values.push(arr);
    }

    if (values.length) {
      const ap = await fetch(
        `${base}/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
      const aj = await ap.json();
      if (!ap.ok) {
        return NextResponse.json({ ok: false, error: 'append 실패: ' + JSON.stringify(aj).slice(0, 300) }, { status: 502 });
      }
    }

    return NextResponse.json({ ok: true, sheet, added: values.length, skipped });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
