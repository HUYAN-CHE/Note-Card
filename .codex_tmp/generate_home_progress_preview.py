#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成当前首页（绿头）+ 下拉进度环预览图"""

import math
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# 按 iPhone 14 Pro 2x 渲染
SCREEN_W, SCREEN_H = 780, 1688
FRAME_PAD = 36
FRAME_RADIUS = 72
IMG_W = SCREEN_W + FRAME_PAD * 2
IMG_H = SCREEN_H + FRAME_PAD * 2

# 颜色
C_HEADER_TOP = (184, 240, 176)   # #B8F0B0
C_HEADER_BOT = (95, 194, 107)    # #5FC26B
C_WHITE = (255, 255, 255)
C_SHEET_BG = (255, 255, 255)
C_CARD_BG = (248, 249, 251)
C_TEXT_PRIMARY = (28, 28, 30)
C_TEXT_META = (142, 142, 147)
C_TAB_ACTIVE_BG = (220, 252, 231)
C_TAB_ACTIVE_TEXT = (22, 163, 74)
C_TAB_INACTIVE_TEXT = (142, 142, 147)

FONT_CN = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_CN_L = "/System/Library/Fonts/STHeiti Light.ttc"
FONT_FALLBACK = "/Library/Fonts/Arial Unicode.ttf"

PROGRESS = 0.45  # 要展示的进度


def get_font(size, bold=False):
    try:
        return ImageFont.truetype(FONT_CN if bold else FONT_CN_L, size)
    except Exception:
        return ImageFont.truetype(FONT_FALLBACK, size)


def text_size(draw, text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def draw_text_centered(draw, text, x, y, font, fill):
    w, h = text_size(draw, text, font)
    draw.text((x - w / 2, y - h / 2), text, font=font, fill=fill)


def draw_text_left(draw, text, x, y, font, fill):
    w, h = text_size(draw, text, font)
    draw.text((x, y - h / 2), text, font=font, fill=fill)


def gradient_bg(width, height, top, bot):
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        ratio = y / height
        r = int(top[0] + (bot[0] - top[0]) * ratio)
        g = int(top[1] + (bot[1] - top[1]) * ratio)
        b = int(top[2] + (bot[2] - top[2]) * ratio)
        draw.line([(0, y), (width, y)], fill=(r, g, b))
    return img


def rounded_rect(draw, xy, radius, fill=None, outline=None, width=1):
    x1, y1, x2, y2 = xy
    r = radius
    if fill:
        draw.rectangle([x1 + r, y1, x2 - r, y2], fill=fill)
        draw.rectangle([x1, y1 + r, x2, y2 - r], fill=fill)
        draw.ellipse([x1, y1, x1 + r * 2, y1 + r * 2], fill=fill)
        draw.ellipse([x2 - r * 2, y1, x2, y1 + r * 2], fill=fill)
        draw.ellipse([x1, y2 - r * 2, x1 + r * 2, y2], fill=fill)
        draw.ellipse([x2 - r * 2, y2 - r * 2, x2, y2], fill=fill)
    if outline:
        draw.arc([x1, y1, x1 + r * 2, y1 + r * 2], 180, 270, fill=outline, width=width)
        draw.arc([x2 - r * 2, y1, x2, y1 + r * 2], 270, 360, fill=outline, width=width)
        draw.arc([x1, y2 - r * 2, x1 + r * 2, y2], 90, 180, fill=outline, width=width)
        draw.arc([x2 - r * 2, y2 - r * 2, x2, y2], 0, 90, fill=outline, width=width)
        draw.line([x1 + r, y1, x2 - r, y1], fill=outline, width=width)
        draw.line([x1 + r, y2, x2 - r, y2], fill=outline, width=width)
        draw.line([x1, y1 + r, x1, y2 - r], fill=outline, width=width)
        draw.line([x2, y1 + r, x2, y2 - r], fill=outline, width=width)


def draw_partial_capsule_outline(draw, xy, radius, progress, color, width=3):
    """沿胶囊外边缘顺时针绘制一部分描边（进度 0-1）"""
    x1, y1, x2, y2 = xy
    W = x2 - x1
    H = y2 - y1
    R = radius
    perim = 2 * (W - H) + math.pi * H
    d = progress * perim
    cx_left = x1 + R
    cx_right = x2 - R

    # 1. 上边从左到右
    seg1 = W - H
    if d > 0:
        seg = min(d, seg1)
        draw.line([(cx_left, y1), (cx_left + seg, y1)], fill=color, width=width)
    d -= seg1

    # 2. 右半圆（上到下）
    seg2 = math.pi * R
    if d > 0:
        seg = min(d, seg2)
        fraction = seg / seg2
        end = 270 + 180 * fraction
        if fraction >= 1:
            end = 90
        bbox = [cx_right - R, y1, cx_right + R, y2]
        draw.arc(bbox, 270, end, fill=color, width=width)
    d -= seg2

    # 3. 下边从右到左
    seg3 = W - H
    if d > 0:
        seg = min(d, seg3)
        draw.line([(cx_right, y2), (cx_right - seg, y2)], fill=color, width=width)
    d -= seg3

    # 4. 左半圆（下到上）
    seg4 = math.pi * R
    if d > 0:
        seg = min(d, seg4)
        fraction = seg / seg4
        end = 90 + 180 * fraction
        if fraction >= 1:
            end = 270
        bbox = [x1, y1, x1 + H, y2]
        draw.arc(bbox, 90, end, fill=color, width=width)


def main():
    canvas = Image.new("RGBA", (IMG_W + 80, IMG_H + 80), (246, 248, 250, 255))

    # 外框阴影
    shadow = Image.new("RGBA", (IMG_W, IMG_H), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    rounded_rect(sdraw, [0, 0, IMG_W, IMG_H], FRAME_RADIUS, fill=(0, 0, 0, 50))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=28))
    canvas.paste(shadow, (40, 50), shadow)

    # 手机屏幕（RGBA，带透明按钮）
    screen = Image.new("RGBA", (SCREEN_W, SCREEN_H), C_SHEET_BG)
    sdraw = ImageDraw.Draw(screen)

    # 1. 绿色渐变头部
    header_h = 900
    bg = gradient_bg(SCREEN_W, SCREEN_H, C_HEADER_TOP, C_HEADER_BOT).convert("RGBA")
    # 先不直接 paste 到 screen，等最后 alpha 合成到底层，避免透明元素被错误混合
    screen.paste(bg, (0, 0))

    # 2. 状态栏
    status_y = 46
    f_status = get_font(26)
    draw_text_left(sdraw, "9:41", 38, status_y, f_status, C_WHITE)

    # 3. 顶部标题
    f_header = get_font(32, bold=True)
    draw_text_left(sdraw, "This week", 40, 116, f_header, (26, 60, 26))

    # 4. 日期选择器（7 天，今天居中）
    days = [
        ("M", "15", False),
        ("T", "16", False),
        ("W", "17", False),
        ("T", "18", True),
        ("F", "19", False),
        ("S", "20", False),
        ("S", "21", False),
    ]
    day_y = 200
    day_gap = 96
    day_start_x = (SCREEN_W - day_gap * 6) / 2
    day_r = 44
    f_day_num = get_font(32, bold=True)
    f_day_label = get_font(22)
    for i, (label, num, is_today) in enumerate(days):
        cx = day_start_x + i * day_gap
        if is_today:
            rounded_rect(sdraw, [cx - day_r, day_y, cx + day_r, day_y + day_r * 2], day_r, fill=C_WHITE)
            draw_text_centered(sdraw, num, cx, day_y + day_r - 12, f_day_num, C_HEADER_BOT)
            draw_text_centered(sdraw, label, cx, day_y + day_r + 26, f_day_label, C_HEADER_BOT)
        else:
            rounded_rect(sdraw, [cx - day_r, day_y, cx + day_r, day_y + day_r * 2], day_r, fill=(255, 255, 255, 60))
            draw_text_centered(sdraw, num, cx, day_y + day_r - 12, f_day_num, C_WHITE)
            draw_text_centered(sdraw, label, cx, day_y + day_r + 26, f_day_label, C_WHITE)

    # 5. 标语
    slogan_y = 460
    f_slogan = get_font(44, bold=True)
    draw_text_centered(sdraw, "生活由无数的小事组成", SCREEN_W / 2, slogan_y, f_slogan, C_WHITE)

    # 6. CTA 药丸按钮 + 进度环
    cta_w, cta_h = 440, 92
    cta_x = (SCREEN_W - cta_w) / 2
    cta_y = 600
    cta_r = cta_h // 2

    # 按钮底色
    rounded_rect(sdraw, [cta_x, cta_y, cta_x + cta_w, cta_y + cta_h], cta_r, fill=(255, 255, 255, 55))

    # 进度环：只画已下拉的部分，未画到的地方没有边框（与代码里 border-color: transparent 一致）
    draw_partial_capsule_outline(sdraw, [cta_x, cta_y, cta_x + cta_w, cta_y + cta_h],
                                 cta_r, PROGRESS, C_WHITE, width=3)

    # 按钮文字
    f_cta = get_font(30, bold=True)
    draw_text_centered(sdraw, "+  下拉新建事项", SCREEN_W / 2, cta_y + cta_h / 2, f_cta, C_WHITE)

    # 7. 白色底部 Sheet
    sheet_top = 820
    sheet_radius = 48
    rounded_rect(sdraw, [0, sheet_top, SCREEN_W, SCREEN_H], sheet_radius, fill=C_SHEET_BG)

    # 8. Sheet 头部
    header_x = 42
    header_y = sheet_top + 44
    f_sheet_title = get_font(34, bold=True)
    f_sheet_sub = get_font(24)
    draw_text_left(sdraw, "最近记事卡", header_x, header_y, f_sheet_title, C_TEXT_PRIMARY)
    draw_text_left(sdraw, "打开临近消息提醒", header_x, header_y + 44, f_sheet_sub, C_TEXT_META)

    # 9. 卡片列表
    cards = [
        ("官网改版", "王女士 · 需求确认卡 · 06-18", (78, 162, 214), False),
        ("Q3 宣传物料", "李总 · 服务进度卡 · 06-17", (120, 190, 220), False),
        ("团队周会", "张经理 · 预约记录 · 06-17", (52, 199, 152), True),
    ]
    card_start_y = header_y + 120
    card_h = 156
    card_gap = 20
    f_card_title = get_font(30, bold=True)
    f_card_meta = get_font(24)

    for i, (title, meta, avatar_color, done) in enumerate(cards):
        y = card_start_y + i * (card_h + card_gap)
        x = 32
        w = SCREEN_W - 64
        rounded_rect(sdraw, [x, y, x + w, y + card_h], 28, fill=C_CARD_BG)

        # 头像
        avatar_x = x + 84
        avatar_y = y + card_h / 2
        rounded_rect(sdraw, [avatar_x - 48, avatar_y - 48, avatar_x + 48, avatar_y + 48], 48, fill=avatar_color)
        draw_text_centered(sdraw, "记", avatar_x, avatar_y, get_font(32, bold=True), C_WHITE)

        # 文字
        text_x = avatar_x + 72
        draw_text_left(sdraw, title, text_x, avatar_y - 16, f_card_title, C_TEXT_PRIMARY)
        draw_text_left(sdraw, meta, text_x, avatar_y + 26, f_card_meta, C_TEXT_META)

        # 状态
        status_x = x + w - 72
        status_y = avatar_y
        if done:
            rounded_rect(sdraw, [status_x - 32, status_y - 32, status_x + 32, status_y + 32], 32, fill=(16, 185, 129))
            draw_text_centered(sdraw, "✓", status_x, status_y, get_font(28, bold=True), C_WHITE)
        else:
            rounded_rect(sdraw, [status_x - 32, status_y - 32, status_x + 32, status_y + 32], 32, fill=C_WHITE, outline=(199, 199, 203), width=2)

    # 10. 底部 Tab Bar
    tab_w = 520
    tab_h = 96
    tab_x = (SCREEN_W - tab_w) / 2
    tab_y = SCREEN_H - 132

    tab_shadow = Image.new("RGBA", (SCREEN_W, SCREEN_H), (0, 0, 0, 0))
    tdraw_shadow = ImageDraw.Draw(tab_shadow)
    rounded_rect(tdraw_shadow, [tab_x, tab_y + 8, tab_x + tab_w, tab_h + tab_y + 8], tab_h // 2, fill=(0, 0, 0, 40))
    tab_shadow = tab_shadow.filter(ImageFilter.GaussianBlur(radius=16))
    screen = Image.alpha_composite(screen, tab_shadow)

    sdraw = ImageDraw.Draw(screen)
    rounded_rect(sdraw, [tab_x, tab_y, tab_x + tab_w, tab_y + tab_h], tab_h // 2, fill=C_WHITE)

    active_x = tab_x + 10
    active_y = tab_y + 10
    active_w = (tab_w - 24) / 2
    active_h = tab_h - 20
    rounded_rect(sdraw, [active_x, active_y, active_x + active_w, active_y + active_h], active_h // 2, fill=C_TAB_ACTIVE_BG)

    f_tab_active = get_font(28, bold=True)
    draw_text_centered(sdraw, "☰ 事项", active_x + active_w / 2, active_y + active_h / 2, f_tab_active, C_TAB_ACTIVE_TEXT)

    inactive_x = active_x + active_w + 4
    f_tab_inactive = get_font(28, bold=True)
    draw_text_centered(sdraw, "○ 服务", inactive_x + active_w / 2, active_y + active_h / 2, f_tab_inactive, C_TAB_INACTIVE_TEXT)

    # Home Indicator
    hi_w, hi_h = 148, 10
    hi_x = (SCREEN_W - hi_w) / 2
    hi_y = SCREEN_H - 18
    rounded_rect(sdraw, [hi_x, hi_y, hi_x + hi_w, hi_y + hi_h], hi_h // 2, fill=(0, 0, 0, 45))

    # 手机外框
    frame = Image.new("RGBA", (IMG_W, IMG_H), C_WHITE)
    fdraw = ImageDraw.Draw(frame)
    rounded_rect(fdraw, [0, 0, IMG_W, IMG_H], FRAME_RADIUS, fill=C_WHITE)

    mask = Image.new("L", (IMG_W, IMG_H), 0)
    mdraw = ImageDraw.Draw(mask)
    rounded_rect(mdraw, [FRAME_PAD, FRAME_PAD, IMG_W - FRAME_PAD, IMG_H - FRAME_PAD], FRAME_RADIUS - 16, fill=255)

    canvas.paste(frame, (40, 40), frame)
    # 把透明元素（按钮、阴影）正确地混合到绿色渐变背景上
    screen_final = Image.alpha_composite(bg, screen).convert("RGB")
    canvas.paste(screen_final, (FRAME_PAD + 40, FRAME_PAD + 40))

    bbox = canvas.getbbox()
    canvas = canvas.crop(bbox)

    out_dir = "/Users/huche/Desktop/CODE/wechat/jishika-miniprogram/assets"
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "home_progress_preview.png")
    canvas.convert("RGB").save(out_path, quality=95)
    print(f"已生成：{out_path}")


if __name__ == "__main__":
    main()
