#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《记事卡》首页新版 UI 效果图生成器（精调间距 + icon）"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ========== 画布配置 ==========
# 按 iPhone 14 Pro 2x 渲染
SCREEN_W, SCREEN_H = 780, 1688
FRAME_PAD = 36
FRAME_RADIUS = 72
IMG_W = SCREEN_W + FRAME_PAD * 2
IMG_H = SCREEN_H + FRAME_PAD * 2

# ========== 颜色 ==========
C_HEADER_TOP = (118, 205, 244)
C_HEADER_BOT = (78, 162, 214)
C_WHITE = (255, 255, 255)
C_SHEET_BG = (255, 255, 255)
C_CARD_BG = (248, 249, 251)
C_TEXT_PRIMARY = (28, 28, 30)
C_TEXT_META = (142, 142, 147)
C_TAB_ACTIVE_BG = (220, 252, 231)
C_TAB_ACTIVE_TEXT = (22, 163, 74)
C_TAB_ACTIVE_DOT = (34, 197, 94)
C_TAB_INACTIVE_TEXT = (142, 142, 147)
C_STATUS_DONE = (16, 185, 129)
C_STATUS_PENDING_BG = (239, 239, 244)
C_AI_BADGE = (245, 158, 11)
C_BLACK_10 = (0, 0, 0, 26)

# ========== 字体 ==========
FONT_CN = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_CN_L = "/System/Library/Fonts/STHeiti Light.ttc"
FONT_FALLBACK = "/Library/Fonts/Arial Unicode.ttf"


def get_font(size, bold=False):
    try:
        return ImageFont.truetype(FONT_CN if bold else FONT_CN_L, size)
    except Exception:
        return ImageFont.truetype(FONT_FALLBACK, size)


# ========== 绘制工具 ==========
def rounded_rect(draw, xy, radius, fill=None, outline=None, width=1):
    x1, y1, x2, y2 = xy
    r = radius
    # 主体
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


def circle(draw, center, radius, fill=None, outline=None, width=1):
    x, y = center
    bbox = [x - radius, y - radius, x + radius, y + radius]
    draw.ellipse(bbox, fill=fill, outline=outline, width=width)


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


def text_size(draw, text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def draw_text_centered(draw, text, x, y, font, fill, shadow=None):
    w, h = text_size(draw, text, font)
    tx, ty = x - w / 2, y - h / 2
    if shadow:
        draw.text((tx + 1, ty + 1), text, font=font, fill=shadow)
    draw.text((tx, ty), text, font=font, fill=fill)


def draw_text_left(draw, text, x, y, font, fill):
    w, h = text_size(draw, text, font)
    draw.text((x, y - h / 2), text, font=font, fill=fill)


# ========== 图标绘制函数 ==========
def draw_back_arrow(draw, cx, cy, color, size=18, width=3):
    """绘制返回箭头 <"""
    draw.line([(cx + size / 2, cy - size / 2), (cx - size / 2, cy)], fill=color, width=width)
    draw.line([(cx - size / 2, cy), (cx + size / 2, cy + size / 2)], fill=color, width=width)


def draw_edit_icon(draw, cx, cy, color, size=20, width=3):
    """绘制铅笔 icon"""
    # 笔身（45度斜线）
    draw.line([(cx - size / 2, cy + size / 2 - 2), (cx + size / 2 - 4, cy - size / 2 + 2)], fill=color, width=width)
    # 笔尖三角形
    tip_x, tip_y = cx - size / 2, cy + size / 2 - 2
    draw.polygon([
        (tip_x, tip_y),
        (tip_x + 5, tip_y - 3),
        (tip_x + 3, tip_y + 5)
    ], fill=color)
    # 笔尾橡皮
    eraser_x, eraser_y = cx + size / 2 - 4, cy - size / 2 + 2
    draw.line([(eraser_x, eraser_y), (eraser_x + 4, eraser_y - 4)], fill=color, width=width)


def draw_card_icon(draw, cx, cy, color, size=22, width=2.5):
    """绘制卡片/文档 icon"""
    x1, y1 = cx - size / 2, cy - size / 2 + 2
    x2, y2 = cx + size / 2, cy + size / 2 - 2
    rounded_rect(draw, [x1, y1, x2, y2], 4, fill=None, outline=color, width=int(width))
    draw.line([(x1 + 4, cy - 2), (x2 - 4, cy - 2)], fill=color, width=int(width))


def draw_chat_icon(draw, cx, cy, color, size=24, width=2.5):
    """绘制对话气泡 icon"""
    x1, y1 = cx - size / 2, cy - size / 2 + 2
    x2, y2 = cx + size / 2, cy + size / 2 - 4
    rounded_rect(draw, [x1, y1, x2, y2], 6, fill=None, outline=color, width=int(width))
    # 小尾巴
    draw.polygon([(cx - 6, y2 - 3), (cx + 2, y2 - 3), (cx - 6, y2 + 6)], fill=color)


def draw_calendar_icon(draw, cx, cy, color, size=22, width=2.5):
    """绘制日历 icon"""
    x1, y1 = cx - size / 2, cy - size / 2 + 3
    x2, y2 = cx + size / 2, cy + size / 2 - 1
    rounded_rect(draw, [x1, y1, x2, y2], 4, fill=None, outline=color, width=int(width))
    draw.line([(x1 + 2, cy - 2), (x2 - 2, cy - 2)], fill=color, width=int(width))
    draw.line([(cx - 4, y1 - 5), (cx - 4, y1 + 2)], fill=color, width=int(width))
    draw.line([(cx + 4, y1 - 5), (cx + 4, y1 + 2)], fill=color, width=int(width))


def draw_list_icon(draw, cx, cy, color, size=22, width=2.5):
    """绘制列表/事项 icon（三条横线）"""
    y_positions = [cy - size / 3, cy, cy + size / 3]
    for y in y_positions:
        draw.line([(cx - size / 2, y), (cx + size / 2, y)], fill=color, width=int(width))


def draw_profile_icon(draw, cx, cy, color, size=24, width=2.5):
    """绘制人物名片 icon"""
    # 头部圆（位置偏上，留出肩膀空间）
    head_y = cy - size / 3
    circle(draw, (cx, head_y), size / 4, outline=color, width=int(width))
    # 肩膀：两条向外弧线，构成人形
    shoulder_w = size / 2 - 2
    # 左肩
    draw.arc([cx - shoulder_w, head_y + 2, cx, head_y + size / 2 + 6], 90, 180, fill=color, width=int(width))
    # 右肩
    draw.arc([cx, head_y + 2, cx + shoulder_w, head_y + size / 2 + 6], 0, 90, fill=color, width=int(width))
    # 连接底部
    draw.line([(cx - shoulder_w + 4, head_y + size / 2 + 6), (cx + shoulder_w - 4, head_y + size / 2 + 6)], fill=color, width=int(width))


def draw_check_icon(draw, cx, cy, color, size=16, width=3):
    """绘制对勾"""
    draw.line([(cx - size / 2, cy), (cx - size / 6, cy + size / 2)], fill=color, width=width)
    draw.line([(cx - size / 6, cy + size / 2), (cx + size / 2, cy - size / 2)], fill=color, width=width)


# ========== 主函数 ==========
def main():
    # 创建画布（带手机外框阴影）
    canvas = Image.new("RGBA", (IMG_W + 80, IMG_H + 80), (246, 248, 250, 255))

    # 外框阴影
    shadow = Image.new("RGBA", (IMG_W, IMG_H), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    rounded_rect(sdraw, [0, 0, IMG_W, IMG_H], FRAME_RADIUS, fill=(0, 0, 0, 50))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=28))
    canvas.paste(shadow, (40, 50), shadow)

    # 手机屏幕
    screen = Image.new("RGBA", (SCREEN_W, SCREEN_H), C_SHEET_BG)
    sdraw = ImageDraw.Draw(screen)

    # 1. 蓝色渐变头部
    header_h = 760
    bg = gradient_bg(SCREEN_W, header_h, C_HEADER_TOP, C_HEADER_BOT)
    screen.paste(bg, (0, 0))

    # 2. 状态栏
    status_y = 46
    f_status = get_font(26)
    draw_text_left(sdraw, "9:41", 38, status_y, f_status, C_WHITE)

    # 信号
    sig_x = SCREEN_W - 156
    for i, h in enumerate([10, 16, 22]):
        x = sig_x + i * 8
        sdraw.rectangle([x, status_y - h / 2, x + 5, status_y + h / 2], fill=C_WHITE, outline=C_WHITE)
    # wifi
    wifi_x = SCREEN_W - 112
    sdraw.arc([wifi_x - 16, status_y - 12, wifi_x + 16, status_y + 12], 200, 340, fill=C_WHITE, width=3)
    sdraw.arc([wifi_x - 10, status_y - 8, wifi_x + 10, status_y + 8], 200, 340, fill=C_WHITE, width=2)
    # 电池
    bx1, by1 = SCREEN_W - 56, status_y - 10
    bx2, by2 = SCREEN_W - 22, status_y + 10
    rounded_rect(sdraw, [bx1, by1, bx2, by2], 4, fill=None, outline=C_WHITE, width=2)
    sdraw.rectangle([bx1 + 5, by1 + 3, bx2 - 5, by2 - 3], fill=C_WHITE)
    sdraw.rectangle([bx2, status_y - 4, bx2 + 3, status_y + 4], fill=C_WHITE, outline=C_WHITE)

    # 3. 导航栏（只保留居中标题，不放左右按钮，避免和微信胶囊冲突）
    nav_y = 124
    f_title = get_font(34, bold=True)
    draw_text_centered(sdraw, "记事卡", SCREEN_W / 2, nav_y, f_title, C_WHITE)

    # 4. 日期选择器：7 天，今天居中
    days = [
        ("日", "15", False),
        ("一", "16", False),
        ("二", "17", False),
        ("三", "18", True),
        ("四", "19", False),
        ("五", "20", False),
        ("六", "21", False),
    ]
    day_y = 232
    day_gap = 96
    day_start_x = (SCREEN_W - day_gap * 6) / 2
    day_r = 44
    f_day_num = get_font(32, bold=True)
    f_day_label = get_font(22)
    for i, (label, num, is_today) in enumerate(days):
        cx = day_start_x + i * day_gap
        if is_today:
            circle(sdraw, (cx, day_y + day_r), day_r, C_WHITE)
            draw_text_centered(sdraw, num, cx, day_y + day_r - 12, f_day_num, C_HEADER_BOT)
            draw_text_centered(sdraw, label, cx, day_y + day_r + 26, f_day_label, C_HEADER_BOT)
        else:
            circle(sdraw, (cx, day_y + day_r), day_r, (255, 255, 255, 45))
            shadow_color = (78, 162, 214, 140)
            draw_text_centered(sdraw, num, cx, day_y + day_r - 12, f_day_num, C_WHITE, shadow=shadow_color)
            draw_text_centered(sdraw, label, cx, day_y + day_r + 26, f_day_label, C_WHITE, shadow=shadow_color)

    # 5. 标语
    slogan_y = 470
    f_slogan = get_font(44, bold=True)
    draw_text_centered(sdraw, "聊过的事", SCREEN_W / 2, slogan_y, f_slogan, C_WHITE)
    draw_text_centered(sdraw, "记成确认过的卡", SCREEN_W / 2, slogan_y + 62, f_slogan, C_WHITE)

    # 6. CTA 药丸按钮：半透明 + 白边 + 下拉时白线满上（静态展示约 35% 填充）
    cta_w, cta_h = 400, 88
    cta_x = (SCREEN_W - cta_w) / 2
    cta_y = 580
    # 半透明底色
    rounded_rect(sdraw, [cta_x, cta_y, cta_x + cta_w, cta_y + cta_h], cta_h // 2, fill=(255, 255, 255, 40))
    # 白边
    rounded_rect(sdraw, [cta_x, cta_y, cta_x + cta_w, cta_y + cta_h], cta_h // 2, fill=None, outline=C_WHITE, width=3)
    # 部分白色填充（模拟下拉进度 35%）
    fill_w = int(cta_w * 0.35)
    rounded_rect(sdraw, [cta_x + 2, cta_y + 2, cta_x + fill_w - 2, cta_y + cta_h - 2], (cta_h - 4) // 2, fill=(255, 255, 255, 120))
    # 文字
    f_cta = get_font(30, bold=True)
    draw_text_centered(sdraw, "下拉新建事项", cta_x + cta_w / 2 - 24, cta_y + cta_h / 2, f_cta, C_WHITE)
    # 加号圆圈
    plus_x = cta_x + cta_w - 66
    plus_y = cta_y + cta_h / 2
    circle(sdraw, (plus_x, plus_y), 28, (255, 255, 255, 60))
    sdraw.line([(plus_x, plus_y - 10), (plus_x, plus_y + 10)], fill=C_WHITE, width=3)
    sdraw.line([(plus_x - 10, plus_y), (plus_x + 10, plus_y)], fill=C_WHITE, width=3)

    # 7. 白色底部 Sheet
    sheet_top = 760
    sheet_radius = 48
    rounded_rect(sdraw, [0, sheet_top, SCREEN_W, SCREEN_H], sheet_radius, fill=C_SHEET_BG)

    # 8. Sheet 头部
    header_x = 42
    header_y = sheet_top + 44
    f_sheet_title = get_font(34, bold=True)
    f_sheet_sub = get_font(24)
    draw_text_left(sdraw, "最近记事卡", header_x, header_y, f_sheet_title, C_TEXT_PRIMARY)
    draw_text_left(sdraw, "优先处理待确认和待推进的事项", header_x, header_y + 44, f_sheet_sub, C_TEXT_META)

    # AI badge
    badge_x = SCREEN_W - 72
    badge_y = header_y + 6
    circle(sdraw, (badge_x, badge_y), 30, C_AI_BADGE)
    f_badge = get_font(24, bold=True)
    draw_text_centered(sdraw, "AI", badge_x, badge_y, f_badge, C_WHITE)

    # 9. 卡片列表
    cards = [
        ("官网改版", "王女士 · 需求确认卡 · 06-18", (78, 162, 214), "card", False),
        ("Q3 宣传物料", "李总 · 服务进度卡 · 06-17", (120, 190, 220), "card", False),
        ("团队周会", "张经理 · 预约记录 · 06-17", (52, 199, 152), "calendar", True),
    ]
    card_start_y = header_y + 120
    card_h = 156
    card_gap = 20
    f_card_title = get_font(30, bold=True)
    f_card_meta = get_font(24)

    for i, (title, meta, avatar_color, icon_type, done) in enumerate(cards):
        y = card_start_y + i * (card_h + card_gap)
        x = 32
        w = SCREEN_W - 64
        rounded_rect(sdraw, [x, y, x + w, y + card_h], 28, fill=C_CARD_BG)

        # 头像
        avatar_x = x + 36 + 48
        avatar_y = y + card_h / 2
        circle(sdraw, (avatar_x, avatar_y), 48, avatar_color)
        if icon_type == "card":
            draw_card_icon(sdraw, avatar_x, avatar_y, C_WHITE, size=26, width=2.5)
        elif icon_type == "chat":
            draw_chat_icon(sdraw, avatar_x, avatar_y, C_WHITE, size=26, width=2.5)
        elif icon_type == "calendar":
            draw_calendar_icon(sdraw, avatar_x, avatar_y, C_WHITE, size=26, width=2.5)

        # 文字
        text_x = avatar_x + 66
        draw_text_left(sdraw, title, text_x, avatar_y - 16, f_card_title, C_TEXT_PRIMARY)
        draw_text_left(sdraw, meta, text_x, avatar_y + 26, f_card_meta, C_TEXT_META)

        # 状态
        status_x = x + w - 56
        status_y = avatar_y
        if done:
            circle(sdraw, (status_x, status_y), 32, C_STATUS_DONE)
            draw_check_icon(sdraw, status_x, status_y, C_WHITE, size=18, width=3)
        else:
            circle(sdraw, (status_x, status_y), 32, C_STATUS_PENDING_BG, outline=(199, 199, 203), width=2)

    # 10. 底部 Tab Bar
    tab_w = 520
    tab_h = 96
    tab_x = (SCREEN_W - tab_w) / 2
    tab_y = SCREEN_H - 132

    # Tab 阴影
    tab_shadow = Image.new("RGBA", (SCREEN_W, SCREEN_H), (0, 0, 0, 0))
    tdraw_shadow = ImageDraw.Draw(tab_shadow)
    rounded_rect(tdraw_shadow, [tab_x, tab_y + 8, tab_x + tab_w, tab_h + tab_y + 8], tab_h // 2, fill=(0, 0, 0, 40))
    tab_shadow = tab_shadow.filter(ImageFilter.GaussianBlur(radius=16))
    screen = Image.alpha_composite(screen, tab_shadow)

    # Tab 本体
    sdraw = ImageDraw.Draw(screen)
    rounded_rect(sdraw, [tab_x, tab_y, tab_x + tab_w, tab_y + tab_h], tab_h // 2, fill=C_WHITE)

    # 事项 Tab（激活）
    active_x = tab_x + 10
    active_y = tab_y + 10
    active_w = (tab_w - 24) / 2
    active_h = tab_h - 20
    rounded_rect(sdraw, [active_x, active_y, active_x + active_w, active_y + active_h], active_h // 2, fill=C_TAB_ACTIVE_BG)

    # 事项 icon + 文字
    icon_cx = active_x + active_w / 2 - 42
    icon_cy = active_y + active_h / 2
    draw_list_icon(sdraw, icon_cx, icon_cy, C_TAB_ACTIVE_TEXT, size=24, width=3)
    f_tab_active = get_font(28, bold=True)
    draw_text_left(sdraw, "事项", icon_cx + 20, icon_cy, f_tab_active, C_TAB_ACTIVE_TEXT)

    # 服务 Tab（未激活）
    inactive_x = active_x + active_w + 4
    icon_cx2 = inactive_x + active_w / 2 - 38
    icon_cy2 = active_y + active_h / 2
    draw_profile_icon(sdraw, icon_cx2, icon_cy2, C_TAB_INACTIVE_TEXT, size=24, width=2.5)
    f_tab_inactive = get_font(28, bold=True)
    draw_text_left(sdraw, "服务", icon_cx2 + 22, icon_cy2, f_tab_inactive, C_TAB_INACTIVE_TEXT)

    # Home Indicator
    hi_w, hi_h = 148, 10
    hi_x = (SCREEN_W - hi_w) / 2
    hi_y = SCREEN_H - 18
    rounded_rect(sdraw, [hi_x, hi_y, hi_x + hi_w, hi_y + hi_h], hi_h // 2, fill=(0, 0, 0, 45))

    # 手机外框
    frame = Image.new("RGBA", (IMG_W, IMG_H), C_WHITE)
    fdraw = ImageDraw.Draw(frame)
    rounded_rect(fdraw, [0, 0, IMG_W, IMG_H], FRAME_RADIUS, fill=C_WHITE)

    # 把屏幕贴入外框
    mask = Image.new("L", (IMG_W, IMG_H), 0)
    mdraw = ImageDraw.Draw(mask)
    rounded_rect(mdraw, [FRAME_PAD, FRAME_PAD, IMG_W - FRAME_PAD, IMG_H - FRAME_PAD], FRAME_RADIUS - 16, fill=255)

    canvas.paste(frame, (40, 40), frame)
    canvas.paste(screen, (FRAME_PAD + 40, FRAME_PAD + 40), screen)

    # 裁剪
    bbox = canvas.getbbox()
    canvas = canvas.crop(bbox)

    out_path = "/Users/huche/Desktop/CODE/wechat/jishika-miniprogram/assets/home_mockup_v2.png"
    canvas.convert("RGB").save(out_path, quality=95)
    print(f"已生成：{out_path}")


if __name__ == "__main__":
    main()
