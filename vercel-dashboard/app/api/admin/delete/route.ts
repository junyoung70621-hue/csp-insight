import { NextRequest, NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getSheetsToken(): Promise<string> {
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const c = await auth.getClient();
  const t = await c.getAccessToken();
  const tok = typeof t === 'string' ? t : t?.token;
  if (!tok) throw new Error('서비스계정 토큰 발급 실패');
  return tok;
}

function colLetter(idx0: number): string {
  let n = idx0, s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

export async function POST(req: NextRequest) {
  const { password, sheet, keys } = await req.json().catch(() => ({}));
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }
  const sheetId = process.env.SHEET_ID;
  const svcUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_KEY;
  if (!sheetId || !svcUrl || !svcKey || !process.env.GOOGLE_CLIENT_EMAIL) {
    return NextResponse.json({ ok: false, error: '서버 env(SHEET_ID/SUPABASE_URL/SUPABASE_SERVICE_KEY/GOOGLE_*) 미설정' }, { status: 500 });
  }
  if (!['1차필터', '2차필터'].includes(sheet) || !Array.isArray(keys) || keys.length === 0) {
    return NextResponse.json({ ok: false, error: 'sheet/keys 확인' }, { status: 400 });
  }
  const dbTable = sheet === '1차필터' ? 'cs_l1' : 'cs_l2';

  try {
    const token = await getSheetsToken();
    const auth = { Authorization: `Bearer ${token}` };
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
    const tab = encodeURIComponent(sheet);

    // 대상 시트 행번호(1-based) 계산
    let rowNums: number[] = [];
    const direct = (keys as string[]).filter((k) => /^L[12]R:\d+$/.test(k)).map((k) => parseInt(k.split(':')[1], 10));
    rowNums.push(...direct);

    const idKeys = (keys as string[]).filter((k) => k.startsWith('ID:')).map((k) => k.slice(3));
    if (idKeys.length) {
      // 2차필터의 접수번호 → 행번호 매핑
      const hr = await fetch(`${base}/values/${tab}!1:1`, { headers: auth });
      const hj = await hr.json();
      const headers: string[] = (hj.values?.[0] || []).map((s: any) => String(s).trim());
      const idCol = headers.indexOf('접수번호');
      if (idCol >= 0) {
        const L = colLetter(idCol);
        const cr = await fetch(`${base}/values/${tab}!${L}:${L}`, { headers: auth });
        const cj = await cr.json();
        const vals: any[] = cj.values || [];
        const map: Record<string, number> = {};
        for (let i = 1; i < vals.length; i++) { const v = String(vals[i]?.[0] ?? '').trim(); if (v) map[v] = i + 1; }
        idKeys.forEach((id) => { if (map[id]) rowNums.push(map[id]); });
      }
    }
    rowNums = Array.from(new Set(rowNums)).filter((n) => n >= 2).sort((a, b) => b - a); // 아래→위

    // 시트 sheetId(gid) 조회
    const metaR = await fetch(`${base}?fields=sheets(properties(sheetId,title))`, { headers: auth });
    const meta = await metaR.json();
    const prop = (meta.sheets || []).map((s: any) => s.properties).find((p: any) => p.title === sheet);
    if (!prop) return NextResponse.json({ ok: false, error: '시트 탭을 찾을 수 없음' }, { status: 502 });
    const gid = prop.sheetId;

    let sheetDeleted = 0;
    if (rowNums.length) {
      const requests = rowNums.map((r) => ({
        deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: r - 1, endIndex: r } },
      }));
      const dr = await fetch(`${base}:batchUpdate`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }),
      });
      const dj = await dr.json();
      if (!dr.ok) return NextResponse.json({ ok: false, error: '시트 삭제 실패: ' + JSON.stringify(dj).slice(0, 300) }, { status: 502 });
      sheetDeleted = rowNums.length;
    }

    // Supabase 삭제(즉시 반영)
    const inList = (keys as string[]).map((k) => '"' + k.replace(/"/g, '') + '"').join(',');
    const delUrl = `${svcUrl.replace(/\/+$/, '')}/rest/v1/${dbTable}?row_key=in.(${encodeURIComponent(inList)})`;
    const sb = await fetch(delUrl, {
      method: 'DELETE',
      headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, Prefer: 'return=minimal' },
    });
    if (!(sb.status >= 200 && sb.status < 300)) {
      const tx = await sb.text();
      return NextResponse.json({ ok: false, error: `DB 삭제 실패(HTTP ${sb.status}): ${tx.slice(0, 200)}`, sheetDeleted }, { status: 502 });
    }

    return NextResponse.json({ ok: true, sheetDeleted, dbDeleted: keys.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
