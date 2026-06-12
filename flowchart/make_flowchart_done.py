# -*- coding: utf-8 -*-
"""
티머니 고객센터 전화접수 자동화 — "완료분만" 순서도 생성기
포함: ① Google Sheet 입력 → ② GAS 전체새로고침 적재 → ③ Supabase 집계 → ④ Vercel 대시보드(+GitHub 자동배포)
제외(미완료): Gemini 일일 메일(runDaily/installTrigger), CSV 업로드(Plan B 코드만)
실행: python flowchart/make_flowchart_done.py  ->  flowchart/process_flow_done.jpg
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.font_manager import FontProperties

# ---- 한글 폰트 (맑은 고딕) ----
FONT_PATH = r"C:\Windows\Fonts\malgun.ttf"
if os.path.exists(FONT_PATH):
    fp = FontProperties(fname=FONT_PATH)
    matplotlib.rcParams["font.family"] = fp.get_name()
else:
    fp = FontProperties()
matplotlib.rcParams["axes.unicode_minus"] = False

# ---- 노드 색상 ----
C_MANUAL = "#F5F5F5"   # 사용자 수동 (시트 입력 · 대시보드 열람)
C_GAS    = "#E3ECFE"   # GAS 자동화
C_SUPA   = "#E6F4EA"   # Supabase 저장/연산
C_DEPLOY = "#FFF4E0"   # 배포/인프라 (Vercel·GitHub)
EDGE_GAS = "#4285F4"
EDGE     = "#37474F"

# ---- 단계(그룹) 배경 ----
G_BG = ["#EAF2FB", "#EAF6EE", "#FBF7EE", "#FBF3E6"]

fig, ax = plt.subplots(figsize=(12, 17))
ax.set_xlim(0, 120)
ax.set_ylim(0, 170)
ax.axis("off")


def box(x, y, w, h, text, color, fs=10.3, bold=True, dashed=False):
    p = FancyBboxPatch(
        (x - w / 2, y - h / 2), w, h,
        boxstyle="round,pad=0.4,rounding_size=1.6",
        linewidth=1.7,
        edgecolor=EDGE_GAS if dashed else EDGE,
        facecolor=color,
        linestyle=(0, (5, 3)) if dashed else "solid",
    )
    ax.add_patch(p)
    ax.text(x, y, text, ha="center", va="center",
            fontproperties=fp, fontsize=fs,
            fontweight="bold" if bold else "normal", color="#1A1A1A")


def arrow(x1, y1, x2, y2, color=EDGE, style="-|>", lw=1.8, ls="solid", text=None, tcolor="#5E35B1"):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style,
                        mutation_scale=18, linewidth=lw, color=color,
                        linestyle=ls, connectionstyle="arc3,rad=0")
    ax.add_patch(a)
    if text:
        ax.text((x1 + x2) / 2 + 2.5, (y1 + y2) / 2, text,
                ha="left", va="center", fontproperties=fp,
                fontsize=8.8, color=tcolor)


def group(y0, y1, color, label):
    ax.add_patch(FancyBboxPatch(
        (9, y0), 102, (y1 - y0),
        boxstyle="round,pad=0.3,rounding_size=2",
        linewidth=1.2, edgecolor="#B0BEC5", facecolor=color, alpha=0.55))
    ax.text(13, y1 - 2.4, label, ha="left", va="center",
            fontproperties=fp, fontsize=12, fontweight="bold", color="#37474F")


CX = 46          # 메인 흐름 X
W = 50           # 기본 박스 너비

# ---- 제목 ----
ax.text(60, 166, "티머니 고객센터 전화접수 현황 — 자동화 (완료분 순서도)",
        ha="center", va="center", fontproperties=fp, fontsize=17, fontweight="bold")
ax.text(60, 161.5,
        "작동 중인 핵심 파이프라인:  시트 입력 → GAS 전체새로고침 적재 → Supabase SQL 집계 → Vercel 대시보드 직접조회",
        ha="center", va="center", fontproperties=fp, fontsize=10, color="#555")

# ---- 단계 그룹 배경 ----
group(132, 156, G_BG[0], "① 데이터 입력 (Google Sheet · 입력 창구/뷰)")
group(86,  130, G_BG[1], "② GAS 적재 — syncToSupabase (전체 새로고침, 10분 주기)")
group(40,  84,  G_BG[2], "③ Supabase — 저장 + SQL 집계 (ref epvtsaowyizuhvrwcrmp)")
group(4,   38,  G_BG[3], "④ Vercel 대시보드 + GitHub 자동배포")

# ---- 노드 (y, w, h, text, color, dashed, x) ----
nodes = {
    # ① 입력
    "A": (146, 48, 7, "[1차필터] 탭 = 전화상담 전체(CRM형)\n날짜·필터여부·상담유형(대)·처리상태·배정부서", C_MANUAL, False, 34),
    "A2":(146, 48, 7, "[2차필터] 탭 = AS/현장\n접수번호(고유ID)·2차필터·차량ID·현장처리유형", C_MANUAL, False, 87),
    "B": (137, 44, 6, "두 탭에 상담/현장 데이터 입력", C_MANUAL, False, 60.5),

    # ② GAS 적재
    "C": (121, W, 8, "트리거: installSyncTrigger (10분 주기)\nrefreshTab_ = 비우고 다시 적재", C_GAS, True, 60.5),
    "D": (113, W, 9, "supabaseDeleteAll_ → 시트 행 읽기\n(고유ID 없는 1차필터 중복방지 위해 전체 새로고침)", C_GAS, True, 60.5),
    "E": (101, W, 10, "행 변환(연산 X): 차량번호·차량ID 마스킹 ***\n요청자명·카드번호 미저장 / parseDate_ ISO 정규화\ndedupeByKey_ (배치 내 중복 제거)", C_GAS, True, 60.5),
    "F": (90,  W, 8, "supabaseUpsert_ (service_role 키)\n키: cs_l1='L1R:'+행번호 · cs_l2=접수번호", C_GAS, True, 60.5),

    # ③ Supabase
    "G": (75, W, 8, "적재 완료:  cs_l1 = 685행 · cs_l2 = 4600행\nschema.sql v4 적용(cs_ 객체 19개)", C_SUPA, False, 60.5),
    "H": (64, W, 12, "SQL 집계(뷰/함수가 계산, cs_week_label):\n1차=cs_l1 684 · 2차='2차 미출동' 359\n현장인계='현장인계' 3707(필터 제외)\n총합계 4750 · 필터율=(1차+2차)/총합=22.0%", C_SUPA, False, 60.5),
    "I": (50, W, 9, "대시보드 제공 뷰(anon=View만 SELECT)\ncs_v_total_summary · cs_v_weekly_full · cs_v_monthly_summary\n분해(부서/상담유형/처리상태)=cs_l1 기준", C_SUPA, False, 60.5),

    # ④ Vercel + GitHub
    "J": (28, W, 9, "Next.js 14: lib/supabase.ts → anon 키로 집계 뷰 직접 조회\nURL: https://csp-insight.vercel.app", C_DEPLOY, False, 40),
    "K": (16, W, 9, "렌더링(정상 확인): 주차 선택 탭 · KPI 카드\n분해 차트 · 월간 추이", C_MANUAL, False, 40),
    "G1":(22, 40, 11, "GitHub: csp-insight(main)\n↓ git push\nVercel 자동 빌드/배포\nrootDir=vercel-dashboard", C_DEPLOY, False, 92),
}

POS = {}
for k, (y, w, h, txt, color, dashed, x) in nodes.items():
    POS[k] = (x, y, w, h)
    box(x, y, w, h, txt, color, fs=8.7, dashed=dashed)

# ---- 화살표 ----
def a_vert(a, b):
    x1, y1, w1, h1 = POS[a]
    x2, y2, w2, h2 = POS[b]
    arrow(x1, y1 - h1 / 2, x2, y2 + h2 / 2)

# ① 두 탭 → B
arrow(POS["A"][0], POS["A"][1] - POS["A"][3] / 2, POS["B"][0] - 6, POS["B"][1] + POS["B"][3] / 2)
arrow(POS["A2"][0], POS["A2"][1] - POS["A2"][3] / 2, POS["B"][0] + 6, POS["B"][1] + POS["B"][3] / 2)

# 메인 세로 체인
for a, b in [("B", "C"), ("C", "D"), ("D", "E"), ("E", "F"),
             ("F", "G"), ("G", "H"), ("H", "I"), ("I", "J"), ("J", "K")]:
    a_vert(a, b)

# GitHub 자동배포 → Vercel(J) 점선 분기
arrow(POS["G1"][0] - POS["G1"][2] / 2, POS["G1"][1],
      POS["J"][0] + POS["J"][2] / 2, POS["J"][1],
      color="#F57C00", ls=(0, (4, 2)), text="push 시 자동 재배포", tcolor="#E65100")

# ---- 범례 ----
LX0, LY0, LX1, LY1 = 73, 5, 110, 13.5
ax.add_patch(FancyBboxPatch(
    (LX0, LY0), LX1 - LX0, LY1 - LY0,
    boxstyle="round,pad=0.3,rounding_size=2",
    linewidth=1.2, edgecolor="#90A4AE", facecolor="white"))
ax.text((LX0 + LX1) / 2, LY1 - 2, "색상 범례", ha="center", va="center",
        fontproperties=fp, fontsize=9.5, fontweight="bold", color="#37474F")
legend = [
    (C_MANUAL, EDGE,     "solid",     "사용자/열람"),
    (C_GAS,    EDGE_GAS, (0, (4, 2)), "GAS 자동화"),
    (C_SUPA,   EDGE,     "solid",     "Supabase"),
    (C_DEPLOY, EDGE,     "solid",     "Vercel·GitHub"),
]
lx = LX0 + 3
for face, ec, ls, label in legend:
    ax.add_patch(FancyBboxPatch(
        (lx, LY0 + 1.5), 3.4, 2.4,
        boxstyle="round,pad=0.1,rounding_size=0.6",
        linewidth=1.4, edgecolor=ec, facecolor=face, linestyle=ls))
    ax.text(lx + 4.2, LY0 + 2.7, label, ha="left", va="center",
            fontproperties=fp, fontsize=7.8, color="#212121")
    lx += 18.5 if False else (LX1 - LX0 - 6) / 4

plt.tight_layout()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "process_flow_done.jpg")
plt.savefig(OUT, dpi=150, format="jpg", bbox_inches="tight", facecolor="white")
print("SAVED:", OUT)
