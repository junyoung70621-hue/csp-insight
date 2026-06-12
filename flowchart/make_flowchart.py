# -*- coding: utf-8 -*-
"""
티머니 고객센터 전화접수 현황 자동화 - 프로세스 순서도 생성기 (v2)
구조: 붙여주신 Mermaid의 4단계 그룹은 유지, 내용은 실제 v2 구현에 맞춤
아키텍처: 구글시트=입력/뷰, Supabase=저장+연산, Vercel=직접조회
실행: python flowchart/make_flowchart.py  ->  flowchart/process_flow.jpg
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

# ---- 노드 색상 (Mermaid 의미 그대로) ----
C_MANUAL = "#F5F5F5"   # 사용자 수동 (입력/대시보드 열람)
C_GAS    = "#E3ECFE"   # GAS 자동화 구간
C_SUPA   = "#E6F4EA"   # Supabase 저장/연산
C_GEMINI = "#FCE8E6"   # Gemini AI 분석
EDGE_GAS = "#4285F4"
EDGE     = "#37474F"

# ---- 단계(그룹) 배경 ----
G_BG = ["#EAF2FB", "#EAF6EE", "#FBF0EE", "#F3ECFB"]

fig, ax = plt.subplots(figsize=(12, 17))
ax.set_xlim(0, 120)
ax.set_ylim(0, 170)
ax.axis("off")


def box(x, y, w, h, text, color, fs=11, bold=True, dashed=False):
    p = FancyBboxPatch(
        (x - w / 2, y - h / 2), w, h,
        boxstyle="round,pad=1.0,rounding_size=2.2",
        linewidth=1.7,
        edgecolor=EDGE_GAS if dashed else EDGE,
        facecolor=color,
        linestyle=(0, (5, 3)) if dashed else "solid",
    )
    ax.add_patch(p)
    ax.text(x, y, text, ha="center", va="center",
            fontproperties=fp, fontsize=fs,
            fontweight="bold" if bold else "normal", color="#1A1A1A")


def arrow(x1, y1, x2, y2, color=EDGE, style="-|>", lw=1.8, ls="solid", text=None):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style,
                        mutation_scale=18, linewidth=lw, color=color,
                        linestyle=ls, connectionstyle="arc3,rad=0")
    ax.add_patch(a)
    if text:
        ax.text((x1 + x2) / 2 + 2.5, (y1 + y2) / 2, text,
                ha="left", va="center", fontproperties=fp,
                fontsize=9, color="#5E35B1")


def group(y0, y1, color, label):
    ax.add_patch(FancyBboxPatch(
        (9, y0), 102, (y1 - y0),
        boxstyle="round,pad=0.3,rounding_size=2",
        linewidth=1.2, edgecolor="#B0BEC5", facecolor=color, alpha=0.55))
    ax.text(13, y1 - 2.4, label, ha="left", va="center",
            fontproperties=fp, fontsize=12, fontweight="bold", color="#37474F")


CX = 46          # 메인 흐름 X
W = 52           # 기본 박스 너비

# ---- 제목 ----
ax.text(60, 166, "티머니 고객센터 전화접수 현황 — 자동화 프로세스 순서도 (v2)",
        ha="center", va="center", fontproperties=fp, fontsize=17, fontweight="bold")
ax.text(60, 161.5,
        "구글시트=입력·뷰  ·  Supabase=저장+연산  ·  Gemini=AI 분석  ·  Vercel=직접조회   /   주차: 목~차주 수  ·  PII 마스킹 ***",
        ha="center", va="center", fontproperties=fp, fontsize=10, color="#555")

# ---- 단계 그룹 배경 ----
group(130, 156, G_BG[0], "1단계 · 데이터 입력 및 감지")
group(92,  128, G_BG[1], "2단계 · GAS 전처리 및 DB 적재")
group(40,  90,  G_BG[2], "3단계 · 데이터 연산 및 인사이트 추출")
group(4,   38,  G_BG[3], "4단계 · 결과 보고 및 시각화")

# ---- 노드 (y, w, h, text, color, dashed) ----
nodes = {
    # 1단계
    "A": (147, W, 9,  "사용자: 구글 시트 워크북\n[전체접수] · [1차필터] 탭에 데이터 입력", C_MANUAL, False),
    "B": (135, W, 9,  "GAS: 시간기반 트리거\n증분 포인터로 신규 행 자동 감지", C_GAS, True),
    # 2단계
    "C": (119, W, 8,  "GAS: 시트 탭 행 읽기 (헤더명 매핑·위치 무관)", C_GAS, True),
    "D": (108, W, 9,  "GAS: PII 마스킹 (차량번호·차량ID ***)\n+ 날짜 정규화 (ISO)", C_GAS, True),
    "E": (97,  W, 9,  "GAS: Supabase REST upsert\nreceptions / all_receptions", C_GAS, True),
    # 3단계
    "F": (82, W, 9,  "Supabase DB: 적재 완료\n접수번호 PK로 중복 자동 차단", C_SUPA, False),
    "G": (70, W, 13, "Supabase SQL View / Function · 목~수 주차 기준\n일/주/월 자동 집계\n전체접수 = 1차필터 + 2차필터\n필터 = 1차필터 + 2차필터(현장인계 제외)", C_SUPA, False),
    "H": (56, W, 12, "Gemini 2.5 Flash API:\n마스킹 데이터 기반 다빈도 오류 분석\n& 필터율 코멘트 생성", C_GEMINI, False),
    "I": (45, W, 8,  "Supabase: weekly_insight 요약 테이블 업데이트", C_SUPA, False),
    # 4단계
    "J": (29, 46, 8, "GAS: Supabase 요약 View Fetch", C_GAS, True),
    "K": (19, 46, 9, "GAS: HTML 이메일 본문 생성\n(0건 데이터 예외 처리)", C_GAS, True),
    "L": (9,  46, 8, "GmailApp: 고정 수신자 메일 발송", C_GAS, True),
    "M": (63, 40, 12, "Vercel 앱:\n실시간 대시보드 웹 시각화\n(anon 읽기전용 직접 조회)", C_MANUAL, False),
}

POS = {}
for k, (y, w, h, txt, color, dashed) in nodes.items():
    x = CX if k != "M" else 92
    POS[k] = (x, y, h)
    box(x, y, w, h, txt, color, fs=10.3, dashed=dashed)

# ---- 메인 흐름 화살표 ----
chain = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]
for a, b in zip(chain, chain[1:]):
    x1, y1, h1 = POS[a]
    x2, y2, h2 = POS[b]
    arrow(x1, y1 - h1 / 2, x2, y2 + h2 / 2)

# ---- I → M (대시보드 분기) ----
ix, iy, ih = POS["I"]
mx, my, mh = POS["M"]
arrow(ix + W / 2, iy + 1, mx - 20, my - mh / 2, color="#7E57C2", text="View 직접 조회")

# ---- 색상 범례 (4단계 우측 빈 공간) ----
LX0, LY0, LX1, LY1 = 73, 6, 110, 36
ax.add_patch(FancyBboxPatch(
    (LX0, LY0), LX1 - LX0, LY1 - LY0,
    boxstyle="round,pad=0.3,rounding_size=2",
    linewidth=1.3, edgecolor="#90A4AE", facecolor="white"))
ax.text((LX0 + LX1) / 2, LY1 - 3, "색상 범례", ha="center", va="center",
        fontproperties=fp, fontsize=11, fontweight="bold", color="#37474F")

legend = [
    (C_MANUAL, EDGE,     "solid",     "사용자 수동\n(시트 입력 · 대시보드 열람)"),
    (C_GAS,    EDGE_GAS, (0, (4, 2)), "GAS 자동화\n(수집 · 전처리 · 메일)"),
    (C_SUPA,   EDGE,     "solid",     "Supabase\n(저장 · SQL 집계 연산)"),
    (C_GEMINI, EDGE,     "solid",     "Gemini AI 분석"),
]
ly = LY1 - 8
for face, ec, ls, label in legend:
    ax.add_patch(FancyBboxPatch(
        (LX0 + 3, ly - 1.6), 6, 3.2,
        boxstyle="round,pad=0.1,rounding_size=0.8",
        linewidth=1.6, edgecolor=ec, facecolor=face, linestyle=ls))
    ax.text(LX0 + 11, ly, label, ha="left", va="center",
            fontproperties=fp, fontsize=8.8, color="#212121")
    ly -= 6.4

plt.tight_layout()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "process_flow.jpg")
plt.savefig(OUT, dpi=150, format="jpg", bbox_inches="tight", facecolor="white")
print("SAVED:", OUT)
